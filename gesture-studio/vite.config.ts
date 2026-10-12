import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { BIND_ADDRESS, PORT, canonicalRedirect } from "./scripts/origin.mjs";

// Keep every session on the one origin that owns local persistence and reject
// unexpected Host headers (DNS rebinding protection for a loopback server).
function canonicalOrigin(): Plugin {
  return {
    name: "vybe-canonical-origin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const target = canonicalRedirect(req.headers.host, req.url);
        if (target === null) return next();
        if (target === "reject") {
          res.statusCode = 421;
          res.end("Unexpected host. Open http://localhost:4173.");
          return;
        }
        res.statusCode = 308;
        res.setHeader("Location", target);
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), canonicalOrigin()],
  server: { host: BIND_ADDRESS, port: PORT, strictPort: true, open: false },
  build: { target: "es2023", sourcemap: true },
  worker: { format: "es" },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
  },
});
