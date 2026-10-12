import type { HandControl, HandControlSnapshot } from "../../app/handControl";
import { CameraPreview } from "./CameraPreview";

const REASON_TEXT: Record<string, string> = {
  version: "it was made by an older version",
  camera: "a different camera is in use",
  aspect: "the camera picture has a different shape",
  mirroring: "the mirroring setting changed",
  processing: "the tracking resolution changed",
  model: "the hand-tracking model changed",
};

/** Camera inset and hand-control actions for the Play workspace (DESIGN_SYSTEM.md §3). */
export function CameraPanel({ handControl, snapshot, video }: { handControl: HandControl; snapshot: HandControlSnapshot; video: HTMLVideoElement }) {
  const { phase } = snapshot;
  const cameraOn = phase !== "off" && phase !== "error" && phase !== "starting";
  return (
    <section className="panel camera-panel" aria-labelledby="camera-panel-title">
      <div className="camera-panel__head">
        <h2 id="camera-panel-title" className="panel__title">Hand control</h2>
        {cameraOn || phase === "starting" ? (
          <button type="button" className="button" onClick={() => handControl.stop()}>
            Camera off
          </button>
        ) : (
          <button type="button" className="button button--primary" onClick={() => void handControl.start(null)}>
            {phase === "error" ? "Try camera again" : "Camera on"}
          </button>
        )}
      </div>

      <div className="camera-panel__body">
      {cameraOn && <CameraPreview video={video} handControl={handControl} className="camera-preview--inset" />}
      <div className="camera-panel__content">
      {phase === "off" && <p className="muted">The camera is off. Turn it on to play with your hands, or keep using the keyboard.</p>}
      {phase === "starting" && <p role="status">Starting the camera and hand tracking…</p>}
      {phase === "error" && snapshot.error && (
        <p className="notice notice--danger" role="alert">
          <span aria-hidden="true">✕ </span>
          {snapshot.error.message}
        </p>
      )}

      {phase === "needs-calibration" && (
        <>
          <p>
            {snapshot.calibration.status === "incompatible"
              ? `Recalibrate: ${snapshot.calibration.reasons.map((r) => REASON_TEXT[r] ?? r).join(", ")}.`
              : snapshot.calibration.status === "unreadable"
                ? `The saved calibration could not be used. Calibrate again.`
                : "Calibrate once so Vybe learns your reach and pinch. It takes about a minute."}
          </p>
          <button type="button" className="button button--primary" onClick={() => handControl.beginCalibration()}>
            Calibrate hands
          </button>
        </>
      )}

      {phase === "readiness" && (
        <>
          <p>Hold both hands open over their areas.</p>
          <ul className="readiness" aria-label="Readiness check">
            <li className={snapshot.readiness.left ? "is-ok" : ""}>
              <span aria-hidden="true">{snapshot.readiness.left ? "✓" : "○"} </span>Left hand {snapshot.readiness.left ? "ready" : "not seen open yet"}
            </li>
            <li className={snapshot.readiness.right ? "is-ok" : ""}>
              <span aria-hidden="true">{snapshot.readiness.right ? "✓" : "○"} </span>Right hand {snapshot.readiness.right ? "ready" : "not seen open yet"}
            </li>
          </ul>
          <div className="camera-panel__actions">
            <button type="button" className="button button--primary" onClick={() => handControl.startPlaying()} disabled={!snapshot.readiness.left && !snapshot.readiness.right}>
              Start playing
            </button>
            <button type="button" className="button" onClick={() => handControl.beginCalibration()}>
              Recalibrate
            </button>
          </div>
        </>
      )}

      {phase === "active" && (
        <div className="camera-panel__actions">
          <p role="status">Hand control is on. Pinch to play; move to the bottom strip to rest.</p>
          <button type="button" className="button" onClick={() => handControl.pausePlaying()}>
            Pause hand control
          </button>
        </div>
      )}

      </div>
      </div>

      {snapshot.notice && (
        <p className="notice notice--warning" role="status">
          <span aria-hidden="true">▲ </span>
          {snapshot.notice}
        </p>
      )}

      {snapshot.saveError && (
        <p className="notice notice--warning" role="alert">
          <span aria-hidden="true">▲ </span>The calibration works for now but was not saved: {snapshot.saveError.message}
        </p>
      )}
    </section>
  );
}
