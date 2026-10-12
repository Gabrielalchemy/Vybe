import { describe, expect, it } from "vitest";
import { createChordPad, validateChordPad } from "../../../src/domain/chords";
import { FACTORY_SCENES } from "../../../src/domain/presets";

describe("createChordPad", () => {
  it("stores unique ascending pitches and derives exact display spellings", () => {
    const pad = createChordPad({ id: "p1", label: "Am9", notes: [64, 45, 60, 55, 59] });
    expect(pad.notes).toEqual([45, 55, 59, 60, 64]);
    expect(pad.displaySpellings).toEqual(["A2", "G3", "B3", "C4", "E4"]);
  });

  it("rejects duplicate pitches rather than silently merging them", () => {
    expect(() => createChordPad({ id: "p", label: "C", notes: [60, 60, 64] })).toThrow(/duplicate/i);
  });

  it("accepts one to eight notes within A0..C8 only", () => {
    expect(() => createChordPad({ id: "p", label: "x", notes: [] })).toThrow(/1 to 8/);
    expect(() => createChordPad({ id: "p", label: "x", notes: [40, 41, 42, 43, 44, 45, 46, 47, 48] })).toThrow(/1 to 8/);
    expect(() => createChordPad({ id: "p", label: "x", notes: [20, 60] })).toThrow(/A0/);
    expect(createChordPad({ id: "p", label: "single", notes: [60] }).notes).toEqual([60]);
  });

  it("keeps a custom label as an annotation without reinterpreting pitches", () => {
    const pad = createChordPad({ id: "p", label: "My weird one", notes: [48, 49, 50] });
    expect(pad.label).toBe("My weird one");
    expect(pad.notes).toEqual([48, 49, 50]);
  });
});

describe("validateChordPad", () => {
  it("rejects stored records whose spellings disagree with the pitches", () => {
    const result = validateChordPad({ id: "p", label: "C", notes: [48, 55], displaySpellings: ["C3", "A3"], voicingName: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects unsorted stored pitch lists", () => {
    const result = validateChordPad({ id: "p", label: "C", notes: [55, 48], displaySpellings: ["G3", "C3"], voicingName: "" });
    expect(result.ok).toBe(false);
  });
});

// Exact factory voicings, architecture.md §7. These are fixtures: they are not
// re-derived from chord symbols, so a theory-library update cannot change them.
const EXPECTED: Record<string, [string, number[], string][]> = {
  pop: [
    ["C", [48, 55, 60, 64], "C3 G3 C4 E4"],
    ["G", [43, 55, 59, 62], "G2 G3 B3 D4"],
    ["Am", [45, 57, 60, 64], "A2 A3 C4 E4"],
    ["F", [41, 53, 57, 60], "F2 F3 A3 C4"],
  ],
  soul: [
    ["Cmaj9", [48, 52, 59, 62, 67], "C3 E3 B3 D4 G4"],
    ["Am9", [45, 55, 59, 60, 64], "A2 G3 B3 C4 E4"],
    ["Dm9", [50, 53, 60, 64, 69], "D3 F3 C4 E4 A4"],
    ["G13", [43, 53, 59, 64, 69], "G2 F3 B3 E4 A4"],
  ],
  jazz: [
    ["Dm7", [50, 57, 60, 65], "D3 A3 C4 F4"],
    ["G7", [43, 55, 59, 65], "G2 G3 B3 F4"],
    ["Cmaj7", [48, 55, 59, 64], "C3 G3 B3 E4"],
    ["A7", [45, 55, 61, 64], "A2 G3 C#4 E4"],
  ],
};

describe("factory scenes", () => {
  for (const [sceneId, pads] of Object.entries(EXPECTED)) {
    it(`${sceneId} has the specified exact voicings and four empty slots`, () => {
      const scene = FACTORY_SCENES[sceneId as keyof typeof FACTORY_SCENES];
      expect(scene.chordSlots).toHaveLength(8);
      pads.forEach(([label, notes, display], i) => {
        const pad = scene.chordSlots[i];
        expect(pad?.label).toBe(label);
        expect(pad?.notes).toEqual(notes);
        expect(pad?.displaySpellings.join(" ")).toBe(display);
      });
      expect(scene.chordSlots.slice(4)).toEqual([null, null, null, null]);
    });
  }

  it("uses the PRD R09 tempo, assistance, instrument and groove defaults", () => {
    const { pop, soul, jazz } = FACTORY_SCENES;
    expect([pop.tempoBpm, soul.tempoBpm, jazz.tempoBpm]).toEqual([90, 76, 100]);
    expect(pop.assistance).toEqual({ mode: "assisted", noteGuide: true, chordGuide: true, scaleGuard: true });
    expect(soul.assistance).toEqual({ mode: "assisted", noteGuide: true, chordGuide: true, scaleGuard: false });
    expect(jazz.assistance).toEqual({ mode: "assisted", noteGuide: true, chordGuide: true, scaleGuard: false });
    expect([pop.liveInstrument, soul.liveInstrument, jazz.liveInstrument]).toEqual(["grand-piano", "electric-piano", "grand-piano"]);
    expect(pop.groove).toEqual({ subdivision: "eighth", swingPercent: 50 });
    expect(soul.groove).toEqual({ subdivision: "sixteenth", swingPercent: 56 });
    expect(jazz.groove).toEqual({ subdivision: "eighth", swingPercent: 60 });
    for (const scene of [pop, soul, jazz]) {
      expect(scene.key).toEqual({ tonic: "C", scale: "major" });
      expect(scene.melodyOctave).toBe(4);
      expect(scene.velocity).toBe(80);
      expect(scene.loopBars).toBe(4);
    }
  });
});
