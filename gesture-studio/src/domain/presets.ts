import { createChordPad, type ChordPad } from "./chords";

export type InstrumentId = "grand-piano" | "electric-piano" | "warm-pad" | "plucked-bass" | "percussion";
export type ScaleName = "major" | "minor" | "major pentatonic" | "minor pentatonic" | "blues";

export interface AssistanceSettings {
  mode: "assisted" | "free";
  noteGuide: boolean;
  chordGuide: boolean;
  scaleGuard: boolean;
}

export interface GrooveSetting {
  subdivision: "eighth" | "sixteenth";
  /** 50 = straight; PRD range 50..67. */
  swingPercent: number;
}

export interface ScenePreset {
  id: string;
  name: string;
  /** Eight slots in reading order; null is an empty, silent pad. */
  chordSlots: (ChordPad | null)[];
  key: { tonic: string; scale: ScaleName };
  melodyOctave: number;
  tempoBpm: number;
  velocity: number;
  loopBars: 1 | 2 | 4 | 8 | 16;
  liveInstrument: InstrumentId;
  assistance: AssistanceSettings;
  groove: GrooveSetting;
}

export const DEFAULT_VELOCITY = 80;
export const VELOCITY_PRESETS = { soft: 48, medium: 80, loud: 112 } as const;

const pad = (sceneId: string, slot: number, label: string, notes: number[]) =>
  createChordPad({ id: `factory-${sceneId}-${slot}`, label, notes });

function slots(sceneId: string, pads: [string, number[]][]): (ChordPad | null)[] {
  const filled = pads.map(([label, notes], i) => pad(sceneId, i + 1, label, notes));
  return [...filled, ...Array.from({ length: 8 - filled.length }, () => null)];
}

const common = {
  key: { tonic: "C", scale: "major" },
  melodyOctave: 4,
  velocity: DEFAULT_VELOCITY,
  loopBars: 4,
} as const;

// Exact voicings are fixtures from architecture.md §7. G13 and the jazz G7
// deliberately omit the fifth.
export const FACTORY_SCENES = {
  pop: {
    ...common,
    id: "factory-pop",
    name: "Pop Session",
    chordSlots: slots("pop", [
      ["C", [48, 55, 60, 64]],
      ["G", [43, 55, 59, 62]],
      ["Am", [45, 57, 60, 64]],
      ["F", [41, 53, 57, 60]],
    ]),
    tempoBpm: 90,
    liveInstrument: "grand-piano",
    assistance: { mode: "assisted", noteGuide: true, chordGuide: true, scaleGuard: true },
    groove: { subdivision: "eighth", swingPercent: 50 },
  },
  soul: {
    ...common,
    id: "factory-soul",
    name: "Soul Session",
    chordSlots: slots("soul", [
      ["Cmaj9", [48, 52, 59, 62, 67]],
      ["Am9", [45, 55, 59, 60, 64]],
      ["Dm9", [50, 53, 60, 64, 69]],
      ["G13", [43, 53, 59, 64, 69]],
    ]),
    tempoBpm: 76,
    liveInstrument: "electric-piano",
    assistance: { mode: "assisted", noteGuide: true, chordGuide: true, scaleGuard: false },
    groove: { subdivision: "sixteenth", swingPercent: 56 },
  },
  jazz: {
    ...common,
    id: "factory-jazz",
    name: "Jazz Session",
    chordSlots: slots("jazz", [
      ["Dm7", [50, 57, 60, 65]],
      ["G7", [43, 55, 59, 65]],
      ["Cmaj7", [48, 55, 59, 64]],
      ["A7", [45, 55, 61, 64]],
    ]),
    tempoBpm: 100,
    liveInstrument: "grand-piano",
    assistance: { mode: "assisted", noteGuide: true, chordGuide: true, scaleGuard: false },
    groove: { subdivision: "eighth", swingPercent: 60 },
  },
} satisfies Record<string, ScenePreset>;
