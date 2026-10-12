// Salamander Grand Piano V3 subset for the "grand-piano" instrument.
// Downloads originals pinned by git blob SHA-1 at a fixed commit, keeps them
// unchanged in asset-cache/, and derives trimmed 16-bit FLAC files with a
// fade-out. Records sample root, velocity layer, attack offset and the
// decoded-size estimate in the manifest.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { ASSET_ROOT, sha256File } from "./asset-lib.mjs";

const run = promisify(execFile);
const REPO = "sfzinstruments/SalamanderGrandPiano";
const COMMIT = "3382bf9496bba2486f5ab0de55a264d1dfc38404";
const CACHE = new URL("../asset-cache/salamander/", import.meta.url);
const LAYERS = [4, 10, 16];
const NOTE_INDEX = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const SAMPLE_RATE = 48000;
const FADE_SEC = 0.5;
// Onset threshold for the attack offset: -60 dBFS, with 2 ms pre-roll.
const ONSET_THRESHOLD = 0.001;
const PRE_ROLL_SEC = 0.002;

export const PIANO_LICENSE = {
  id: "cc-by-3.0-salamander",
  path: "licenses/Salamander-Grand-Piano-CC-BY-3.0.txt",
  url: `https://raw.githubusercontent.com/${REPO}/${COMMIT}/LICENSE`,
};

/** Trimmed length by register: long low notes, short high notes (decoded-memory budget). */
export function trimSeconds(midi) {
  if (midi < 48) return 10;
  if (midi < 72) return 7;
  if (midi < 96) return 5;
  return 3;
}

const midiOf = (root) => {
  const m = /^([A-G]#?)(\d)$/.exec(root);
  return 12 * (Number(m[2]) + 1) + NOTE_INDEX[m[1]];
};

const gitBlobSha1 = (bytes) => createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");

async function listing() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/Samples?ref=${COMMIT}`, { headers: { "User-Agent": "vybe-asset-prep" } });
  if (!res.ok) throw new Error(`Could not list Salamander samples: HTTP ${res.status}`);
  return new Map((await res.json()).map((f) => [f.name, f.sha]));
}

async function original(name, blobSha) {
  const target = new URL(name, CACHE);
  const cached = await readFile(target).catch(() => null);
  if (cached && gitBlobSha1(cached) === blobSha) return target;
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Samples/${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (gitBlobSha1(bytes) !== blobSha) throw new Error(`Checksum mismatch for ${name}. Nothing was replaced.`);
  await writeFile(new URL(`${name}.partial`, CACHE), bytes);
  await rename(new URL(`${name}.partial`, CACHE), target);
  return target;
}

async function attackOffsetSec(path) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path, "-t", "1", "-ac", "1", "-f", "f32le", "-"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  const i = samples.findIndex((v) => Math.abs(v) > ONSET_THRESHOLD);
  return Math.max(0, (i < 0 ? 0 : i) / SAMPLE_RATE - PRE_ROLL_SEC);
}

async function durationSec(path) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
  return Number(stdout.trim());
}

/** Prepares the piano subset; returns manifest asset entries. */
export async function preparePiano({ log }) {
  await mkdir(CACHE, { recursive: true });
  await mkdir(new URL("piano/", ASSET_ROOT), { recursive: true });
  const blobs = await listing();
  const roots = [...blobs.keys()]
    .map((n) => /^([A-G]#?\d)v\d+\.flac$/.exec(n)?.[1])
    .filter(Boolean)
    .filter((r, i, all) => all.indexOf(r) === i)
    .sort((a, b) => midiOf(a) - midiOf(b));
  if (roots.length !== 30) throw new Error(`Expected 30 sample roots, found ${roots.length}.`);

  const entries = [];
  for (const root of roots) {
    const midi = midiOf(root);
    for (const layer of LAYERS) {
      const name = `${root}v${layer}.flac`;
      const blobSha = blobs.get(name);
      if (!blobSha) throw new Error(`Missing ${name} at ${COMMIT}.`);
      const src = await original(name, blobSha);
      const outName = `${root.replace("#", "s")}-v${layer}.flac`;
      const path = `piano/${outName}`;
      const out = new URL(path, ASSET_ROOT);
      const srcDuration = await durationSec(src.pathname);
      const length = Math.min(trimSeconds(midi), srcDuration);
      {
        await run("ffmpeg", [
          "-v", "error", "-y", "-i", src.pathname, "-t", String(length),
          "-af", `afade=t=out:st=${(length - FADE_SEC).toFixed(3)}:d=${FADE_SEC},aresample=${SAMPLE_RATE}:osf=s16:dither_method=triangular`,
          "-c:a", "flac", "-sample_fmt", "s16", out.pathname,
        ]);
      }
      const { sha256, bytes } = await sha256File(out);
      const attack = await attackOffsetSec(out.pathname);
      entries.push({
        id: `piano-${root.replace("#", "s")}-v${layer}`,
        kind: "sample",
        path,
        sha256,
        bytes,
        license: "CC-BY-3.0",
        licenseFile: PIANO_LICENSE.path,
        source: {
          upstream: `https://github.com/${REPO}`,
          url: `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Samples/${encodeURIComponent(name)}`,
          upstreamVersion: `${COMMIT} (git blob ${blobSha})`,
        },
        conversion: `Trimmed to ${length.toFixed(2)} s with a ${FADE_SEC} s fade-out; 48 kHz 16-bit FLAC with triangular dither (ffmpeg).`,
        sample: {
          instrument: "grand-piano",
          rootMidi: midi,
          velocityLayer: layer,
          attackOffsetSec: Number(attack.toFixed(4)),
          durationSec: Number(length.toFixed(3)),
          decodedBytesEstimate: Math.ceil(length * SAMPLE_RATE * 2 * 4),
        },
      });
    }
    log(`piano ${root}: ready`);
  }
  return entries;
}
