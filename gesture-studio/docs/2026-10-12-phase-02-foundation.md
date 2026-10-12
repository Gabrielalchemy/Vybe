# Phase 2 — Application foundation

Date: 2026-10-12 · Status: **automated checks passed**

## Requirement IDs

R01 (local assets, no remote requests), R02 (independent status, no autostart, recoverable states), R16 (design tokens, keyboard and pointer operation, accessibility), plus the Phase 2 gate: the app starts consistently, foundational checks pass, and simulated input moves through the event pipeline.

## Completed

**Tooling** (`gesture-studio/`): React 19.3 + TypeScript 6.0.3 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) + Vite 8.3.4; ESLint 10 with typescript-eslint strict; Vitest 5.0.3; Playwright 1.64.0 + axe-core. All versions are pinned exactly in `package-lock.json`.

**Domain** (`src/domain`, pure, lint-enforced to not use React or browser globals):
- `pitch.ts`: A0–C8 range; spelling with octaves; melody octaves keep edge notes visible but unavailable.
- `chords.ts`, `presets.ts`: chord pads store exact, ascending, unique pitches (1–8 notes); runtime validation of stored pads; all 12 factory voicings from architecture.md §7 as fixtures; PRD R09 scene defaults.
- `layout.ts`: one `LayoutDefinition` per lane, used for both rendering and hit testing. It covers seven naturals, accidentals on the 1/7, 2/7, 4/7, 5/7 and 6/7 boundaries, silent gaps, a 2 × 4 chord grid with gutters, a rest strip below a silent gap, 5% boundary hysteresis, and minimum-size checks.
- `events.ts`: contracts (`GestureIntent`, `PerformanceEvent` union, forced-release reasons).
- `voices.ts`: `VoiceRegistry`. Each voice has a unique id; releases are per id; sustain is per source; flush bypasses the pedal and clears it.
- `liveRouter.ts`: maps intents to voices.
  - One attack per press; no retrigger while held; the press latches its target.
  - Gaps, empty pads and out-of-range notes stay silent, still need a release, and are never substituted.
  - Rest and loss flush the affected hand.
  - Stale configuration revisions are rejected; remapping is refused while a key is held.
- `project.ts`, `saveStatus.ts`, `assetManifest.ts`: a versioned project record with full runtime validation; a save tracker that only shows "Saved" for a committed revision; manifest validation that rejects absolute, remote and `..` paths.

**Runtime and app:**
- `SessionController` owns live routing outside React.
  - It dispatches to the sink before publishing a frozen snapshot, and isolates subscriber failures so they cannot block note-offs.
  - Each hand belongs to one input source at a time; lifecycle interruption pauses until an explicit Resume.
- `simulator.ts`: four deterministic input scripts that drive the same path as real input.
- `ProjectSession` opens or creates the project and autosaves 2 s after the last edit. On failure it keeps the project in memory with a persistent warning. It never overwrites an unreadable project.
- `indexedDbRepository.ts`: database `vybe` v1 with all logical stores.
  - Commits are revision-checked and resolve only after `oncomplete`; there is a snapshot per revision.
  - Quota errors map to `quota-exceeded`; stores are never deleted on upgrade.
- `assetLoader.ts`: returns bytes only after the size and SHA-256 match.

**Interface:**
- Header (Play / Practice / Studio, project name, save state, Settings), performance row (tempo, sustain state, Rest left, Rest right, Stop all) and status strip (sticky).
- Play lanes are rendered from the layout definitions.
- Pointer capture, key-up and blur release notes. Space/Enter on a focused pad auditions it.
- Keyboard map from DESIGN_SYSTEM.md §5; Escape stops everything first.
- Visual states: Held / Pedal / Empty / Out of range / Resting.
- Chord pitch panel; octave controls that refuse to change while a key is held.
- Settings dialog (Storage with persistent-storage request, Diagnostics with the input log; development-only simulator).
- Hidden-page pause with Resume; small-window message; dev-only component showcase at `/?showcase`.

**Serving and assets:**
- `npm run dev` and `npm run start` bind `127.0.0.1:4173` with a strict port.
- `127.0.0.1` / `[::1]` redirect (308) to the canonical `http://localhost:4173`, so one origin owns IndexedDB. Unexpected Host headers are rejected.
- The production server sends a self-hosted-only CSP (`'wasm-unsafe-eval'` is the only script capability), `Permissions-Policy: microphone=()`, and rejects path traversal.
- IBM Plex fonts are copied locally by `assets:prepare`, with OFL licenses, and recorded in `public/assets/manifest.json` with SHA-256. `verify:assets` fails on size or hash mismatch and on unlisted files.

## Checks run (2026-10-12, after a clean `npm ci`)

| Command | Result |
|---|---|
| `npm ci` | Installed from the lockfile; 0 vulnerabilities reported |
| `npm run typecheck` | Pass, no errors |
| `npm run lint` | Pass, 0 errors, 0 warnings |
| `npm run test -- --run` | 12 files, 101 tests passed |
| `npm run verify:assets` | 4 assets and 2 license files verified. The tamper test (one byte appended plus a stray file) failed as intended, then passed after restoring. |
| `npm run build` | Pass (runs asset verification and typecheck first) |
| `npm run test:e2e` (dev server) | 21 passed |
| `npm run test:e2e` against `npm run start` (production build, strict CSP), simulator test excluded because it is dev-only | 19 passed, including no console errors and no remote requests |
| Manual `curl` against `npm run start` | Headers present; 308 redirect; 421 for a foreign Host; 404 for `..` traversal; listening on 127.0.0.1 only; a clear error and no port change when 4173 is busy |

The end-to-end suite covers:
- Keyboard and pointer hold/release, including pointer capture while moving.
- Sustain/Pedal, Escape, Rest with the pedal down, and empty pads.
- Octave refusal while held, then autosave and restore after reload.
- Hidden-page pause and Resume; dialog focus return.
- An axe scan with no violations.
- Target sizes at 1440×900, 1280×720 and 1024×640, with screenshots; the small-window message.
- Pointer hit accuracy 2 px inside adjacent key edges; the showcase.

## Decisions within the specification

- **tonal 6.4.3 instead of 6.5.0.** The 6.5.0 npm publish declares `main: dist/index.js`, which the package does not contain, so it does not resolve. 6.4.3 is the previous release.
- **TypeScript 6.0.3 instead of 7.0.** typescript-eslint 8.71 supports TypeScript below 6.1.
- **Canonical origin redirect.** The spec fixes `http://localhost:4173`. Because IndexedDB is per-origin, loopback-IP requests are redirected rather than served as a second, empty store.
- **Unbuilt controls are omitted, not shown as placeholders.** Transport play/record, count-in, metronome, assistance controls and camera start are absent until their phases. The UI states that sound and camera are not available in this build.
- **There is no audio clock yet.** `nowSec` uses `performance.now()/1000`, labelled as the session clock in Diagnostics. Phase 4 replaces it with `AudioContext.currentTime`.

## Limitations and remaining work

- **No sound.** The audio engine, piano assets and audio leases are Phase 4. The pads only show what would sound.
- **No camera or tracking** (Phase 3). The neutral-open arming of camera lanes is modelled in the router but not yet driven by real tracking.
- Save failures offer Retry. "Export backup" depends on archive export (Phase 9).
- Web Locks single-writer enforcement, Trash and migrations are Phase 9. The stores exist.
- The showcase shows states for later phases (Scale Guard blocked, cursors, loading, overload) visually only.
- Actual Chrome has not been used (it is not installed). Automated runs used Playwright Chromium 156.

## Next required step

Phase 3, camera tracking and calibration. It needs Chrome installed and the owner present for calibration trials.
