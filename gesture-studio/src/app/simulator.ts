import type { HandRole } from "../domain/events";
import type { SessionController } from "./sessionController";

/**
 * Deterministic input scripts for exercising the live pipeline without a
 * camera. They drive the same SessionController path as real input, labelled
 * as "simulator" input in diagnostics. They do not stand in for camera evidence.
 */
export type SimulationStep =
  | { atMs: number; op: "press"; hand: HandRole; targetId: string | null }
  | { atMs: number; op: "release" | "rest" | "lost"; hand: HandRole }
  | { atMs: number; op: "sustain"; down: boolean };

export interface SimulationScript {
  title: string;
  description: string;
  steps: readonly SimulationStep[];
}

const chord = (atMs: number, slot: number, holdMs: number): SimulationStep[] => [
  { atMs, op: "press", hand: "left", targetId: `chord-slot-${slot}` },
  { atMs: atMs + holdMs, op: "release", hand: "left" },
];
const note = (atMs: number, pitchClass: number, holdMs: number): SimulationStep[] => [
  { atMs, op: "press", hand: "right", targetId: `melody-pc-${pitchClass}` },
  { atMs: atMs + holdMs, op: "release", hand: "right" },
];
const byTime = (steps: SimulationStep[]) => steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.atMs - b.s.atMs || a.i - b.i).map(({ s }) => s);

export const SIMULATION_SCRIPTS = {
  "ii-v-i-melody": {
    title: "Chords 1–3 with a melody",
    description: "Left hand plays slots 1, 2 and 3 while the right hand plays a short line.",
    steps: byTime([
      ...chord(0, 0, 1100),
      ...note(100, 5, 400),
      ...note(600, 9, 400),
      ...chord(1200, 1, 1100),
      ...note(1300, 11, 400),
      ...note(1800, 5, 400),
      ...chord(2400, 2, 1500),
      ...note(2500, 4, 1200),
    ]),
  },
  "loss-during-sustain": {
    title: "Left hand lost under sustain",
    description: "Sustain down, a chord is released into the pedal, then the left hand is lost; only its voices stop.",
    steps: [
      { atMs: 0, op: "sustain", down: true },
      { atMs: 10, op: "press", hand: "left", targetId: "chord-slot-3" },
      { atMs: 20, op: "press", hand: "right", targetId: "melody-pc-4" },
      { atMs: 300, op: "release", hand: "left" },
      { atMs: 500, op: "lost", hand: "left" },
      { atMs: 900, op: "release", hand: "right" },
      { atMs: 1200, op: "sustain", down: false },
    ],
  },
  "silent-targets": {
    title: "Gaps and empty pads",
    description: "Closing over a gap or an empty pad stays silent and still needs a release before the next press.",
    steps: [
      { atMs: 0, op: "press", hand: "right", targetId: null },
      { atMs: 50, op: "press", hand: "right", targetId: "melody-pc-0" },
      { atMs: 200, op: "release", hand: "right" },
      { atMs: 250, op: "press", hand: "left", targetId: "chord-slot-7" },
      { atMs: 400, op: "release", hand: "left" },
      ...note(450, 0, 200),
    ],
  },
  "rest-both-hands": {
    title: "Rest while playing",
    description: "Both hands play, then each moves to its rest strip.",
    steps: [
      { atMs: 0, op: "press", hand: "left", targetId: "chord-slot-0" },
      { atMs: 10, op: "press", hand: "right", targetId: "melody-pc-2" },
      { atMs: 400, op: "rest", hand: "right" },
      { atMs: 800, op: "rest", hand: "left" },
    ],
  },
} satisfies Record<string, SimulationScript>;

export type SimulationScriptId = keyof typeof SIMULATION_SCRIPTS;

export function applyStep(session: SessionController, step: SimulationStep): void {
  switch (step.op) {
    case "press":
      session.press(step.hand, step.targetId, "simulator");
      break;
    case "release":
      session.release(step.hand, "simulator");
      break;
    case "rest":
      session.rest(step.hand, "simulator");
      break;
    case "lost":
      session.lost(step.hand);
      break;
    case "sustain":
      session.setSustain(step.down);
      break;
  }
}

/** Synchronous replay against a controllable clock (tests). */
export function runSimulation(session: SessionController, script: SimulationScript, advanceTo: (ms: number) => void): void {
  for (const step of script.steps) {
    advanceTo(step.atMs);
    applyStep(session, step);
  }
}

/** Real-time replay with timers (development panel). Returns a cancel function that releases everything. */
export function playSimulation(session: SessionController, script: SimulationScript, onDone: () => void): () => void {
  const timers = script.steps.map((step) => setTimeout(() => applyStep(session, step), step.atMs));
  const last = script.steps.at(-1)?.atMs ?? 0;
  const done = setTimeout(onDone, last + 1);
  return () => {
    for (const t of [...timers, done]) clearTimeout(t);
    session.stopAll();
  };
}
