import { useEffect, useRef } from "react";
import type { HandControl } from "../../app/handControl";

/**
 * Places the tracking source's <video> in the page, mirrored, letterboxed
 * (object-fit: contain, never cropped) so the overlay uses the same transform
 * as hit testing. Palm markers are drawn without React state.
 */
export function CameraPreview({ video, handControl, className }: { video: HTMLVideoElement; handControl: HandControl; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.prepend(video);
    return () => {
      if (video.parentElement === el) el.removeChild(video);
    };
  }, [video]);

  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas) return;
    let frame = 0;
    let latest: Parameters<Parameters<HandControl["onPreview"]>[0]>[0] | null = null;
    const draw = () => {
      frame = 0;
      const ctx = canvas.getContext("2d");
      if (!ctx || !latest) return;
      const { clientWidth: cw, clientHeight: ch } = canvas;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.clearRect(0, 0, cw, ch);
      // Same letterbox as object-fit: contain.
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const scale = Math.min(cw / vw, ch / vh);
      const w = vw * scale;
      const h = vh * scale;
      const ox = (cw - w) / 2;
      const oy = (ch - h) / 2;
      for (const p of latest.palms) {
        ctx.beginPath();
        ctx.arc(ox + p.x * w, oy + p.y * h, 9, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#f2f0e8";
        ctx.stroke();
      }
    };
    const unsubscribe = handControl.onPreview((p) => {
      latest = p;
      if (!frame) frame = requestAnimationFrame(draw);
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [handControl, video]);

  return (
    <div className={`camera-preview ${className ?? ""}`} ref={host}>
      <canvas className="camera-preview__overlay" ref={overlay} aria-hidden="true" />
    </div>
  );
}
