// Runs the browser suite against the production build served by `npm run start`
// (strict CSP), skipping @dev tests that import source modules or dev fixtures.
// Refuses to run if port 4173 is already in use rather than testing the wrong server.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { BIND_ADDRESS, PORT } from "./origin.mjs";

const inUse = () =>
  new Promise((resolve) => {
    const socket = createConnection({ host: BIND_ADDRESS, port: PORT });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

if (await inUse()) {
  console.error(`Port ${PORT} is in use. Stop the dev server first so the production build is what gets tested.`);
  process.exit(1);
}

const server = spawn(process.execPath, ["scripts/serve.mjs"], { stdio: ["ignore", "inherit", "inherit"] });
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);

for (let i = 0; i < 50 && !(await inUse()); i++) await new Promise((r) => setTimeout(r, 100));
const tests = spawn("npx", ["playwright", "test", "--grep-invert", "@dev"], { stdio: "inherit" });
tests.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
