// Loopback static server for the production build. It is not an application
// backend: it serves dist/ only, on the canonical origin, with a strict CSP.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BIND_ADDRESS, CANONICAL_ORIGIN, PORT, canonicalRedirect } from "./origin.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

// Self-hosted scripts only. 'wasm-unsafe-eval' is the narrow capability that
// WebAssembly compilation needs (MediaPipe, Phase 3); no 'unsafe-eval', no
// remote connect sources. Workers may come from same-origin or blob: URLs.
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; "),
  "Permissions-Policy": "microphone=(), geolocation=(), camera=(self)",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const full = normalize(`${DIST}${relative}`);
  if (!full.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep)) return null;
  const info = await stat(full).catch(() => null);
  if (info?.isFile()) return full;
  if (info?.isDirectory()) return resolveFile(`${decoded.replace(/\/$/, "")}/index.html`);
  // Single-page app: unknown non-asset paths fall back to index.html.
  if (!extname(relative)) return `${DIST}index.html`;
  return null;
}

const server = createServer(async (req, res) => {
  const target = canonicalRedirect(req.headers.host, req.url);
  if (target === "reject") {
    res.writeHead(421, { "Content-Type": "text/plain" }).end(`Unexpected host. Open ${CANONICAL_ORIGIN}.`);
    return;
  }
  if (target !== null) {
    res.writeHead(308, { Location: target }).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const file = await resolveFile(req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS }).end("Not found");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      ...SECURITY_HEADERS,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Server error");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Vybe keeps your projects on ${CANONICAL_ORIGIN}, so it will not switch ports.`);
    console.error("Close the other program using that port (or a running `npm run dev`), then try again.");
  } else {
    console.error(`Server failed: ${error.message}`);
  }
  process.exitCode = 1;
});

stat(`${DIST}index.html`)
  .then(() => server.listen(PORT, BIND_ADDRESS, () => console.log(`Vybe is running at ${CANONICAL_ORIGIN}`)))
  .catch(() => {
    console.error('No production build found. Run "npm run build" first.');
    process.exitCode = 1;
  });
