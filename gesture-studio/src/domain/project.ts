import { validateChordPad, type ChordPad } from "./chords";
import type { AssistanceSettings, GrooveSetting, InstrumentId, ScaleName, ScenePreset } from "./presets";
import { fail, ok, type Result } from "./result";
import type { StorageError } from "./storageError";

export const CURRENT_SCHEMA_VERSION = 1;
/** Built-in instrument assets are referenced by immutable pack version. */
export const ASSET_PACK_VERSION = "vybe-assets-1";

export const INSTRUMENT_IDS: readonly InstrumentId[] = ["grand-piano", "electric-piano", "warm-pad", "plucked-bass", "percussion"];
const SCALES: readonly ScaleName[] = ["major", "minor", "major pentatonic", "minor pentatonic", "blues"];
const LOOP_BARS = [1, 2, 4, 8, 16] as const;
export const TEMPO_RANGE_BPM = { min: 40, max: 240 } as const;
export const MAX_TRACKS = 8;

export interface TrackRecord {
  id: string;
  name: string;
  instrument: InstrumentId;
}

export type ProjectScene = Omit<ScenePreset, "id" | "name"> & { sourcePresetId: string };

export interface ProjectRecord {
  schemaVersion: number;
  id: string;
  name: string;
  /** Increments on every committed save. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  assetPackVersion: string;
  scene: ProjectScene;
  tracks: TrackRecord[];
}

export function createProject(input: { id: string; name: string; scene: ScenePreset; nowIso: string }): ProjectRecord {
  const scene = structuredClone(input.scene);
  const settings: ProjectScene = {
    chordSlots: scene.chordSlots,
    key: scene.key,
    melodyOctave: scene.melodyOctave,
    tempoBpm: scene.tempoBpm,
    velocity: scene.velocity,
    loopBars: scene.loopBars,
    liveInstrument: scene.liveInstrument,
    assistance: scene.assistance,
    groove: scene.groove,
    sourcePresetId: scene.id,
  };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    revision: 0,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    assetPackVersion: ASSET_PACK_VERSION,
    scene: settings,
    tracks: [],
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

const invalid = (message: string): Result<never, StorageError> => fail({ code: "invalid-record", message });

function validateAssistance(v: unknown): v is AssistanceSettings {
  return (
    isObj(v) &&
    (v.mode === "assisted" || v.mode === "free") &&
    typeof v.noteGuide === "boolean" &&
    typeof v.chordGuide === "boolean" &&
    typeof v.scaleGuard === "boolean"
  );
}

function validateGroove(v: unknown): v is GrooveSetting {
  return isObj(v) && (v.subdivision === "eighth" || v.subdivision === "sixteenth") && isInt(v.swingPercent, 50, 67);
}

function validateScene(v: unknown): Result<ProjectScene, StorageError> {
  if (!isObj(v)) return invalid("scene is missing.");
  if (!Array.isArray(v.chordSlots) || v.chordSlots.length !== 8) return invalid("scene.chordSlots must have 8 slots.");
  const slots: (ChordPad | null)[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = v.chordSlots[i] as unknown;
    if (raw === null) {
      slots.push(null);
      continue;
    }
    const pad = validateChordPad(raw);
    if (!pad.ok) return invalid(`scene.chordSlots[${i}]: ${pad.error}`);
    slots.push(pad.value);
  }
  if (!isObj(v.key) || !isNonEmpty(v.key.tonic) || !SCALES.includes(v.key.scale as ScaleName)) return invalid("scene.key is invalid.");
  if (!isInt(v.melodyOctave, 0, 8)) return invalid("scene.melodyOctave must be 0..8.");
  if (!isInt(v.tempoBpm, TEMPO_RANGE_BPM.min, TEMPO_RANGE_BPM.max)) return invalid("scene.tempoBpm must be 40..240.");
  if (!isInt(v.velocity, 1, 127)) return invalid("scene.velocity must be 1..127.");
  if (!LOOP_BARS.includes(v.loopBars as (typeof LOOP_BARS)[number])) return invalid("scene.loopBars must be 1, 2, 4, 8 or 16.");
  if (!INSTRUMENT_IDS.includes(v.liveInstrument as InstrumentId)) return invalid("scene.liveInstrument is unknown.");
  if (!validateAssistance(v.assistance)) return invalid("scene.assistance is invalid.");
  if (!validateGroove(v.groove)) return invalid("scene.groove is invalid.");
  if (!isNonEmpty(v.sourcePresetId)) return invalid("scene.sourcePresetId is missing.");
  return ok({
    chordSlots: slots,
    key: { tonic: v.key.tonic as string, scale: v.key.scale as ScaleName },
    melodyOctave: v.melodyOctave,
    tempoBpm: v.tempoBpm,
    velocity: v.velocity,
    loopBars: v.loopBars as ProjectScene["loopBars"],
    liveInstrument: v.liveInstrument as InstrumentId,
    assistance: { ...v.assistance },
    groove: { ...v.groove },
    sourcePresetId: v.sourcePresetId,
  });
}

/** Runtime validation for a stored or imported project. TypeScript types are not a parser. */
export function validateProjectRecord(value: unknown): Result<ProjectRecord, StorageError> {
  if (!isObj(value)) return invalid("Project record must be an object.");
  if (!isInt(value.schemaVersion, 1, Number.MAX_SAFE_INTEGER)) return invalid("schemaVersion is missing.");
  if (value.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return fail({ code: "newer-schema", message: `This project uses schema ${value.schemaVersion}; this app reads up to ${CURRENT_SCHEMA_VERSION}.` });
  }
  if (!isNonEmpty(value.id)) return invalid("id is missing.");
  if (!isNonEmpty(value.name)) return invalid("name is missing.");
  if (!isInt(value.revision, 0, Number.MAX_SAFE_INTEGER)) return invalid("revision must be a non-negative integer.");
  if (!isIso(value.createdAt) || !isIso(value.updatedAt)) return invalid("timestamps must be ISO strings.");
  if (!isNonEmpty(value.assetPackVersion)) return invalid("assetPackVersion is missing.");
  const scene = validateScene(value.scene);
  if (!scene.ok) return scene;
  if (!Array.isArray(value.tracks) || value.tracks.length > MAX_TRACKS) return invalid(`tracks must be a list of at most ${MAX_TRACKS}.`);
  const tracks: TrackRecord[] = [];
  for (const [i, t] of (value.tracks as unknown[]).entries()) {
    if (!isObj(t) || !isNonEmpty(t.id) || !isNonEmpty(t.name) || !INSTRUMENT_IDS.includes(t.instrument as InstrumentId)) {
      return invalid(`tracks[${i}] is invalid.`);
    }
    tracks.push({ id: t.id, name: t.name, instrument: t.instrument as InstrumentId });
  }
  return ok({
    schemaVersion: value.schemaVersion,
    id: value.id,
    name: value.name,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    assetPackVersion: value.assetPackVersion,
    scene: scene.value,
    tracks,
  });
}
