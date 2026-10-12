import { fail, ok, type Result } from "./result";

export type AssetKind = "font" | "sample" | "model" | "wasm" | "wasm-loader";

export interface AssetEntry {
  id: string;
  kind: AssetKind;
  /** Relative to the local assets directory; never absolute or remote. */
  path: string;
  sha256: string;
  bytes: number;
  license: string;
  licenseFile: string;
  source: { upstream: string; package?: string; packageFile?: string; url?: string; upstreamVersion?: string };
  conversion?: string;
  /** Required for kind "sample". */
  sample?: SampleMeta;
}

export interface SampleMeta {
  instrument: string;
  rootMidi: number;
  velocityLayer: number;
  /** Seconds of near-silence before the attack; playback starts here. */
  attackOffsetSec: number;
  durationSec: number;
  decodedBytesEstimate: number;
}

export interface AssetManifest {
  schemaVersion: 1;
  packVersion: string;
  licenses: { id: string; path: string }[];
  assets: AssetEntry[];
}

const KINDS: readonly AssetKind[] = ["font", "sample", "model", "wasm", "wasm-loader"];

export function isSafeAssetPath(path: unknown): path is string {
  if (typeof path !== "string" || path === "") return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes(":")) return false;
  return !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function validateEntry(v: unknown, i: number): Result<AssetEntry> {
  const at = `assets[${i}]`;
  if (!isObj(v)) return fail(`${at} must be an object.`);
  if (typeof v.id !== "string" || v.id === "") return fail(`${at}.id is missing.`);
  if (!KINDS.includes(v.kind as AssetKind)) return fail(`${at}.kind is unknown.`);
  if (!isSafeAssetPath(v.path)) return fail(`${at}.path must be a relative local path.`);
  if (typeof v.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(v.sha256)) return fail(`${at}.sha256 is malformed.`);
  if (typeof v.bytes !== "number" || !Number.isInteger(v.bytes) || v.bytes < 0) return fail(`${at}.bytes is invalid.`);
  if (typeof v.license !== "string" || v.license === "") return fail(`${at}.license is missing.`);
  if (!isSafeAssetPath(v.licenseFile)) return fail(`${at}.licenseFile is invalid.`);
  if (!isObj(v.source) || typeof v.source.upstream !== "string") return fail(`${at}.source.upstream is missing.`);
  if (v.kind === "sample") {
    const m = v.sample;
    const num = (x: unknown, min: number, max: number) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
    if (
      !isObj(m) || typeof m.instrument !== "string" || !Number.isInteger(m.rootMidi) || !num(m.rootMidi, 0, 127) ||
      !Number.isInteger(m.velocityLayer) || !num(m.velocityLayer, 1, 16) || !num(m.attackOffsetSec, 0, 1) ||
      !num(m.durationSec, 0.01, 600) || !num(m.decodedBytesEstimate, 1, Number.MAX_SAFE_INTEGER)
    ) {
      return fail(`${at}.sample metadata is invalid.`);
    }
  }
  return ok(v as unknown as AssetEntry);
}

export function validateAssetManifest(value: unknown): Result<AssetManifest> {
  if (!isObj(value) || value.schemaVersion !== 1) return fail("Asset manifest schema is not recognised.");
  if (typeof value.packVersion !== "string" || value.packVersion === "") return fail("Asset manifest packVersion is missing.");
  if (!Array.isArray(value.licenses) || !Array.isArray(value.assets)) return fail("Asset manifest lists are missing.");
  const assets: AssetEntry[] = [];
  for (const [i, raw] of (value.assets as unknown[]).entries()) {
    const entry = validateEntry(raw, i);
    if (!entry.ok) return entry;
    assets.push(entry.value);
  }
  return ok({ schemaVersion: 1, packVersion: value.packVersion, licenses: value.licenses as AssetManifest["licenses"], assets });
}
