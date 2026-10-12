import { Midi } from "tonal";

/** Lowest pitched note on the instrument: A0. */
export const MIDI_MIN = 21;
/** Highest pitched note on the instrument: C8. */
export const MIDI_MAX = 108;

export type Spelling = "sharp" | "flat";

export function isMidiNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127;
}

export function isPitchedNote(value: unknown): value is number {
  return isMidiNumber(value) && value >= MIDI_MIN && value <= MIDI_MAX;
}

/** Spells a MIDI note with its octave number (C4 = 60). Spelling never changes pitch identity. */
export function pitchName(midi: number, spelling: Spelling = "sharp"): string {
  if (!isMidiNumber(midi)) throw new RangeError(`Not a MIDI note number: ${midi}`);
  return Midi.midiToNoteName(midi, { sharps: spelling === "sharp" });
}

export interface MelodyNote {
  midi: number;
  /** Pitch class index 0..11 from C. */
  pitchClass: number;
  name: string;
  /** False for notes beyond A0..C8 in the edge octaves; they stay visible but cannot sound. */
  available: boolean;
}

/** The twelve chromatic notes C..B of one melody octave. */
export function melodyOctaveNotes(octave: number, spelling: Spelling = "sharp"): MelodyNote[] {
  if (!Number.isInteger(octave) || octave < 0 || octave > 8) {
    throw new RangeError(`Melody octave must be 0..8, got ${octave}`);
  }
  const base = 12 * (octave + 1);
  return Array.from({ length: 12 }, (_, pitchClass) => {
    const midi = base + pitchClass;
    return { midi, pitchClass, name: pitchName(midi, spelling), available: isPitchedNote(midi) };
  });
}
