import { fail, ok, type Result } from "../../domain/result";

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
