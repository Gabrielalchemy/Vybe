import type { AssetManifest } from "../../domain/assetManifest";
import { PIANO_LAYERS, PIANO_ROOTS, chooseSample, layerWeights } from "../../domain/audio/sampleMap";
import { fail, ok, type Result } from "../../domain/result";
import type { AssetLoader } from "../assets/assetLoader";
import type { InstrumentVoices, VoiceLayer } from "./instrument";

/** PRD §5: decoded audio budget shared by samples and backing audio. */
export const DECODED_BUDGET_BYTES = 512 * 1024 * 1024;
/** Damper-like release for the grand piano, seconds (time constant). */
const PIANO_RELEASE_TAU_SEC = 0.12;
const LOAD_CONCURRENCY = 4;

export interface InstrumentLoadError {
  code: "incomplete" | "over-budget" | "load-failed" | "decode-failed" | "cancelled";
  /** DESIGN_SYSTEM.md §7 wording names the instrument and the recovery action. */
  message: string;
}

export interface LoadedInstrument {
  voices: InstrumentVoices;
  decodedBytes: number;
}

const key = (root: number, layer: number) => `${root}:${layer}`;

/**
 * Loads and decodes the grand piano. Every file is checksum-verified before
 * decoding. Any failure fails the whole instrument: there is no oscillator
 * stand-in labelled "Grand piano".
 */
export async function loadGrandPiano(
  ctx: BaseAudioContext,
  manifest: AssetManifest,
  loader: AssetLoader,
  opts: { budgetAvailableBytes: number; onProgress: (loaded: number, total: number) => void; isCancelled?: () => boolean },
): Promise<Result<LoadedInstrument, InstrumentLoadError>> {
  const failMsg = (code: InstrumentLoadError["code"], detail: string) =>
    fail<InstrumentLoadError>({ code, message: `Grand piano samples did not load (${detail}). Retry loading.` });
  const entries = manifest.assets.flatMap((a) => (a.kind === "sample" && a.sample?.instrument === "grand-piano" ? [{ entry: a, meta: a.sample }] : []));
  const byKey = new Map(entries.map((e) => [key(e.meta.rootMidi, e.meta.velocityLayer), e]));
  for (const root of PIANO_ROOTS) {
    for (const layer of PIANO_LAYERS) {
      if (!byKey.has(key(root, layer))) return failMsg("incomplete", `missing note ${root} layer ${layer}; run asset preparation`);
    }
  }
  const estimate = entries.reduce((s, e) => s + e.meta.decodedBytesEstimate, 0);
  if (estimate > opts.budgetAvailableBytes) {
    return fail({
      code: "over-budget",
      message: `The grand piano needs about ${Math.round(estimate / 2 ** 20)} MB of audio memory, but only ${Math.round(opts.budgetAvailableBytes / 2 ** 20)} MB is free. Remove a backing track, then retry loading.`,
    });
  }

  const buffers = new Map<string, { buffer: AudioBuffer; offsetSec: number }>();
  let loaded = 0;
  let decodedBytes = 0;
  let failure: InstrumentLoadError | null = null;
  const queue = [...entries];
  opts.onProgress(0, entries.length);

  const worker = async () => {
    for (let item = queue.shift(); item && !failure; item = queue.shift()) {
      const { entry, meta } = item;
      if (opts.isCancelled?.()) {
        failure = { code: "cancelled", message: "Loading the grand piano was cancelled." };
        return;
      }
      const bytes = await loader.load(entry);
      if (!bytes.ok) {
        failure = { code: "load-failed", message: `Grand piano samples did not load (${bytes.error.message}). Retry loading.` };
        return;
      }
      try {
        const buffer = await ctx.decodeAudioData(bytes.value);
        buffers.set(key(meta.rootMidi, meta.velocityLayer), { buffer, offsetSec: meta.attackOffsetSec });
        decodedBytes += buffer.length * buffer.numberOfChannels * 4;
      } catch {
        failure = { code: "decode-failed", message: `Grand piano samples did not load (sample ${entry.id} could not be decoded). Retry loading.` };
        return;
      }
      loaded += 1;
      opts.onProgress(loaded, entries.length);
    }
  };
  await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
  if (failure) return fail(failure);

  const voices: InstrumentVoices = {
    id: "grand-piano",
    label: "Grand piano",
    releaseTauSec: PIANO_RELEASE_TAU_SEC,
    layers(note, velocity): VoiceLayer[] {
      const { rootMidi, playbackRate } = chooseSample(note);
      return layerWeights(velocity).map(({ layer, weight }) => {
        const sample = buffers.get(key(rootMidi, layer));
        if (!sample) throw new Error(`Grand piano sample ${rootMidi}/${layer} is not loaded.`);
        return { buffer: sample.buffer, playbackRate, offsetSec: sample.offsetSec, gain: weight };
      });
    },
  };
  return ok({ voices, decodedBytes });
}
