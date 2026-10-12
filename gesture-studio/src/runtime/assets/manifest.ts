import { validateAssetManifest, type AssetManifest } from "../../domain/assetManifest";
import { fail, ok, type Result } from "../../domain/result";

let cached: Promise<Result<AssetManifest, string>> | null = null;

/** The installed asset manifest, validated once per page. */
export function loadManifest(baseUrl = "/assets/"): Promise<Result<AssetManifest, string>> {
  cached ??= (async () => {
    try {
      const response = await fetch(`${baseUrl}manifest.json`, { cache: "no-cache" });
      if (!response.ok) return fail("The asset list is missing. Run asset preparation again.");
      const manifest = validateAssetManifest(await response.json());
      return manifest.ok ? ok(manifest.value) : fail(`The asset list is invalid: ${manifest.error}`);
    } catch {
      return fail("The asset list could not be read from the local server.");
    }
  })();
  const pending = cached;
  void pending.then((r) => {
    if (!r.ok && cached === pending) cached = null; // Allow a retry after a failure.
  });
  return pending;
}
