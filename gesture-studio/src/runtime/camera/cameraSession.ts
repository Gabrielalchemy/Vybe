import { fail, ok, type Result } from "../../domain/result";
import { steadyFrameRateConstraints, type ExposureCapabilities } from "../../domain/tracking/exposure";

export type CameraErrorCode = "denied" | "in-use" | "not-found" | "unsupported" | "insecure" | "unknown";

export interface CameraError {
  code: CameraErrorCode;
  message: string;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
  width: number;
  height: number;
  frameRate: number | null;
}

/** DESIGN_SYSTEM.md §7 copy for each failure. */
function toCameraError(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { code: "denied", message: "Camera access is off. Allow access to use hand control, or continue with the keyboard." };
    case "NotReadableError":
    case "AbortError":
      return { code: "in-use", message: "The camera could not start. Close another camera app and try again." };
    case "NotFoundError":
    case "OverconstrainedError":
      return { code: "not-found", message: "No camera was found. Connect a camera and try again, or continue with the keyboard." };
    default:
      return { code: "unknown", message: `The camera could not start (${error instanceof Error ? error.message : String(error)}). Try again.` };
  }
}

/**
 * Owns one video-only MediaStream. Never requests audio. Reads the negotiated
 * settings rather than assuming the requested ones were granted.
 */
export class CameraSession {
  private stream: MediaStream | null = null;
  private probe: OffscreenCanvas | null = null;
  private endedListener: (() => void) | null = null;

  static async listCameras(): Promise<{ deviceId: string; label: string }[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async start(video: HTMLVideoElement, deviceId: string | null, onEnded: () => void): Promise<Result<CameraInfo, CameraError>> {
    this.stop(video);
    if (!window.isSecureContext) return fail({ code: "insecure", message: "Open Vybe at http://localhost:4173 to use the camera." });
    if (!navigator.mediaDevices?.getUserMedia) return fail({ code: "unsupported", message: "This browser cannot use a camera." });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (error) {
      return fail(toCameraError(error));
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return fail({ code: "not-found", message: "The camera did not provide video. Try another camera." });
    }
    this.stream = stream;
    this.endedListener = onEnded;
    track.addEventListener("ended", this.handleEnded);
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch (error) {
      this.stop(video);
      return fail(toCameraError(error));
    }
    const s = track.getSettings();
    return ok({
      deviceId: s.deviceId ?? deviceId ?? "default",
      label: track.label || "Camera",
      width: s.width ?? video.videoWidth,
      height: s.height ?? video.videoHeight,
      frameRate: s.frameRate ?? null,
    });
  }

  /**
   * Steady frame rate: manual exposure capped at one frame period (Image Capture
   * constraints, applied to this stream only). There is no "off": Chrome keeps
   * manual exposure on a running stream, so callers restart the stream instead.
   */
  async setSteadyFrameRate(fps = 30): Promise<Result<void, string>> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return fail("Turn the camera on first.");
    const caps = (track.getCapabilities?.() ?? {}) as unknown as ExposureCapabilities;
    // Image Capture constraint members are not in TypeScript's DOM types.
    const constraintSet = (c: Record<string, unknown>) => ({ advanced: [c] }) as unknown as MediaTrackConstraints;
    try {
      const wanted = steadyFrameRateConstraints(caps, fps);
      if (!wanted.ok) return wanted;
      await track.applyConstraints(constraintSet({ ...wanted.value }));
      return ok(undefined);
    } catch (error) {
      return fail(`The camera refused the exposure setting (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  /**
   * Automatic exposure, applied explicitly: webcams keep a manual exposure set
   * by an earlier session until something changes it back.
   */
  async setAutomaticExposure(): Promise<Result<void, string>> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return fail("Turn the camera on first.");
    const caps = (track.getCapabilities?.() ?? {}) as unknown as ExposureCapabilities;
    if (!caps.exposureMode?.includes("continuous")) return ok(undefined);
    try {
      await track.applyConstraints({ advanced: [{ exposureMode: "continuous" }] } as unknown as MediaTrackConstraints);
      return ok(undefined);
    } catch (error) {
      return fail(`The camera refused automatic exposure (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  /** Mean brightness 0..1 of the current frame, from a tiny downscaled copy; null if unavailable. */
  brightness(video: HTMLVideoElement): number | null {
    if (!this.stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    this.probe ??= new OffscreenCanvas(16, 9);
    const ctx = this.probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 16, 9);
    const px = ctx.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    for (let i = 0; i + 2 < px.length; i += 4) sum += 0.2126 * (px[i] ?? 0) + 0.7152 * (px[i + 1] ?? 0) + 0.0722 * (px[i + 2] ?? 0);
    return sum / (px.length / 4) / 255;
  }

  /** Current exposure as reported by the camera (Image Capture settings), if any. */
  exposure(): { mode: string | null; timeMs: number | null } {
    const s = this.stream?.getVideoTracks()[0]?.getSettings() as Record<string, unknown> | undefined;
    const mode = typeof s?.["exposureMode"] === "string" ? (s["exposureMode"] as string) : null;
    const time = typeof s?.["exposureTime"] === "number" ? (s["exposureTime"] as number) / 10 : null; // 100 µs units -> ms
    return { mode, timeMs: time };
  }

  /** Idempotent: stops every track and detaches the stream. */
  stop(video?: HTMLVideoElement): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.removeEventListener("ended", this.handleEnded);
        t.stop();
      }
    }
    this.stream = null;
    this.endedListener = null;
    if (video) video.srcObject = null;
  }

  private readonly handleEnded = () => {
    const listener = this.endedListener;
    this.stream = null;
    listener?.();
  };
}
