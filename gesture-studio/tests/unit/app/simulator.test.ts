import { describe, expect, it } from "vitest";
import { SessionController } from "../../../src/app/sessionController";
import { SIMULATION_SCRIPTS, runSimulation } from "../../../src/app/simulator";
import { FACTORY_SCENES } from "../../../src/domain/presets";
import type { PerformanceEvent } from "../../../src/domain/events";

function harness() {
  const events: PerformanceEvent[] = [];
  let nowMs = 0;
  const session = new SessionController({
    sink: { dispatch: (e) => events.push(...e) },
    nowSec: () => nowMs / 1000,
    nowMs: () => nowMs,
    newId: (() => { let n = 0; return () => `id${++n}`; })(),
  });
  session.loadScene(FACTORY_SCENES.jazz);
  const advanceTo = (ms: number) => { nowMs = ms; };
  return { session, events, advanceTo };
}

describe("simulator scripts", () => {
  it("ii-V-I with melody produces the exact chord pitches in order", () => {
    const { session, events, advanceTo } = harness();
    runSimulation(session, SIMULATION_SCRIPTS["ii-v-i-melody"], advanceTo);
    const chordOns = events.filter((e) => e.kind === "note-on" && e.source === "live-left").map((e) => (e.kind === "note-on" ? e.note : 0));
    expect(chordOns).toEqual([50, 57, 60, 65, 43, 55, 59, 65, 48, 55, 59, 64]);
    expect(session.snapshot().soundingNotes).toEqual([]);
  });

  it("loss during sustain releases the lost hand only and leaves no stuck notes", () => {
    const { session, events, advanceTo } = harness();
    runSimulation(session, SIMULATION_SCRIPTS["loss-during-sustain"], advanceTo);
    const lossReleases = events.filter((e) => e.kind === "voice-release" && e.reason === "loss");
    expect(lossReleases.length).toBe(4);
    expect(lossReleases.every((e) => e.source === "live-left")).toBe(true);
    expect(session.snapshot().soundingNotes).toEqual([]);
  });

  it("every script ends with nothing sounding", () => {
    for (const [name, script] of Object.entries(SIMULATION_SCRIPTS)) {
      const { session, advanceTo } = harness();
      runSimulation(session, script, advanceTo);
      expect(session.snapshot().soundingNotes, name).toEqual([]);
    }
  });

  it("steps are applied in non-decreasing time order", () => {
    for (const script of Object.values(SIMULATION_SCRIPTS)) {
      const times = script.steps.map((s) => s.atMs);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });
});
