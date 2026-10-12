import { describe, expect, it } from "vitest";
import { createAssetLoader } from "../../../src/runtime/assets/assetLoader";
import { validateAssetManifest, type AssetEntry } from "../../../src/domain/assetManifest";

const bytes = new TextEncoder().encode("piano sample bytes");
async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const entry = async (overrides: Partial<AssetEntry> = {}): Promise<AssetEntry> => ({
  id: "piano-c4-v10",
  kind: "sample",
  path: "piano/C4v10.flac",
  sha256: await sha256Hex(bytes),
  bytes: bytes.byteLength,
  license: "CC-BY-3.0",
  licenseFile: "licenses/salamander.txt",
  source: { upstream: "https://example.invalid/salamander" },
  sample: { instrument: "grand-piano", rootMidi: 60, velocityLayer: 10, attackOffsetSec: 0.003, durationSec: 7, decodedBytesEstimate: 2688000 },
  ...overrides,
});

const fakeFetch = (body: Uint8Array | null, status = 200) =>
  (async () =>
    body === null ? new Response(null, { status: 404 }) : new Response(body.slice(), { status })) as unknown as typeof fetch;

describe("asset loader", () => {
  it("returns verified bytes when size and SHA-256 match", async () => {
    const loader = createAssetLoader({ baseUrl: "/assets/", fetch: fakeFetch(bytes) });
    const result = await loader.load(await entry());
    expect(result.ok).toBe(true);
    expect(result.ok && new Uint8Array(result.value).byteLength).toBe(bytes.byteLength);
  });

  it("rejects a checksum mismatch instead of using the data", async () => {
    const loader = createAssetLoader({ baseUrl: "/assets/", fetch: fakeFetch(new TextEncoder().encode("piano sample bytez")) });
    const result = await loader.load(await entry());
    expect(!result.ok && result.error.code).toBe("asset-checksum");
  });

  it("reports a missing file with its id", async () => {
    const loader = createAssetLoader({ baseUrl: "/assets/", fetch: fakeFetch(null) });
    const result = await loader.load(await entry());
    expect(!result.ok && result.error).toMatchObject({ code: "asset-missing", assetId: "piano-c4-v10" });
  });

  it("reports a network failure distinctly", async () => {
    const loader = createAssetLoader({ baseUrl: "/assets/", fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch });
    const result = await loader.load(await entry());
    expect(!result.ok && result.error.code).toBe("asset-unreachable");
  });

  it("only requests same-origin relative asset paths", async () => {
    const requested: string[] = [];
    const loader = createAssetLoader({
      baseUrl: "/assets/",
      fetch: (async (url: string) => { requested.push(url); return new Response(bytes.slice()); }) as unknown as typeof fetch,
    });
    await loader.load(await entry());
    expect(requested).toEqual(["/assets/piano/C4v10.flac"]);
  });
});

describe("validateAssetManifest", () => {
  it("accepts a well-formed manifest", async () => {
    const manifest = { schemaVersion: 1, packVersion: "vybe-assets-1", licenses: [{ id: "l", path: "licenses/salamander.txt" }], assets: [await entry()] };
    expect(validateAssetManifest(manifest).ok).toBe(true);
  });

  it("rejects path traversal, absolute and remote paths", async () => {
    for (const path of ["../secret", "/etc/passwd", "https://cdn.example/x.wasm", "a/../../b"]) {
      const manifest = { schemaVersion: 1, packVersion: "p", licenses: [], assets: [await entry({ path })] };
      expect(validateAssetManifest(manifest).ok, path).toBe(false);
    }
  });

  it("rejects malformed hashes and sizes", async () => {
    for (const bad of [{ sha256: "abc" }, { bytes: -1 }, { bytes: 1.5 }]) {
      const manifest = { schemaVersion: 1, packVersion: "p", licenses: [], assets: [await entry(bad)] };
      expect(validateAssetManifest(manifest).ok).toBe(false);
    }
  });
});

describe("sample metadata", () => {
  const sampleMeta = { instrument: "grand-piano", rootMidi: 60, velocityLayer: 10, attackOffsetSec: 0.003, durationSec: 7, decodedBytesEstimate: 2688000 };
  const manifestWith = async (overrides: Partial<AssetEntry> & Record<string, unknown>) => ({
    schemaVersion: 1,
    packVersion: "p",
    licenses: [],
    assets: [await entry({ kind: "sample", ...overrides } as Partial<AssetEntry>)],
  });

  it("accepts a sample with complete metadata", async () => {
    const r = validateAssetManifest(await manifestWith({ sample: sampleMeta }));
    expect(r.ok && r.value.assets[0]?.sample?.rootMidi).toBe(60);
  });

  it("rejects a sample without metadata or with impossible values", async () => {
    const { sample: _omit, ...withoutMeta } = await entry();
    void _omit;
    expect(validateAssetManifest({ schemaVersion: 1, packVersion: "p", licenses: [], assets: [withoutMeta] }).ok).toBe(false);
    expect(validateAssetManifest(await manifestWith({ sample: { ...sampleMeta, attackOffsetSec: -0.1 } })).ok).toBe(false);
    expect(validateAssetManifest(await manifestWith({ sample: { ...sampleMeta, rootMidi: 130 } })).ok).toBe(false);
    expect(validateAssetManifest(await manifestWith({ sample: { ...sampleMeta, velocityLayer: 17 } })).ok).toBe(false);
  });
});

