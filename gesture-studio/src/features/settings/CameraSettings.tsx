import { useEffect, useState, useSyncExternalStore } from "react";
import type { DelegateMeasurement, HandControl } from "../../app/handControl";
import { CameraSession } from "../../runtime/camera/cameraSession";

const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(0)} ms`);

/** Camera & calibration settings group (DESIGN_SYSTEM.md §3). */
export function CameraSettings({ handControl, open }: { handControl: HandControl; open: boolean }) {
  const snap = useSyncExternalStore(
    (notify) => handControl.subscribe(() => notify()),
    () => handControl.snapshot(),
  );
  const [cameras, setCameras] = useState<{ deviceId: string; label: string }[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const [measurements, setMeasurements] = useState<DelegateMeasurement[] | null>(null);
  const [stats, setStats] = useState(() => handControl.stats());
  const cameraOn = snap.phase !== "off" && snap.phase !== "error" && snap.phase !== "starting";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    CameraSession.listCameras().then((list) => !cancelled && setCameras(list), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, snap.phase]);

  useEffect(() => {
    if (!open || !cameraOn) return;
    const id = setInterval(() => setStats(handControl.stats()), 1000);
    return () => clearInterval(id);
  }, [open, cameraOn, handControl]);

  const measure = async () => {
    setMeasuring(true);
    setMeasurements(await handControl.measureDelegates());
    setMeasuring(false);
  };

  const profile = snap.calibration.status === "ready" ? snap.calibration.profile : null;

  return (
    <>
      <dl className="facts">
        <dt>Camera</dt>
        <dd>{snap.camera ? `${snap.camera.label} · ${snap.camera.width}×${snap.camera.height}${snap.camera.frameRate ? ` at ${Math.round(snap.camera.frameRate)} fps` : ""}` : "Off"}</dd>
        <dt>Tracking runs on</dt>
        <dd>{snap.delegate ?? "—"}</dd>
        <dt>Calibration</dt>
        <dd>
          {profile
            ? `Saved ${new Date(profile.createdAt).toLocaleString()}${profile.recommendedTempoBpm ? ` · suggested starting tempo ${profile.recommendedTempoBpm} BPM` : ""}`
            : snap.calibration.status === "unknown" ? "Turn the camera on to check" : "Not calibrated for this camera"}
        </dd>
      </dl>

      {cameras.length > 1 && (
        <label className="field">
          <span>Camera to use</span>
          <select
            value={snap.camera?.deviceId ?? ""}
            onChange={(e) => void handControl.start(e.target.value)}
            disabled={measuring}
          >
            {!snap.camera && <option value="">Choose a camera</option>}
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="camera-panel__actions">
        {cameraOn ? (
          <>
            <button type="button" className="button" onClick={() => handControl.beginCalibration()} disabled={measuring}>
              Recalibrate
            </button>
            <button type="button" className="button" onClick={() => void measure()} disabled={measuring}>
              {measuring ? "Measuring… keep your hands in view" : "Measure tracking speed"}
            </button>
          </>
        ) : (
          <p className="muted">Turn the camera on in Play to calibrate or measure tracking speed.</p>
        )}
      </div>

      {measurements && (
        <>
          <h4>Tracking speed on this computer</h4>
          <table className="diag-table">
            <thead>
              <tr>
                <th scope="col">Runs on</th>
                <th scope="col">Result</th>
                <th scope="col">Frame to result, median</th>
                <th scope="col">95th percentile</th>
                <th scope="col">Results per second</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((m) => (
                <tr key={m.delegate}>
                  <td>{m.delegate}</td>
                  <td>{m.ok ? "Worked" : `Failed: ${m.message ?? "unknown"}`}</td>
                  <td>{ms(m.turnaroundP50Ms)}</td>
                  <td>{ms(m.turnaroundP95Ms)}</td>
                  <td>{m.inferenceRate.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Vybe now uses the faster working option. These are software timings on this computer, not the full pinch-to-sound time.</p>
        </>
      )}

      {cameraOn && stats && (
        <>
          <h4>Live tracking</h4>
          <dl className="facts">
            <dt>Camera frames</dt>
            <dd className="data">{stats.deliveryRate.toFixed(1)} per second</dd>
            <dt>Tracking results</dt>
            <dd className="data">{stats.inferenceRate.toFixed(1)} per second</dd>
            <dt>Inference time</dt>
            <dd className="data">median {ms(stats.inferenceMs?.p50)} · 95th {ms(stats.inferenceMs?.p95)}</dd>
            <dt>Frame to result</dt>
            <dd className="data">median {ms(stats.turnaroundMs?.p50)} · 95th {ms(stats.turnaroundMs?.p95)}</dd>
            <dt>Frame to note sent</dt>
            <dd className="data">median {ms(stats.frameToDispatchMs?.p50)} · 95th {ms(stats.frameToDispatchMs?.p95)}</dd>
            <dt>Discarded as stale</dt>
            <dd className="data">{stats.stale}</dd>
            <dt>Skipped while busy</dt>
            <dd className="data">{stats.skippedBusy}</dd>
          </dl>
          {stats.deliveryRate > 0 && stats.deliveryRate < 25 && (snap.camera?.frameRate ?? 30) >= 25 && (
            <p className="notice notice--warning" role="status">
              <span aria-hidden="true">▲ </span>
              The camera is sending {stats.deliveryRate.toFixed(0)} frames per second instead of {Math.round(snap.camera?.frameRate ?? 30)}. This usually
              means the room is dim. More light on your hands makes hand control respond sooner.
            </p>
          )}
          <p className="muted">Component measurements in the browser. They do not measure camera exposure or sound output.</p>
        </>
      )}
    </>
  );
}
