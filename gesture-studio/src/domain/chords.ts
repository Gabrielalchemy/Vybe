import { Note } from "tonal";
import { MIDI_MAX, MIDI_MIN, isPitchedNote, pitchName, type Spelling } from "./pitch";
import { fail, ok, type Result } from "./result";

/**
 * A chord pad sounds exactly its stored pitches. The label and spellings are
 * annotations; nothing re-derives pitches from the label (architecture A07).
 */
export interface ChordPad {
  id: string;
  label: string;
  /** Unique, ascending, 1..8 MIDI notes in A0..C8. Authoritative. */
  notes: number[];
  /** One spelling per note, with octave, e.g. "C#4". */
  displaySpellings: string[];
  voicingName: string;
}

export const MAX_CHORD_NOTES = 8;

export interface ChordPadInput {
  id: string;
  label: string;
  notes: readonly number[];
  voicingName?: string;
  spelling?: Spelling;
}

function checkNotes(notes: readonly number[]): string | null {
  if (notes.length < 1 || notes.length > MAX_CHORD_NOTES) return "A chord needs 1 to 8 notes.";
  for (const n of notes) {
    if (!isPitchedNote(n)) return `Note ${n} is outside A0 (${MIDI_MIN}) to C8 (${MIDI_MAX}).`;
  }
  if (new Set(notes).size !== notes.length) return "A chord cannot contain duplicate pitches.";
  return null;
}

export function createChordPad(input: ChordPadInput): ChordPad {
  const problem = checkNotes(input.notes);
  if (problem) throw new RangeError(problem);
  const notes = [...input.notes].sort((a, b) => a - b);
  return {
    id: input.id,
    label: input.label,
    notes,
    displaySpellings: notes.map((n) => pitchName(n, input.spelling)),
    voicingName: input.voicingName ?? "",
  };
}

/** Runtime validation for stored or imported chord pads. */
export function validateChordPad(value: unknown): Result<ChordPad> {
  if (typeof value !== "object" || value === null) return fail("Chord pad must be an object.");
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id === "") return fail("Chord pad id is missing.");
  if (typeof v.label !== "string") return fail("Chord pad label must be text.");
  if (typeof v.voicingName !== "string") return fail("Chord pad voicing name must be text.");
  if (!Array.isArray(v.notes) || !Array.isArray(v.displaySpellings)) return fail("Chord pad notes are missing.");
  const notes = v.notes as unknown[];
  if (!notes.every((n): n is number => typeof n === "number")) return fail("Chord pad notes must be numbers.");
  const problem = checkNotes(notes);
  if (problem) return fail(problem);
  if (notes.some((n, i) => i > 0 && n <= (notes[i - 1] as number))) return fail("Chord pad notes must be ascending.");
  const spellings = v.displaySpellings as unknown[];
  if (spellings.length !== notes.length) return fail("Each chord note needs one spelling.");
  for (let i = 0; i < notes.length; i++) {
    const s = spellings[i];
    if (typeof s !== "string" || Note.midi(s) !== notes[i]) {
      return fail(`Spelling ${String(s)} does not match MIDI note ${notes[i]}.`);
    }
  }
  return ok({
    id: v.id,
    label: v.label,
    notes: [...notes],
    displaySpellings: spellings as string[],
    voicingName: v.voicingName,
  });
}
