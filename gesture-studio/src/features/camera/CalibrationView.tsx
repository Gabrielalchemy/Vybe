import { useEffect, useRef } from "react";
import type { HandControl, HandControlSnapshot } from "../../app/handControl";
import { CameraPreview } from "./CameraPreview";

const stepsFor = (trigger: "flick" | "pinch") =>
  [
    { kind: "identify", label: "Identify hands" },
    { kind: "reach", label: "Comfortable reach" },
    trigger === "flick" ? { kind: "flick", label: "Flick examples" } : { kind: "pinch", label: "Pinch examples" },
    { kind: "pace", label: "Comfortable pace" },
  ] as const;

/** Calibration workspace: large mirrored feed, one instruction at a time, real progress. */
export function CalibrationView({ handControl, snapshot, video }: { handControl: HandControl; snapshot: HandControlSnapshot; video: HTMLVideoElement }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const wizard = snapshot.wizard;
  const step = wizard?.step;
  const STEPS = stepsFor(snapshot.trigger);
  const currentIndex = step ? STEPS.findIndex((s) => s.kind === step.kind) : -1;

  useEffect(() => heading.current?.focus(), []);

  return (
    <section className="calibration" aria-labelledby="calibration-title">
      <div className="calibration__feed">
        <CameraPreview video={video} handControl={handControl} className="camera-preview--large" />
      </div>
      <div className="calibration__side">
        <h1 id="calibration-title" className="workspace-title" tabIndex={-1} ref={heading}>
          Calibrate hands
        </h1>
        <ol className="calibration__steps">
          {STEPS.map((s, i) => (
            <li key={s.kind} aria-current={i === currentIndex ? "step" : undefined} className={i < currentIndex ? "is-done" : ""}>
              <span aria-hidden="true">{i < currentIndex ? "✓" : i === currentIndex ? "●" : "○"} </span>
              {s.label}
            </li>
          ))}
        </ol>

        {step?.kind === "failed" ? (
          <div className="notice notice--warning" role="alert">
            <span aria-hidden="true">▲ </span>
            {step.error.message}
          </div>
        ) : (
          <p className="calibration__instruction" aria-live="polite">
            {wizard?.instruction}
          </p>
        )}

        {step && step.kind !== "failed" && (
          <div className="progress" role="progressbar" aria-label="Step progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((wizard?.progress ?? 0) * 100)}>
            <div className="progress__fill" style={{ width: `${(wizard?.progress ?? 0) * 100}%` }} />
          </div>
        )}

        <p className="muted">Only the measurements are saved: reach areas, {snapshot.trigger === "flick" ? "flick" : "pinch"} thresholds and a tempo suggestion. No images or hand recordings are stored.</p>

        <div className="camera-panel__actions">
          {step?.kind === "failed" && (
            <button type="button" className="button button--primary" onClick={() => handControl.retryCalibrationStep()}>
              Try this step again
            </button>
          )}
          {step?.kind === "pace" && (
            <button type="button" className="button" onClick={() => handControl.skipPace()}>
              Skip this step
            </button>
          )}
          <button type="button" className="button" onClick={() => handControl.cancelCalibration()}>
            Cancel calibration
          </button>
        </div>
      </div>
    </section>
  );
}
