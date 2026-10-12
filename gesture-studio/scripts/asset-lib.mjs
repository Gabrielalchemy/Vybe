import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const ASSET_ROOT = new URL("../public/assets/", import.meta.url);
export const MANIFEST_URL = new URL("manifest.json", ASSET_ROOT);

export async function sha256File(url) {
  const bytes = await readFile(url);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}

/** Rejects manifest paths that could escape public/assets. */
export function isSafeRelativePath(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}
