import { describe, expect, it } from "vitest";
import { MIDI_MAX, MIDI_MIN, isPitchedNote, melodyOctaveNotes, pitchName } from "../../../src/domain/pitch";

describe("pitch range", () => {
  it("covers A0 (21) to C8 (108)", () => {
    expect(MIDI_MIN).toBe(21);
    expect(MIDI_MAX).toBe(108);
    expect(isPitchedNote(21)).toBe(true);
    expect(isPitchedNote(108)).toBe(true);
    expect(isPitchedNote(20)).toBe(false);
    expect(isPitchedNote(109)).toBe(false);
    expect(isPitchedNote(60.5)).toBe(false);
  });
});

describe("pitchName", () => {
  it("spells with octave numbers using sharps by default", () => {
    expect(pitchName(60)).toBe("C4");
    expect(pitchName(61)).toBe("C#4");
    expect(pitchName(21)).toBe("A0");
    expect(pitchName(108)).toBe("C8");
  });

  it("can spell flats without changing pitch identity", () => {
    expect(pitchName(70, "flat")).toBe("Bb4");
  });

  it("rejects non-MIDI input", () => {
    expect(() => pitchName(128)).toThrow(RangeError);
  });
});

describe("melodyOctaveNotes", () => {
  it("lists C..B of the octave with availability", () => {
    const octave4 = melodyOctaveNotes(4);
    expect(octave4.map((n) => n.midi)).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]);
    expect(octave4.every((n) => n.available)).toBe(true);
  });

  it("disables notes outside A0-C8 in edge octaves instead of dropping them", () => {
    const octave0 = melodyOctaveNotes(0);
    expect(octave0).toHaveLength(12);
    expect(octave0.filter((n) => n.available).map((n) => n.midi)).toEqual([21, 22, 23]);
    const octave8 = melodyOctaveNotes(8);
    expect(octave8.filter((n) => n.available).map((n) => n.midi)).toEqual([108]);
  });
});
