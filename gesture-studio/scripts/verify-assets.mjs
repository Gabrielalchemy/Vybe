// Verifies every manifest entry exists with the recorded size and SHA-256, has
// a license file, and that no unlisted file sits in public/assets.
import { readdir, readFile, stat } from "node:fs/promises";
import { ASSET_ROOT, MANIFEST_URL, isSafeRelativePath, sha256File } from "./asset-lib.mjs";

async function listFiles(dirUrl, prefix = "") {
  const out = [];
  for (const entry of await readdir(dirUrl, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(new URL(`${entry.name}/`, dirUrl), `${rel}/`)));
    else out.push(rel);
  }
  return out;
}

async function main() {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_URL, "utf8"));
  } catch (error) {
    throw new Error(`public/assets/manifest.json is missing or invalid. Run "npm run assets:prepare". (${error.message})`);
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || !Array.isArray(manifest.licenses)) {
    throw new Error("Manifest schema is not recognised.");
  }

  const licensePaths = new Set();
  for (const l of manifest.licenses) {
    if (!isSafeRelativePath(l.path)) problems.push(`Unsafe license path: ${l.path}`);
    else if (!(await stat(new URL(l.path, ASSET_ROOT)).catch(() => null))) problems.push(`Missing license file: ${l.path}`);
    licensePaths.add(l.path);
  }

  const ids = new Set();
  const listed = new Set(["manifest.json", ...licensePaths]);
  for (const a of manifest.assets) {
    if (ids.has(a.id)) problems.push(`Duplicate asset id: ${a.id}`);
    ids.add(a.id);
    if (!isSafeRelativePath(a.path)) {
      problems.push(`Unsafe asset path: ${a.path}`);
      continue;
    }
    listed.add(a.path);
    if (!a.license || !licensePaths.has(a.licenseFile)) problems.push(`${a.id}: license file not referenced in manifest.licenses`);
    if (!a.source?.upstream) problems.push(`${a.id}: missing upstream source`);
    const file = await sha256File(new URL(a.path, ASSET_ROOT)).catch(() => null);
    if (!file) {
      problems.push(`${a.id}: missing file ${a.path}`);
      continue;
    }
    if (file.bytes !== a.bytes) problems.push(`${a.id}: size ${file.bytes} != manifest ${a.bytes}`);
    if (file.sha256 !== a.sha256) problems.push(`${a.id}: SHA-256 mismatch`);
  }

  for (const rel of await listFiles(ASSET_ROOT)) {
    if (!listed.has(rel)) problems.push(`Unlisted file in public/assets: ${rel}`);
  }

  if (problems.length) {
    console.error(`Asset verification failed:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Verified ${manifest.assets.length} assets and ${manifest.licenses.length} license files (pack ${manifest.packVersion}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
