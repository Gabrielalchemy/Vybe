import type { AssetEntry, AssetManifest } from "../../domain/assetManifest";
import { fail, ok, type Result } from "../../domain/result";
import { validateWorkerMessage, type Delegate, type WorkerMessage, type WorkerRequest } from "../../domain/tracking/protocol";
import { RateMeter, RollingWindow, type Summary } from "../../domain/tracking/rollingStats";
import { createAssetLoader } from "../assets/assetLoader";
import { loadManifest } from "../assets/manifest";

/** A result older than this at receipt is stale: discarded for triggers and renewal. */
export const STALE_RESULT_MS = 100;
/** A frame outstanding this long means the worker is not keeping up or has hung. */
export const WORKER_STALL_MS = 2000;
const INIT_TIMEOUT_MS = 30_000;

export type TrackerErrorCode = "assets" | "init-failed" | "init-timeout" | "worker-crashed" | "worker-stalled";

export interface TrackerError {
  code: TrackerErrorCode;
  message: string;
}

export type FrameResult = Extract<WorkerMessage, { type: "result" }>;

export interface TrackerStats {
  delegate: Delegate | null;
  submitted: number;
  skippedBusy: number;
  stale: number;
  failedFrames: number;
  inferenceMs: Summary | null;
  /** Receipt age of accepted results (delivery to receipt). */
  turnaroundMs: Summary | null;
  /** Receipt age of every result, including those discarded as stale. */
  resultAgeMs: Summary | null;
  inferenceRate: number;
}

export interface TrackerAssets {
  manifest: AssetManifest;
  model: AssetEntry;
  loader: AssetEntry;
  binary: AssetEntry;
}

/** Loads and verifies the manifest and every tracking asset before the worker starts. */
export async function loadTrackerAssets(baseUrl = "/assets/"): Promise<Result<TrackerAssets & { modelBytes: ArrayBuffer }, TrackerError>> {
  const err = (message: string) => fail<TrackerError>({ code: "assets", message });
  const manifest = await loadManifest(baseUrl);
  if (!manifest.ok) return err(manifest.error);
  const find = (kind: AssetEntry["kind"]) => manifest.value.assets.find((a) => a.kind === kind && a.path.startsWith("mediapipe/"));
  const model = find("model");
  const loader = find("wasm-loader");
  const binary = find("wasm");
  if (!model || !loader || !binary) return err("Hand tracking files are not listed. Run asset preparation again.");
  const assetLoader = createAssetLoader({ baseUrl, fetch: (input, init) => fetch(input, init) });
  const [m, l, b] = await Promise.all([assetLoader.load(model), assetLoader.load(loader), assetLoader.load(binary)]);
  for (const r of [m, l, b]) if (!r.ok) return err(`Hand tracking files did not load: ${r.error.message}`);
  if (!m.ok) return err("Model did not load.");
  return ok({ manifest: manifest.value, model, loader, binary, modelBytes: m.value });
}

/**
 * Main-thread side of the vision worker: one frame in flight, epoch-tagged
 * messages validated on receipt, stale results discarded, crashes and stalls
 * reported. Never falls back to main-thread inference.
 */
export class TrackingClient {
  private worker: Worker | null = null;
  private epoch = 0;
  private sequence = 0;
  private inFlightSince: number | null = null;
  private ready = false;
  private delegate: Delegate | null = null;
  private readonly inference = new RollingWindow(240);
  private readonly turnaround = new RollingWindow(240);
  private readonly resultAge = new RollingWindow(240);
  private readonly rate = new RateMeter(2000);
  private counts = { submitted: 0, skippedBusy: 0, stale: 0, failedFrames: 0 };
  private onResult: ((r: FrameResult) => void) | null = null;
  private onFailure: ((e: TrackerError) => void) | null = null;

  async start(
    delegate: Delegate,
    assets: TrackerAssets & { modelBytes: ArrayBuffer },
    handlers: { onResult: (r: FrameResult) => void; onFailure: (e: TrackerError) => void },
  ): Promise<Result<Delegate, TrackerError>> {
    this.stop();
    const epoch = ++this.epoch;
    this.onResult = handlers.onResult;
    this.onFailure = handlers.onFailure;
    this.resetStats();
    const worker = new Worker(new URL("../../workers/vision.worker.ts", import.meta.url), { type: "module", name: "vybe-vision" });
    this.worker = worker;

    const readiness = new Promise<Result<Delegate, TrackerError>>((resolve) => {
      const timer = setTimeout(() => resolve(fail({ code: "init-timeout", message: "Hand tracking took too long to start." })), INIT_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const msg = validateWorkerMessage(event.data);
        if (!msg.ok || msg.value.epoch !== epoch) return;
        if (msg.value.type === "ready") {
          clearTimeout(timer);
          resolve(ok(msg.value.delegate));
        } else if (msg.value.type === "init-failed") {
          clearTimeout(timer);
          resolve(fail({ code: "init-failed", message: `Hand tracking could not start on the ${msg.value.delegate}: ${msg.value.message}` }));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        event.preventDefault();
        resolve(fail({ code: "worker-crashed", message: `Hand tracking stopped unexpectedly (${event.message || "worker error"}).` }));
      };
    });

    const modelCopy = assets.modelBytes.slice(0);
    const init: WorkerRequest = {
      type: "init",
      epoch,
      delegate,
      wasmLoaderPath: new URL(`/assets/${assets.loader.path}`, location.origin).href,
      wasmBinaryPath: new URL(`/assets/${assets.binary.path}`, location.origin).href,
      model: modelCopy,
    };
    worker.postMessage(init, [modelCopy]);
    const result = await readiness;
    if (epoch !== this.epoch) return fail({ code: "init-failed", message: "Superseded by a newer start." });
    if (!result.ok) {
      this.stop();
      return result;
    }
    this.ready = true;
    this.delegate = result.value;
    worker.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data, epoch);
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail({ code: "worker-crashed", message: `Hand tracking stopped unexpectedly (${event.message || "worker error"}).` });
    };
    return result;
  }

  /** True when a frame can be submitted now. */
  idle(): boolean {
    return this.ready && this.inFlightSince === null;
  }

  /** Transfers the bitmap if idle; otherwise closes it and counts a skipped frame. */
  submit(bitmap: ImageBitmap, deliveredAtMs: number): void {
    if (!this.worker || !this.idle()) {
      bitmap.close();
      this.counts.skippedBusy += 1;
      return;
    }
    this.inFlightSince = performance.now();
    this.counts.submitted += 1;
    const req: WorkerRequest = { type: "frame", epoch: this.epoch, sequence: ++this.sequence, deliveredAtMs, bitmap };
    this.worker.postMessage(req, [bitmap]);
  }

  /** Watchdog; call periodically. */
  check(nowMs: number): void {
    if (this.inFlightSince !== null && nowMs - this.inFlightSince > WORKER_STALL_MS) {
      this.fail({ code: "worker-stalled", message: "Hand tracking stopped responding." });
    }
  }

  stats(nowMs: number): TrackerStats {
    return {
      delegate: this.delegate,
      ...this.counts,
      inferenceMs: this.inference.summary(),
      turnaroundMs: this.turnaround.summary(),
      resultAgeMs: this.resultAge.summary(),
      inferenceRate: this.rate.perSecond(nowMs),
    };
  }

  /** Idempotent shutdown; later messages from this epoch are ignored. */
  stop(): void {
    this.epoch += 1;
    this.ready = false;
    this.inFlightSince = null;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      try {
        this.worker.postMessage({ type: "close" } satisfies WorkerRequest);
      } catch {
        // Already gone.
      }
      this.worker.terminate();
    }
    this.worker = null;
  }

  private receive(raw: unknown, epoch: number): void {
    if (epoch !== this.epoch) return;
    const msg = validateWorkerMessage(raw);
    if (!msg.ok) {
      this.fail({ code: "worker-crashed", message: `Hand tracking sent an invalid message: ${msg.error}` });
      return;
    }
    const m = msg.value;
    if (m.epoch !== this.epoch) return;
    if (m.type === "frame-failed") {
      this.inFlightSince = null;
      this.counts.failedFrames += 1;
      return;
    }
    if (m.type !== "result") return;
    this.inFlightSince = null;
    const now = performance.now();
    this.inference.push(m.inferenceDurationMs);
    this.rate.mark(now);
    const age = now - m.deliveredAtMs;
    this.resultAge.push(age);
    if (age > STALE_RESULT_MS) {
      this.counts.stale += 1;
      return;
    }
    this.turnaround.push(age);
    this.onResult?.(m);
  }

  private fail(error: TrackerError): void {
    const handler = this.onFailure;
    this.stop();
    handler?.(error);
  }

  private resetStats(): void {
    this.inference.clear();
    this.turnaround.clear();
    this.resultAge.clear();
    this.rate.clear();
    this.counts = { submitted: 0, skippedBusy: 0, stale: 0, failedFrames: 0 };
    this.delegate = null;
  }
}
