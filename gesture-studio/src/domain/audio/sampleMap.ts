import { MIDI_MAX, MIDI_MIN, isPitchedNote } from "../pitch";

/** Salamander roots: every minor third from A0 (21) to C8 (108). */
export const PIANO_ROOTS: readonly number[] = Array.from({ length: (MIDI_MAX - MIDI_MIN) / 3 + 1 }, (_, i) => MIDI_MIN + 3 * i);

/** Sampled velocity layers used by the grand piano (architecture.md §6). */
export const PIANO_LAYERS = [4, 10, 16] as const;
export type PianoLayer = (typeof PIANO_LAYERS)[number];

/** Nearest sample root and the playback rate that reaches the requested note (at most ±1 semitone). */
export function chooseSample(note: number): { rootMidi: number; playbackRate: number } {
  if (!isPitchedNote(note)) throw new RangeError(`Note ${note} is outside the piano.`);
  const k = Math.round((note - MIDI_MIN) / 3);
  const rootMidi = MIDI_MIN + 3 * k;
  return { rootMidi, playbackRate: 2 ** ((note - rootMidi) / 12) };
}

// Each layer is used alone in its own range; around the boundaries between
// layers the two neighbours are blended with equal power so dynamics change
// smoothly rather than jumping between recordings.
const BLEND_ZONES: readonly { from: number; to: number; lower: PianoLayer; upper: PianoLayer }[] = [
  { from: 44, to: 60, lower: 4, upper: 10 },
  { from: 92, to: 108, lower: 10, upper: 16 },
];

export function layerWeights(velocity: number): { layer: PianoLayer; weight: number }[] {
  const v = Math.min(127, Math.max(1, velocity));
  for (const z of BLEND_ZONES) {
    if (v > z.from && v < z.to) {
      const t = (v - z.from) / (z.to - z.from);
      return [
        { layer: z.lower, weight: Math.cos((t * Math.PI) / 2) },
        { layer: z.upper, weight: Math.sin((t * Math.PI) / 2) },
      ];
    }
  }
  const layer: PianoLayer = v <= 44 ? 4 : v <= 92 ? 10 : 16;
  return [{ layer, weight: 1 }];
}
