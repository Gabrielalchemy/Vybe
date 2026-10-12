import type { LiveSource, PerformanceEvent } from "../domain/events";
import { createAssetLoader } from "../runtime/assets/assetLoader";
import { loadManifest } from "../runtime/assets/manifest";
import { AudioEngine } from "../runtime/audio/audioEngine";
import { DECODED_BUDGET_BYTES, loadGrandPiano } from "../runtime/audio/pianoBank";
import type { AudioLeaseTarget } from "./handControl";
import type { PerformanceSink } from "./sessionController";

export type AudioStatus = "off" | "starting" | "loading" | "ready" | "error" | "interrupted";

export interface AudioSnapshot {
  status: AudioStatus;
  instrumentLabel: string;
  loaded: number;
  total: number;
  error: string | null;
  sampleRate: number | null;
  /** Browser-reported latencies: estimates, not measurements. */
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  decodedMb: number;
}

export interface AudioRuntimeDeps {
  /** Unexpected suspension while playing: the session must pause and release. */
  onInterrupted: () => void;
  /** The engine cut a sounding voice at the voice limit. */
  onVoiceStolen: (voiceId: string) => void;
}

/**
 * The one AudioContext, created only from a user action. Owns the engine and
 * the live instrument; acts as the session's performance sink and as the
 * lease target for camera lanes.
 */
export class AudioRuntime implements PerformanceSink, AudioLeaseTarget {
  private ctx: AudioContext | null = null;
  private engine: AudioEngine | null = null;
  private status: AudioStatus = "off";
  private loaded = 0;
  private total = 0;
  private error: string | null = null;
  private decodedBytes = 0;
  private instrumentReady = false;
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<(s: AudioSnapshot) => void>();
  private current: AudioSnapshot;
  private readonly deps: AudioRuntimeDeps;

  constructor(deps: AudioRuntimeDeps) {
    this.deps = deps;
    this.current = this.build();
  }

  snapshot(): AudioSnapshot {
    return this.current;
  }

  subscribe(listener: (s: AudioSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Must be called from a user gesture (click/key). Idempotent. */
  async start(): Promise<void> {
    if (!this.ctx) {
      this.status = "starting";
      this.publish();
      try {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      } catch (error) {
        this.status = "error";
        this.error = `Sound could not start (${error instanceof Error ? error.message : String(error)}).`;
        this.publish();
        return;
      }
      this.engine = new AudioEngine(this.ctx, { instrument: null, onVoiceStolen: (id) => this.deps.onVoiceStolen(id) });
      this.ctx.addEventListener("statechange", this.onStateChange);
    }
    try {
      await this.ctx.resume();
    } catch {
      // Reported through the state below.
    }
    if (this.ctx.state !== "running") {
      this.status = "interrupted";
      this.publish();
      return;
    }
    if (!this.instrumentReady) await this.loadInstrument();
    else {
      this.status = "ready";
      this.publish();
    }
  }

  /** Retry after a failed sample load. */
  retryLoading(): Promise<void> {
    this.error = null;
    return this.start();
  }

  nowSec(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  soundReady(): boolean {
    return this.status === "ready";
  }

  dispatch(events: readonly PerformanceEvent[]): void {
    this.engine?.dispatch(events);
  }

  /** Stop all: also cuts decaying tails. */
  panic(): void {
    this.engine?.panic();
  }

  activeVoices(): number {
    return this.engine?.activeVoiceCount() ?? 0;
  }

  stolenVoices(): number {
    return this.engine?.stolenCount ?? 0;
  }

  // AudioLeaseTarget
  setLeaseMode(source: LiveSource, mode: "camera" | "off"): void {
    this.engine?.setLeaseMode(source, mode);
  }
  renewLease(source: LiveSource, observationSec: number): unknown {
    return this.engine?.renewLease(source, observationSec);
  }
  leaseExpired(source: LiveSource): boolean {
    return this.engine?.leaseExpired(source) ?? false;
  }
  retireLane(source: LiveSource): unknown {
    return this.engine?.retireLane(source);
  }
  audioTimeAt(perfMs: number): number {
    if (!this.ctx) return perfMs / 1000;
    return this.ctx.currentTime - (performance.now() - perfMs) / 1000;
  }

  /** Idempotent teardown (development hot reload). */
  async dispose(): Promise<void> {
    this.engine?.dispose();
    this.engine = null;
    if (this.ctx) {
      this.ctx.removeEventListener("statechange", this.onStateChange);
      await this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.status = "off";
    this.instrumentReady = false;
    this.publish();
  }

  private async loadInstrument(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.ctx;
    if (!ctx) return;
    this.loading = (async () => {
      this.status = "loading";
      this.error = null;
      this.publish();
      const manifest = await loadManifest();
      if (!manifest.ok) {
        this.failLoad(`Grand piano samples did not load (${manifest.error}). Retry loading.`);
        return;
      }
      const loader = createAssetLoader({ baseUrl: "/assets/", fetch: (input, init) => fetch(input, init) });
      const result = await loadGrandPiano(ctx, manifest.value, loader, {
        budgetAvailableBytes: DECODED_BUDGET_BYTES,
        onProgress: (loaded, total) => {
          this.loaded = loaded;
          this.total = total;
          this.publish();
        },
      });
      if (!result.ok) {
        this.failLoad(result.error.message);
        return;
      }
      this.decodedBytes = result.value.decodedBytes;
      this.engine?.setInstrument(result.value.voices);
      this.instrumentReady = true;
      this.status = ctx.state === "running" ? "ready" : "interrupted";
      this.publish();
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private failLoad(message: string): void {
    this.engine?.setInstrument(null);
    this.instrumentReady = false;
    this.status = "error";
    this.error = message;
    this.publish();
  }

  private readonly onStateChange = () => {
    const state = this.ctx?.state;
    if (state === "running") {
      if (this.status === "interrupted" && this.instrumentReady) {
        this.status = "ready";
        this.publish();
      }
      return;
    }
    if (this.status === "ready" || this.status === "loading") {
      this.status = "interrupted";
      this.publish();
      this.deps.onInterrupted();
    }
  };

  private build(): AudioSnapshot {
    return Object.freeze({
      status: this.status,
      instrumentLabel: "Grand piano",
      loaded: this.loaded,
      total: this.total,
      error: this.error,
      sampleRate: this.ctx?.sampleRate ?? null,
      baseLatencyMs: this.ctx ? this.ctx.baseLatency * 1000 : null,
      outputLatencyMs: this.ctx && "outputLatency" in this.ctx ? this.ctx.outputLatency * 1000 : null,
      decodedMb: this.decodedBytes / 2 ** 20,
    });
  }

  private publish(): void {
    this.current = this.build();
    for (const l of this.listeners) {
      try {
        l(this.current);
      } catch (error) {
        console.error("Audio listener failed", error);
      }
    }
  }
}
