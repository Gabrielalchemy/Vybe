import { useCallback, useState } from "react";
import type { HandControl, HandControlSnapshot } from "../../app/handControl";
import type { SessionController, SessionSnapshot } from "../../app/sessionController";
import { CameraPanel } from "../camera/CameraPanel";
import { HandOverlay } from "../camera/HandOverlay";
import type { TrialController, TrialSnapshot } from "../../app/trialController";
import { TrialBar } from "../trials/TrialBar";
import { TrialTarget } from "../trials/TrialTarget";
import type { HandRole } from "../../domain/events";
import { CHORD_LAYOUT, MELODY_LAYOUT, type LayoutTarget } from "../../domain/layout";
import { melodyOctaveNotes, pitchName } from "../../domain/pitch";
import { KEY_LABEL_BY_TARGET } from "./keyboardMap";
import { Lane, type TargetView } from "./Lane";

const SPOKEN_ACCIDENTAL = (name: string) => name.replace("#", "-sharp");

interface PlayViewProps {
  session: SessionController;
  snapshot: SessionSnapshot;
  onOctave: (delta: -1 | 1) => void;
  octaveMessage: string | null;
  handControl: HandControl;
  handSnapshot: HandControlSnapshot;
  cameraVideo: HTMLVideoElement;
  trials: TrialController;
  trialSnapshot: TrialSnapshot;
}

export function PlayView({ session, snapshot, onOctave, octaveMessage, handControl, handSnapshot, cameraVideo, trials, trialSnapshot }: PlayViewProps) {
  const prompt = trialSnapshot.running?.prompt ?? null;
  const [sizeProblems, setSizeProblems] = useState<Record<HandRole, string | null>>({ left: null, right: null });
  const onSizeProblem = useCallback((hand: HandRole, problem: string | null) => {
    setSizeProblems((prev) => (prev[hand] === problem ? prev : { ...prev, [hand]: problem }));
  }, []);
  const onSurfaceSize = useCallback((hand: HandRole, size: { width: number; height: number }) => handControl.setLaneSize(hand, size), [handControl]);

  const notes = melodyOctaveNotes(snapshot.melodyOctave);
  const describeMelody = (t: LayoutTarget): TargetView => {
    const n = notes[t.index];
    if (!n) throw new Error(`No melody note for ${t.id}`);
    const pitchClass = n.name.replace(/-?\d+$/, "");
    return {
      label: pitchClass,
      detail: n.name,
      accessibleName: `${SPOKEN_ACCIDENTAL(n.name)}${n.available ? "" : ", outside the piano range, unavailable"}`,
      available: n.available,
      shortcut: KEY_LABEL_BY_TARGET[t.id],
    };
  };
  const describeChord = (t: LayoutTarget): TargetView => {
    const pad = snapshot.chordSlots[t.index] ?? null;
    if (!pad) {
      return { label: "Empty", detail: "", accessibleName: `Chord slot ${t.index + 1}, empty`, available: true, empty: true, shortcut: KEY_LABEL_BY_TARGET[t.id] };
    }
    const exact = pad.displaySpellings.join(" ");
    return {
      label: pad.label,
      detail: exact,
      accessibleName: `${pad.label}: ${pad.displaySpellings.map(SPOKEN_ACCIDENTAL).join(", ")}`,
      available: true,
      shortcut: KEY_LABEL_BY_TARGET[t.id],
    };
  };

  const heldChord = snapshot.lanes.left.heldTargetId?.startsWith("chord-slot-")
    ? snapshot.chordSlots[Number(snapshot.lanes.left.heldTargetId.slice("chord-slot-".length))]
    : null;
  const lastChordOutcome = [...snapshot.recentOutcomes].reverse().find((o) => o.hand === "left" && o.status === "sounded");
  const chordContext = heldChord ?? (lastChordOutcome ? snapshot.chordSlots[Number(lastChordOutcome.targetId?.slice("chord-slot-".length))] : null);
  const sizeProblem = sizeProblems.left ?? sizeProblems.right;
  const busy = snapshot.lanes.left.state === "held" || snapshot.lanes.right.state === "held";

  return (
    <div className="play">
      {sizeProblem && (
        <p className="notice notice--warning" role="status">
          <span aria-hidden="true">▲ </span>Enlarge the window to use both hand areas. {sizeProblem} The keyboard still works.
        </p>
      )}
      <TrialBar trials={trials} snapshot={trialSnapshot} session={snapshot} />
      <div className="play__lanes">
        <Lane
          session={session}
          snapshot={snapshot}
          hand="left"
          title="Chords"
          layout={CHORD_LAYOUT}
          describe={describeChord}
          onSizeProblem={onSizeProblem}
          onSurfaceSize={onSurfaceSize}
          overlay={
            <>
              {prompt?.hand === "left" && <TrialTarget layout={CHORD_LAYOUT} targetId={prompt.targetId} />}
              <HandOverlay handControl={handControl} hand="left" layout={CHORD_LAYOUT} />
            </>
          }
        />
        <Lane
          session={session}
          snapshot={snapshot}
          hand="right"
          title="Melody"
          layout={MELODY_LAYOUT}
          describe={describeMelody}
          onSizeProblem={onSizeProblem}
          onSurfaceSize={onSurfaceSize}
          overlay={
            <>
              {prompt?.hand === "right" && <TrialTarget layout={MELODY_LAYOUT} targetId={prompt.targetId} />}
              <HandOverlay handControl={handControl} hand="right" layout={MELODY_LAYOUT} />
            </>
          }
        />
      </div>
      <div className="play__footer">
        <div className="play__footer-left">
        <section className="panel chord-context" aria-labelledby="chord-context-title">
          <h2 id="chord-context-title" className="panel__title">Chord pitches</h2>
          {chordContext ? (
            <p>
              <strong className="chord-context__label">{chordContext.label}</strong>{" "}
              <span className="data">{chordContext.displaySpellings.join(" ")}</span>
            </p>
          ) : (
            <p className="muted">Play a chord pad to see its exact notes here.</p>
          )}
        </section>
        <section className="panel octave" aria-labelledby="octave-title">
          <h2 id="octave-title" className="panel__title">Melody octave</h2>
          <div className="octave__controls">
            <button type="button" className="button" onClick={() => onOctave(-1)} disabled={busy || snapshot.melodyOctave <= 0} aria-label="Lower melody octave">
              Lower <kbd>[</kbd>
            </button>
            <output className="data octave__value" aria-live="polite">
              {pitchName(12 * (snapshot.melodyOctave + 1))}–{pitchName(12 * (snapshot.melodyOctave + 1) + 11)}
            </output>
            <button type="button" className="button" onClick={() => onOctave(1)} disabled={busy || snapshot.melodyOctave >= 8} aria-label="Raise melody octave">
              Raise <kbd>]</kbd>
            </button>
          </div>
          {octaveMessage && <p className="muted">{octaveMessage}</p>}
        </section>
        </div>
        <CameraPanel handControl={handControl} snapshot={handSnapshot} video={cameraVideo} />
      </div>
    </div>
  );
}
