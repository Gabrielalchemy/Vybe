import { useEffect, useRef, useState } from "react";
import type { SessionController } from "../../app/sessionController";
import { SIMULATION_SCRIPTS, playSimulation, type SimulationScriptId } from "../../app/simulator";

/** Development-only: replays scripted input through the live pipeline. Not camera evidence. */
export function SimulatorPanel({ session }: { session: SessionController }) {
  const [running, setRunning] = useState<SimulationScriptId | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => () => cancel.current?.(), []);

  const run = (id: SimulationScriptId) => {
    cancel.current?.();
    setRunning(id);
    cancel.current = playSimulation(session, SIMULATION_SCRIPTS[id], () => {
      cancel.current = null;
      setRunning(null);
    });
  };

  return (
    <div className="simulator">
      <h4>Simulated input (development build only)</h4>
      <p className="muted">Scripts drive the same path as keyboard and pointer input. They do not test the camera.</p>
      <ul className="simulator__list">
        {(Object.keys(SIMULATION_SCRIPTS) as SimulationScriptId[]).map((id) => (
          <li key={id}>
            <button type="button" className="button" onClick={() => run(id)} disabled={running !== null}>
              {SIMULATION_SCRIPTS[id].title}
            </button>
            <span className="muted"> {SIMULATION_SCRIPTS[id].description}</span>
          </li>
        ))}
      </ul>
      {running && (
        <p role="status">
          Running “{SIMULATION_SCRIPTS[running].title}”.{" "}
          <button
            type="button"
            className="button"
            onClick={() => {
              cancel.current?.();
              cancel.current = null;
              setRunning(null);
            }}
          >
            Cancel
          </button>
        </p>
      )}
    </div>
  );
}
