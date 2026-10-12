// Explicit installation step: copies locally licensed runtime assets from
// installed npm packages into public/assets and writes the asset manifest with
// exact sources, licenses and SHA-256 hashes. Never runs during playback.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ASSET_ROOT, MANIFEST_URL, sha256File } from "./asset-lib.mjs";
import { PIANO_LICENSE, preparePiano } from "./prepare-piano.mjs";

const pkgRoot = new URL("../node_modules/", import.meta.url);
const pkgVersion = async (name) => JSON.parse(await readFile(new URL(`${name}/package.json`, pkgRoot), "utf8")).version;

const FONT_FILES = [
  { pkg: "@fontsource/ibm-plex-sans", file: "ibm-plex-sans-latin-400-normal.woff2", id: "font-ibm-plex-sans-400" },
  { pkg: "@fontsource/ibm-plex-sans", file: "ibm-plex-sans-latin-500-normal.woff2", id: "font-ibm-plex-sans-500" },
  { pkg: "@fontsource/ibm-plex-sans", file: "ibm-plex-sans-latin-600-normal.woff2", id: "font-ibm-plex-sans-600" },
  { pkg: "@fontsource/ibm-plex-mono", file: "ibm-plex-mono-latin-400-normal.woff2", id: "font-ibm-plex-mono-400" },
];

// Remote sources are pinned by SHA-256. A mismatch stops preparation; nothing
// is replaced with an unverified file.
const REMOTE = [
  {
    id: "mediapipe-hand-landmarker",
    kind: "model",
    path: "mediapipe/hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
    license: "Apache-2.0",
    licenseFile: "licenses/MediaPipe-Apache-2.0.txt",
    upstream: "https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker",
    upstreamVersion: "hand_landmarker float16/1 (Last-Modified 2023-04-26)",
  },
];

const LICENSE_DOWNLOADS = [
  {
    id: PIANO_LICENSE.id,
    path: PIANO_LICENSE.path,
    url: PIANO_LICENSE.url,
    sha256: "e6bc9e9c474700b708f568bac9e5a8a9bcb2b1dad53442f5ba449fcb848b8e76",
  },
  {
    id: "apache-2.0-mediapipe",
    path: "licenses/MediaPipe-Apache-2.0.txt",
    url: "https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE",
    sha256: "8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8",
  },
];

// Module-worker build with SIMD; Chrome supports both.
const MEDIAPIPE_WASM = ["vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm"];

async function fetchPinned({ url, sha256, path }) {
  const target = new URL(path, ASSET_ROOT);
  const existing = await sha256File(target).catch(() => null);
  if (existing?.sha256 === sha256) return "kept";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${actual}. Nothing was replaced.`);
  const tmp = new URL(`${path}.partial`, ASSET_ROOT);
  await writeFile(tmp, bytes);
  await rename(tmp, target);
  return "downloaded";
}

async function main() {
  await mkdir(new URL("fonts/", ASSET_ROOT), { recursive: true });
  await mkdir(new URL("licenses/", ASSET_ROOT), { recursive: true });
  await mkdir(new URL("mediapipe/", ASSET_ROOT), { recursive: true });

  const licenses = [
    { id: "ofl-ibm-plex-sans", path: "licenses/IBM-Plex-Sans-OFL-1.1.txt", from: "@fontsource/ibm-plex-sans/LICENSE" },
    { id: "ofl-ibm-plex-mono", path: "licenses/IBM-Plex-Mono-OFL-1.1.txt", from: "@fontsource/ibm-plex-mono/LICENSE" },
  ];
  for (const l of licenses) await copyFile(new URL(l.from, pkgRoot), new URL(l.path, ASSET_ROOT));
  for (const l of LICENSE_DOWNLOADS) {
    console.log(`${l.path}: ${await fetchPinned(l)}`);
    licenses.push({ id: l.id, path: l.path });
  }

  const assets = [];
  for (const f of FONT_FILES) {
    const path = `fonts/${f.file}`;
    await copyFile(new URL(`${f.pkg}/files/${f.file}`, pkgRoot), new URL(path, ASSET_ROOT));
    const { sha256, bytes } = await sha256File(new URL(path, ASSET_ROOT));
    const version = await pkgVersion(f.pkg);
    assets.push({
      id: f.id,
      kind: "font",
      path,
      sha256,
      bytes,
      license: "OFL-1.1",
      licenseFile: f.pkg.endsWith("mono") ? "licenses/IBM-Plex-Mono-OFL-1.1.txt" : "licenses/IBM-Plex-Sans-OFL-1.1.txt",
      source: {
        upstream: "https://github.com/IBM/plex",
        package: `${f.pkg}@${version}`,
        packageFile: `files/${f.file}`,
      },
      conversion: "Copied unchanged from the npm package (latin subset WOFF2).",
    });
  }

  const mpVersion = await pkgVersion("@mediapipe/tasks-vision");
  for (const file of MEDIAPIPE_WASM) {
    const path = `mediapipe/wasm/${file}`;
    await mkdir(new URL("mediapipe/wasm/", ASSET_ROOT), { recursive: true });
    await copyFile(new URL(`@mediapipe/tasks-vision/wasm/${file}`, pkgRoot), new URL(path, ASSET_ROOT));
    const { sha256, bytes } = await sha256File(new URL(path, ASSET_ROOT));
    assets.push({
      id: `mediapipe-${file.replace(/[._]/g, "-")}`,
      kind: file.endsWith(".wasm") ? "wasm" : "wasm-loader",
      path,
      sha256,
      bytes,
      license: "Apache-2.0",
      licenseFile: "licenses/MediaPipe-Apache-2.0.txt",
      source: { upstream: "https://github.com/google-ai-edge/mediapipe", package: `@mediapipe/tasks-vision@${mpVersion}`, packageFile: `wasm/${file}` },
      conversion: "Copied unchanged from the npm package.",
    });
  }

  for (const r of REMOTE) {
    console.log(`${r.path}: ${await fetchPinned(r)}`);
    const { bytes } = await sha256File(new URL(r.path, ASSET_ROOT));
    assets.push({
      id: r.id,
      kind: r.kind,
      path: r.path,
      sha256: r.sha256,
      bytes,
      license: r.license,
      licenseFile: r.licenseFile,
      source: { upstream: r.upstream, url: r.url, upstreamVersion: r.upstreamVersion },
      conversion: "Downloaded unchanged; SHA-256 pinned in scripts/prepare-assets.mjs.",
    });
  }

  assets.push(...(await preparePiano({ log: (m) => process.stdout.write(`${m}\n`) })));

  const manifest = {
    schemaVersion: 1,
    packVersion: "vybe-assets-1",
    generatedBy: "scripts/prepare-assets.mjs",
    licenses: licenses.map(({ id, path }) => ({ id, path })),
    assets,
  };
  await writeFile(MANIFEST_URL, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared ${assets.length} assets and ${licenses.length} license files in public/assets.`);
}

main().catch((error) => {
  console.error(`Asset preparation failed: ${error.message}`);
  process.exitCode = 1;
});
