import { isSafeAssetPath, type AssetEntry } from "../../domain/assetManifest";
import { fail, ok, type Result } from "../../domain/result";

export type AssetErrorCode = "asset-missing" | "asset-unreachable" | "asset-checksum" | "asset-invalid-path";

export interface AssetError {
  code: AssetErrorCode;
  assetId: string;
  message: string;
}

export interface AssetLoader {
  /** Resolves only with bytes whose size and SHA-256 match the manifest. */
  load(entry: AssetEntry): Promise<Result<ArrayBuffer, AssetError>>;
}

export interface AssetLoaderDeps {
  /** Same-origin base path, e.g. "/assets/". */
  baseUrl: string;
  fetch: typeof fetch;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createAssetLoader(deps: AssetLoaderDeps): AssetLoader {
  return {
    async load(entry) {
      const err = (code: AssetErrorCode, message: string) => fail<AssetError>({ code, assetId: entry.id, message });
      if (!isSafeAssetPath(entry.path)) return err("asset-invalid-path", `Asset ${entry.id} has an invalid path.`);
      let response: Response;
      try {
        response = await deps.fetch(`${deps.baseUrl}${entry.path}`);
      } catch {
        return err("asset-unreachable", `Asset ${entry.id} could not be read from the local server.`);
      }
      if (!response.ok) return err("asset-missing", `Asset ${entry.id} is missing (HTTP ${response.status}). Re-run asset preparation.`);
      const data = await response.arrayBuffer();
      if (data.byteLength !== entry.bytes || (await sha256Hex(data)) !== entry.sha256) {
        return err("asset-checksum", `Asset ${entry.id} does not match its recorded checksum.`);
      }
      return ok(data);
    },
  };
}
