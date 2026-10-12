import { beforeEach, describe, expect, it } from "vitest";
import { LiveRouter, type LiveConfiguration } from "../../../src/domain/liveRouter";
import { FACTORY_SCENES } from "../../../src/domain/presets";
import type { GestureIntent, HandRole, PerformanceEvent } from "../../../src/domain/events";

let router: LiveRouter;
let clockSec = 0;
let seq = 0;

const config = (revision = 1, overrides: Partial<LiveConfiguration> = {}): LiveConfiguration => ({
  revision,
  melodyOctave: 4,
  chordSlots: FACTORY_SCENES.jazz.chordSlots,
  trackIdByHand: { left: "track-chords", right: "track-melody" },
  velocity: 80,
  ...overrides,
});

const intent = (hand: HandRole, action: GestureIntent["action"], targetId: string | null = null, revision = 1): GestureIntent => ({
  id: `i${++seq}`,
  configurationRevision: revision,
  hand,
  action,
  targetId,
  requestedAtMs: seq,
  velocity: 80,
  input: "simulator",
});

const notesOn = (events: PerformanceEvent[]) => events.flatMap((e) => (e.kind === "note-on" ? [e.note] : []));
const voiceReleases = (events: PerformanceEvent[]) => events.filter((e) => e.kind === "voice-release");

beforeEach(() => {
  seq = 0;
  clockSec = 10;
  router = new LiveRouter({ nextVoiceId: (() => { let n = 0; return () => `v${++n}`; })(), nowSec: () => clockSec });
  router.applyConfiguration(config());
  router.arm("left");
  router.arm("right");
});

describe("melody lane (right hand)", () => {
  it("sounds the selected chromatic note in the current octave", () => {
    const out = router.handle(intent("right", "press", "melody-pc-1"));
    expect(out.status).toBe("sounded");
    expect(notesOn(out.events)).toEqual([61]);
    expect(out.events[0]).toMatchObject({ source: "live-right", trackId: "track-melody", audioTimeSec: 10, velocity: 80 });
  });

  it("produces at most one attack per press; a second press while held is ignored", () => {
    router.handle(intent("right", "press", "melody-pc-0"));
    const again = router.handle(intent("right", "press", "melody-pc-2"));
    expect(again.status).toBe("ignored");
    expect(again.events).toEqual([]);
  });

  it("releases exactly the latched voice", () => {
    const press = router.handle(intent("right", "press", "melody-pc-4"));
    const release = router.handle(intent("right", "release"));
    expect(release.status).toBe("released");
    const voiceId = press.events[0]?.kind === "note-on" ? press.events[0].voiceId : "";
    expect(voiceReleases(release.events).map((e) => e.voiceId)).toEqual([voiceId]);
  });

  it("keeps disabled edge-octave notes silent without substituting a nearby pitch", () => {
    router.applyConfiguration(config(2, { melodyOctave: 8 }));
    router.arm("right");
    const out = router.handle(intent("right", "press", "melody-pc-1", 2));
    expect(out).toMatchObject({ status: "silent", reason: "unavailable-note" });
    expect(out.events).toEqual([]);
  });

  it("closing over a gap is silent and still requires release before the next press", () => {
    expect(router.handle(intent("right", "press", null))).toMatchObject({ status: "silent", reason: "gap" });
    expect(router.handle(intent("right", "press", "melody-pc-0")).status).toBe("ignored");
    expect(router.handle(intent("right", "release")).events).toEqual([]);
    expect(router.handle(intent("right", "press", "melody-pc-0")).status).toBe("sounded");
  });

  it("rejects a chord target from the melody hand", () => {
    expect(router.handle(intent("right", "press", "chord-slot-0"))).toMatchObject({ status: "rejected", reason: "wrong-lane" });
  });
});

describe("chord lane (left hand)", () => {
  it("sounds exactly the stored pitches of the pad", () => {
    const out = router.handle(intent("left", "press", "chord-slot-3"));
    expect(notesOn(out.events)).toEqual([45, 55, 61, 64]);
    expect(out.events.every((e) => e.kind !== "note-on" || e.source === "live-left")).toBe(true);
  });

  it("an empty pad is silent", () => {
    expect(router.handle(intent("left", "press", "chord-slot-6"))).toMatchObject({ status: "silent", reason: "empty-pad", events: [] });
  });

  it("releasing the chord does not release the melody's identical pitch", () => {
    router.handle(intent("left", "press", "chord-slot-3")); // includes 64
    const melody = router.handle(intent("right", "press", "melody-pc-4")); // E4 = 64
    expect(notesOn(melody.events)).toEqual([64]);
    router.handle(intent("left", "release"));
    expect(router.voices().filter((v) => v.note === 64).map((v) => v.source)).toEqual(["live-right"]);
  });
});

describe("rest, loss and arming", () => {
  it("rest flushes that hand only, including sustained voices, and disarms it", () => {
    router.setSustain("left", true);
    router.handle(intent("left", "press", "chord-slot-0"));
    router.handle(intent("left", "release"));
    router.handle(intent("right", "press", "melody-pc-0"));
    const out = router.handle(intent("left", "rest"));
    expect(out.status).toBe("flushed");
    expect(voiceReleases(out.events).every((e) => e.kind === "voice-release" && e.reason === "rest")).toBe(true);
    expect(router.voices().map((v) => v.source)).toEqual(["live-right"]);
    expect(router.laneState("left")).toBe("disarmed");
  });

  it("a disarmed lane cannot start notes until re-armed by neutral input", () => {
    router.handle(intent("right", "lost"));
    expect(router.handle(intent("right", "press", "melody-pc-0"))).toMatchObject({ status: "rejected", reason: "not-armed" });
    router.arm("right");
    expect(router.handle(intent("right", "press", "melody-pc-0")).status).toBe("sounded");
  });

  it("loss uses the loss reason", () => {
    router.handle(intent("right", "press", "melody-pc-0"));
    const out = router.handle(intent("right", "lost"));
    expect(voiceReleases(out.events).map((e) => e.kind === "voice-release" && e.reason)).toEqual(["loss"]);
  });

  it("stopAll releases every live voice and clears pedals", () => {
    router.setSustain("right", true);
    router.handle(intent("left", "press", "chord-slot-0"));
    router.handle(intent("right", "press", "melody-pc-0"));
    router.stopAll();
    expect(router.voices()).toEqual([]);
    expect(router.laneState("left")).toBe("disarmed");
    expect(router.laneState("right")).toBe("disarmed");
  });
});

describe("configuration revisions", () => {
  it("ignores intents from an earlier configuration revision", () => {
    router.applyConfiguration(config(2));
    router.arm("right");
    expect(router.handle(intent("right", "press", "melody-pc-0", 1))).toMatchObject({ status: "rejected", reason: "stale-revision" });
  });

  it("refuses to remap while a hand is holding a note", () => {
    router.handle(intent("right", "press", "melody-pc-0"));
    expect(router.applyConfiguration(config(2, { melodyOctave: 5 }))).toMatchObject({ ok: false });
    expect(router.configuration().melodyOctave).toBe(4);
  });

  it("a new mapping flushes pedal-held live voices and requires re-arming", () => {
    router.setSustain("right", true);
    router.handle(intent("right", "press", "melody-pc-0"));
    router.handle(intent("right", "release"));
    const result = router.applyConfiguration(config(2, { melodyOctave: 5 }));
    expect(result.ok).toBe(true);
    expect(router.voices()).toEqual([]);
    expect(router.laneState("right")).toBe("disarmed");
  });

  it("a held note keeps its latched pitch; the octave cannot change underneath it", () => {
    const out = router.handle(intent("right", "press", "melody-pc-0"));
    expect(notesOn(out.events)).toEqual([60]);
    expect(router.voices()[0]?.note).toBe(60);
  });
});
