import type { TrialController, TrialSnapshot } from "../../app/trialController";
import type { SessionSnapshot } from "../../app/sessionController";
import { melodyOctaveNotes } from "../../domain/pitch";

function describeTarget(targetId: string, session: SessionSnapshot): string {
  if (targetId.startsWith("chord-slot-")) {
    const slot = Number(targetId.slice("chord-slot-".length));
    const pad = session.chordSlots[slot];
    return `${pad?.label ?? "Empty"} (slot ${slot + 1})`;
  }
  const pc = Number(targetId.slice("melody-pc-".length));
  return melodyOctaveNotes(session.melodyOctave)[pc]?.name ?? targetId;
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Running trial prompt above the playing surface. */
export function TrialBar({ trials, snapshot, session }: { trials: TrialController; snapshot: TrialSnapshot; session: SessionSnapshot }) {
  const running = snapshot.running;
  if (!running) return null;
  return (
    <section className="trial-bar" aria-label="Instrument trial">
      {running.kind === "accuracy" && running.prompt ? (
        <>
          <p className="trial-bar__prompt" aria-live="polite">
            Pinch with your <strong>{running.prompt.hand}</strong> hand: <strong>{describeTarget(running.prompt.targetId, session)}</strong>
          </p>
          <span className="data">
            Attempt {running.prompt.index + 1} of {running.prompt.total}
          </span>
        </>
      ) : (
        <>
          <p className="trial-bar__prompt">
            Neutral movement test: move, reposition and rest as you naturally would, without pinching to play.
          </p>
          <span className="data">{clock(running.remainingMs ?? 0)} left</span>
        </>
      )}
      <button type="button" className="button" onClick={() => trials.stop()}>
        Stop trial
      </button>
    </section>
  );
}
