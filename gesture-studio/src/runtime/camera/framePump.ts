/** Long edge of the frame sent to inference (initial benchmark configuration). */
export const PROCESSING_LONG_EDGE_PX = 640;

export function processingSize(width: number, height: number): { width: number; height: number } {
  const scale = PROCESSING_LONG_EDGE_PX / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Delivers each new video frame once. Uses requestVideoFrameCallback, falling
 * back to animation frames that check the video time so a frame is never
 * submitted twice. There is no frame queue: the consumer decides to skip.
 */
export class FramePump {
  private video: HTMLVideoElement | null = null;
  private mode: "rvfc" | "raf" = "raf";
  private handle = 0;
  private lastTime = -1;

  start(video: HTMLVideoElement, onFrame: (deliveredAtMs: number) => void): void {
    this.stop();
    this.video = video;
    this.mode = typeof video.requestVideoFrameCallback === "function" ? "rvfc" : "raf";
    this.lastTime = -1;
    const schedule = () => {
      this.handle = this.mode === "rvfc" ? video.requestVideoFrameCallback(step) : requestAnimationFrame(step);
    };
    const step = () => {
      if (this.video !== video) return;
      if (this.mode === "rvfc" || video.currentTime !== this.lastTime) {
        this.lastTime = video.currentTime;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onFrame(performance.now());
      }
      schedule();
    };
    schedule();
  }

  stop(): void {
    const video = this.video;
    if (!video) return;
    this.video = null;
    if (this.mode === "rvfc") video.cancelVideoFrameCallback(this.handle);
    else cancelAnimationFrame(this.handle);
  }
}
