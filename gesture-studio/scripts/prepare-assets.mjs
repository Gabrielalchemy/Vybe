// Explicit installation step: copies locally licensed runtime assets from
// installed npm packages into public/assets and writes the asset manifest with
// exact sources, licenses and SHA-256 hashes. Never runs during playback.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { ASSET_ROOT, MANIFEST_URL, sha256File } from "./asset-lib.mjs";

const pkgRoot = new URL("../node_modules/", import.meta.url);
const pkgVersion = async (name) => JSON.parse(await readFile(new URL(`${name}/package.json`, pkgRoot), "utf8")).version;

const FONT_FILES = [
  { pkg: "@fontsource/ibm-plex-sans", file: "ibm-plex-sans-latin-400-normal.woff2", id: "font-ibm-plex-sans-400" },
  { pkg: "@fontsource/ibm-plex-sans", file: "ibm-plex-sans-latin-500-normal.woff2", id: "font-ibm-plex-sans-500" },
  { pkg: "@fontsource/ibm-plex-sans", file: "ibm-plex-sans-latin-600-normal.woff2", id: "font-ibm-plex-sans-600" },
  { pkg: "@fontsource/ibm-plex-mono", file: "ibm-plex-mono-latin-400-normal.woff2", id: "font-ibm-plex-mono-400" },
];

async function main() {
  await mkdir(new URL("fonts/", ASSET_ROOT), { recursive: true });
  await mkdir(new URL("licenses/", ASSET_ROOT), { recursive: true });

  const licenses = [
    { id: "ofl-ibm-plex-sans", path: "licenses/IBM-Plex-Sans-OFL-1.1.txt", from: "@fontsource/ibm-plex-sans/LICENSE" },
    { id: "ofl-ibm-plex-mono", path: "licenses/IBM-Plex-Mono-OFL-1.1.txt", from: "@fontsource/ibm-plex-mono/LICENSE" },
  ];
  for (const l of licenses) await copyFile(new URL(l.from, pkgRoot), new URL(l.path, ASSET_ROOT));

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
