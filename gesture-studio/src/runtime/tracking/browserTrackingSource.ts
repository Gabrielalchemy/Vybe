import type { SourceError, SourceInfo, SourceStart, TrackingSource } from "../../app/handControl";
import { fail, ok, type Result } from "../../domain/result";
import { RateMeter } from "../../domain/tracking/rollingStats";
import { CameraSession } from "../camera/cameraSession";
import { FramePump, PROCESSING_LONG_EDGE_PX, processingSize } from "../camera/framePump";
import { TrackingClient, loadTrackerAssets, type FrameResult, type TrackerAssets, type TrackerStats } from "./trackingClient";

/**
 * Real camera + vision worker. Owns one <video> element that the UI may place
 * in the page for preview. Frames are resized to a 640 px long edge and sent
 * only when the worker is idle; there is no frame queue.
 */
export class BrowserTrackingSource implements TrackingSource {
  readonly video: HTMLVideoElement;
  private readonly camera = new CameraSession();
  private readonly pump = new FramePump();
  private readonly client = new TrackingClient();
  private readonly delivery = new RateMeter(2000);
  private assets: (TrackerAssets & { modelBytes: ArrayBuffer }) | null = null;
  private generation = 0;

  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute("aria-label", "Camera preview");
    this.video.className = "camera-preview__video";
  }

  async start(
    opts: SourceStart,
    handlers: { onFrame: (r: FrameResult) => void; onFailure: (e: SourceError) => void },
  ): Promise<Result<SourceInfo, SourceError>> {
    this.stop();
    const generation = ++this.generation;
    if (!this.assets) {
      const loaded = await loadTrackerAssets();
      if (!loaded.ok) return fail(loaded.error);
      this.assets = loaded.value;
    }
    const assets = this.assets;
    const tracker = await this.client.start(opts.delegate, assets, { onResult: handlers.onFrame, onFailure: handlers.onFailure });
    if (generation !== this.generation) return fail({ code: "superseded", message: "Camera start was cancelled." });
    if (!tracker.ok) return fail(tracker.error);

    const cam = await this.camera.start(this.video, opts.deviceId, () => {
      this.stop();
      handlers.onFailure({ code: "camera-ended", message: "The camera disconnected. Reconnect it and turn the camera on again." });
    });
    if (generation !== this.generation) return fail({ code: "superseded", message: "Camera start was cancelled." });
    if (!cam.ok) {
      this.client.stop();
      return fail(cam.error);
    }
    const size = processingSize(cam.value.width, cam.value.height);
    this.delivery.clear();
    this.pump.start(this.video, (deliveredAtMs) => {
      this.delivery.mark(deliveredAtMs);
      if (!this.client.idle()) return;
      createImageBitmap(this.video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "low" }).then(
        (bitmap) => {
          if (generation !== this.generation) bitmap.close();
          else this.client.submit(bitmap, deliveredAtMs);
        },
        () => undefined, // A frame that cannot be captured is skipped; the watchdog covers persistent failure.
      );
    });
    return ok({
      camera: cam.value,
      delegate: tracker.value,
      modelSha256: assets.model.sha256,
      processing: { ...size, longEdgePx: PROCESSING_LONG_EDGE_PX },
    });
  }

  /** Idempotent: stops the pump, camera tracks and worker. */
  stop(): void {
    this.generation += 1;
    this.pump.stop();
    this.camera.stop(this.video);
    this.client.stop();
  }

  setSteadyFrameRate(on: boolean): Promise<Result<void, string>> {
    return on ? this.camera.setSteadyFrameRate() : this.camera.setAutomaticExposure();
  }

  /** Hung-worker watchdog; HandControl calls this on its timer. */
  check(nowMs: number): void {
    this.client.check(nowMs);
  }

  stats(nowMs: number): TrackerStats & { deliveryRate: number; exposure: { mode: string | null; timeMs: number | null }; brightness: number | null } {
    return {
      ...this.client.stats(nowMs),
      deliveryRate: this.delivery.perSecond(nowMs),
      exposure: this.camera.exposure(),
      brightness: this.camera.brightness(this.video),
    };
  }
}
