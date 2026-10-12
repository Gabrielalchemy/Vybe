import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppRuntime } from "../../app/runtime";
import type { SessionSnapshot } from "../../app/sessionController";
import { pitchName } from "../../domain/pitch";
import { SimulatorPanel } from "../dev/SimulatorPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  runtime: AppRuntime;
  snapshot: SessionSnapshot;
}

type Persistence = "unknown" | "unsupported" | "granted" | "not-granted";

export function SettingsDialog({ open, onClose, runtime, snapshot }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const supported = typeof navigator.storage?.persisted === "function";
  const [checked, setChecked] = useState<Exclude<Persistence, "unsupported"> | "error">("unknown");
  const persistence: Persistence = !supported || checked === "error" ? "unsupported" : checked;
  const [persistMessage, setPersistMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !supported) return;
    navigator.storage.persisted().then(
      (granted) => setChecked(granted ? "granted" : "not-granted"),
      () => setChecked("error"),
    );
  }, [open, supported]);

  const requestPersistence = async () => {
    try {
      const granted = await navigator.storage.persist();
      setChecked(granted ? "granted" : "not-granted");
      setPersistMessage(granted ? "The browser will keep Vybe's data unless you clear it yourself." : "The browser declined. Your projects are still saved, but keep backups.");
    } catch {
      setPersistMessage("The browser could not answer this request.");
    }
  };

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="settings-title" onClose={onClose}>
      <header className="dialog__header">
        <h2 id="settings-title" className="dialog__title">Settings</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="dialog__body">
        <section className="settings-group" aria-labelledby="sg-camera">
          <h3 id="sg-camera">Camera &amp; calibration</h3>
          <p>Hand control is not available in this build yet. Play with the keyboard or pointer.</p>
        </section>
        <section className="settings-group" aria-labelledby="sg-playing">
          <h3 id="sg-playing">Playing</h3>
          <dl className="facts">
            <dt>Melody octave</dt>
            <dd className="data">{pitchName(12 * (snapshot.melodyOctave + 1))}</dd>
            <dt>Note strength</dt>
            <dd>Medium (80 of 127)</dd>
            <dt>Sustain</dt>
            <dd>Hold Left Shift</dd>
          </dl>
        </section>
        <section className="settings-group" aria-labelledby="sg-audio">
          <h3 id="sg-audio">Audio</h3>
          <p>Sound is not available in this build yet. Pads show what would sound; nothing plays.</p>
        </section>
        <section className="settings-group" aria-labelledby="sg-storage">
          <h3 id="sg-storage">Storage</h3>
          <p>
            Persistent storage:{" "}
            <strong>
              {persistence === "granted" ? "Granted" : persistence === "not-granted" ? "Not granted" : persistence === "unsupported" ? "Not supported" : "Checking…"}
            </strong>
          </p>
          <p className="muted">Persistent storage helps the browser keep your projects. It is not a backup.</p>
          {persistence === "not-granted" && (
            <button type="button" className="button" onClick={requestPersistence}>
              Request persistent storage
            </button>
          )}
          {persistMessage && <p role="status">{persistMessage}</p>}
        </section>
        <section className="settings-group" aria-labelledby="sg-diagnostics">
          <h3 id="sg-diagnostics">Diagnostics</h3>
          <Diagnostics runtime={runtime} snapshot={snapshot} />
          {import.meta.env.DEV && <SimulatorPanel session={runtime.session} />}
        </section>
      </div>
    </dialog>
  );
}

function Diagnostics({ runtime, snapshot }: { runtime: AppRuntime; snapshot: SessionSnapshot }) {
  const events = useSyncExternalStore(
    (notify) => runtime.eventLog.subscribe(notify),
    () => runtime.eventLog.recent(),
  );
  const recent = snapshot.recentOutcomes.slice(-12).reverse();
  return (
    <>
      <p className="muted">
        Times use the session clock ({runtime.clock}); there is no audio clock in this build. Configuration revision{" "}
        <span className="data">{snapshot.configurationRevision}</span>.
      </p>
      <h4>Recent input</h4>
      {recent.length === 0 ? (
        <p className="muted">No input yet.</p>
      ) : (
        <table className="diag-table">
          <thead>
            <tr>
              <th scope="col">Hand</th>
              <th scope="col">Input</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((o, i) => (
              <tr key={`${o.atMs}-${i}`}>
                <td>{o.hand}</td>
                <td>{o.input}</td>
                <td>{o.action}</td>
                <td className="data">{o.targetId ?? "—"}</td>
                <td>
                  {o.status}
                  {o.detail ? ` (${o.detail})` : ""}
                  {o.notes.length ? ` ${o.notes.map((n) => pitchName(n)).join(" ")}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">
        Performance events recorded: <span className="data">{events.length}</span> (most recent 200 kept in memory).
      </p>
    </>
  );
}
