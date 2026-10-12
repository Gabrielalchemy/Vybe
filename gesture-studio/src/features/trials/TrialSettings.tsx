import { useState, useSyncExternalStore } from "react";
import type { TrialController } from "../../app/trialController";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** Settings → Diagnostics: run gate trials, see cumulative totals, export evidence. */
export function TrialSettings({ trials, onStarted }: { trials: TrialController; onStarted: () => void }) {
  const snap = useSyncExternalStore(
    (notify) => trials.subscribe(() => notify()),
    () => trials.snapshot(),
  );
  const [conditions, setConditions] = useState("");
  const [attempts, setAttempts] = useState(100);
  const t = snap.totals;

  const startAccuracy = () => {
    trials.startAccuracy({ attempts, conditions });
    if (trials.snapshot().running) onStarted();
  };
  const startNeutral = () => {
    trials.startNeutral({ durationMs: 5 * 60_000, conditions });
    if (trials.snapshot().running) onStarted();
  };
  const exportResults = () => {
    const url = URL.createObjectURL(new Blob([trials.exportJson()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vybe-instrument-trials-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="trials">
      <h4>Instrument trials</h4>
      <p className="muted">
        Camera pinches only. Each accuracy attempt records the prompted and the played target; finished sessions are saved on this computer.
        Stopping early saves nothing.
      </p>
      <label className="field">
        <span>Conditions (lighting, speakers, posture)</span>
        <input type="text" value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Desk lamp in front, built-in speakers" />
      </label>
      <div className="camera-panel__actions">
        <label className="field field--inline">
          <span>Attempts</span>
          <select value={attempts} onChange={(e) => setAttempts(Number(e.target.value))}>
            {[50, 100, 170, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button button--primary" onClick={startAccuracy} disabled={snap.running !== null}>
          Start accuracy trial
        </button>
        <button type="button" className="button" onClick={startNeutral} disabled={snap.running !== null}>
          Start 5-minute neutral test
        </button>
      </div>
      {snap.message && <p role="status">{snap.message}</p>}
      {snap.saveError && (
        <p className="notice notice--warning" role="alert">
          <span aria-hidden="true">▲ </span>The last trial was not saved: {snap.saveError.message} Export it now.
        </p>
      )}

      <h4>Totals for the instrument gate</h4>
      <dl className="facts">
        <dt>Accuracy sessions</dt>
        <dd className="data">{t.sessions} (gate: at least 3)</dd>
        <dt>Attempts</dt>
        <dd className="data">{t.attempts} (gate: at least 500)</dd>
        <dt>Correct</dt>
        <dd className="data">
          {t.correct} · {pct(t.correctRate)} (gate: at least 99%)
        </dd>
        <dt>Wrong target</dt>
        <dd className="data">{t.wrong}</dd>
        <dt>Missed</dt>
        <dd className="data">{t.missed}</dd>
        <dt>Duplicates</dt>
        <dd className="data">{t.duplicates} (gate: 0)</dd>
        <dt>Other-hand presses</dt>
        <dd className="data">{t.otherHandPresses}</dd>
        <dt>Neutral tests</dt>
        <dd className="data">
          {t.neutralSessions} · {t.accidentalNotes} accidental notes in total (gate: at most 1 per 5-minute test)
        </dd>
      </dl>
      <p className="muted">These counts are evidence for the owner's review, not an automatic pass.</p>

      {snap.saved.length > 0 && (
        <>
          <table className="diag-table">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Kind</th>
                <th scope="col">Result</th>
                <th scope="col">Conditions</th>
              </tr>
            </thead>
            <tbody>
              {[...snap.saved].reverse().slice(0, 10).map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.startedAt).toLocaleString()}</td>
                  <td>{s.kind === "accuracy" ? "Accuracy" : "Neutral"}</td>
                  <td>
                    {s.summary.kind === "accuracy"
                      ? `${s.summary.correct}/${s.summary.attempts} correct · ${s.summary.wrong} wrong · ${s.summary.missed} missed · ${s.summary.duplicates} duplicate`
                      : `${s.summary.accidentalNotes} accidental notes in ${Math.round(s.summary.durationMs / 60000)} min`}
                  </td>
                  <td>{s.conditions || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="button" onClick={exportResults}>
            Export results (JSON)
          </button>
        </>
      )}
    </div>
  );
}
