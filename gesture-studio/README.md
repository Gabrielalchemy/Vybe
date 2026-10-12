# Vybe — gesture-studio

The local application for Vybe. Product behavior: [../PRD.md](../PRD.md). Technical contracts: [../architecture.md](../architecture.md). Presentation: [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md). Progress evidence: [docs/](docs/).

Requires Node 24 and npm. Internet access is only needed to install dependencies and prepare assets.

```sh
npm ci                  # install from the lockfile
npm run assets:prepare  # copy fonts/WASM, download the pinned hand model (needs internet once), write the manifest
npm run dev             # http://localhost:4173 (strict port)
npm run build && npm run start   # production build served on the same origin
```

Checks: `npm run typecheck`, `npm run lint`, `npm run test -- --run`, `npm run test:e2e`, `npm run verify:assets`.

Open the app at `http://localhost:4173`. Saved projects belong to that exact origin.
