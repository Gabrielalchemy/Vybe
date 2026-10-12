# Phase 3 — Camera tracking and personal calibration

Date: 2026-10-12 · Status: **automated checks passed · manual validation pending**

The software for this phase is complete and tested with synthetic hand traces and Chromium's synthetic camera. **The gate has not passed.** The Phase 3 gate concerns real hands on the real camera: both hands consistently select the intended pads; one press and one release per pinch; recovery never creates a press. That needs the owner's trials below.

## Requirement IDs

- R02: camera status shown independently; never started on page load; a specific state for each failure.
- R03: saved calibration profile, readiness check, recalibration, invalidation when the geometry changes, rejection of bad calibrations, a tempo recommendation from measured gestures.
- R04: silent selection; one press per pinch; a held pinch is latched; gaps are silent; anatomical roles; mirrored geometry agrees with hit testing.

## Completed

**Assets** (`npm run assets:prepare`):
- MediaPipe hand landmarker model `float16/1`, downloaded with a pinned SHA-256 (`fbc2a300…cde1`). Its MD5 was cross-checked against the server's published `x-goog-hash`.
- The WASM module build from `@mediapipe/tasks-vision@1.1.0`.
- The Apache-2.0 license, pinned at tag v0.10.21.
- These ~21 MB are git-ignored and recreated by the prepare script. `verify:assets` checks all 7 assets and 3 licenses.
- At runtime, the worker receives the model as bytes through the checksum-verifying loader. The WASM loader and binary are hash-checked before use.

**Domain** (`src/domain/tracking`, pure, 106 tests):
- `geometry`: palm centre (wrist and four MCP joints); pinch ratio measured in pixels, so aspect ratio doesn't bias it; rejects degenerate hands; mirroring transform applied once.
- `cursorFilter`: exponential filter, τ = 35 ms, with alpha computed from the actual time between frames. `pinchDetector`: hysteresis, plus confirmation across 2 valid frames spanning at least 20 ms, on the raw ratio (never smoothed).
- `calibration`:
  - Thresholds: `closedHigh` is the 90th percentile of closed ratios and `openLow` the 10th percentile of open ratios. Rejected if the gap is not positive, or is under 3× the larger median absolute deviation. Press = `closedHigh + .25·gap`; release = `closedHigh + .65·gap`.
  - Reach regions use the 5th–95th percentile of palm positions.
  - Tempo recommendation uses the slow end (90th percentile) of the measured cycles, rounded down to 5 BPM.
  - Profile validation; compatibility checks for camera, aspect ratio, mirroring, processing size and model hash.
- `identity`: continuity evidence and corrected-label evidence are evaluated separately. If they conflict while the palms are within 0.12 of each other, the frame is ambiguous; if they conflict on well-separated hands, continuity wins. Detection order is never used.
- `gestureInterpreter`: the hand-state table from architecture §5.
  - Selection is silent; a confirmed close presses once; a held pinch keeps its latched target.
  - Entering the rest strip rests the hand. A hand is lost after 150 ms without a valid observation, and an ambiguous frame disarms both hands.
  - Recovery after loss, rest, ambiguity, a configuration change or a resize needs neutral-open evidence.
- `calibrationSession`:
  - Steps: identify the left hand, then the right (this records the handedness correction); reach for each hand (6 s); 5 prompted open/close cycles per hand (1.5 s phases, first 500 ms ignored); then optional self-paced pinches.
  - Each failure has a specific correction message and a retry.
- `protocol` validates every worker message. `rollingStats` provides the p50/p95 windows and rate meters used for diagnostics.

**Runtime:**
- `vision.worker.ts`: a module worker; one frame at a time; the transferred `ImageBitmap` is always closed in `finally`; timestamps strictly increasing; reports its own inference duration; detection thresholds 0.6.
- `trackingClient.ts`: epochs; one frame in flight; results older than 100 ms discarded; watchdog for a worker stalled over 2 s; crash reporting. Inference never falls back to the main thread.
- `cameraSession.ts`: video only, requesting 1280×720 at 30 fps and reading back the negotiated settings. Error copy follows the design system. Stops tracks idempotently. Handles the camera disconnecting.
- `framePump.ts`: `requestVideoFrameCallback`, with a time-checked animation-frame fallback; resizes to a 640 px long edge; no queue.

**App and UI:**
- `HandControl` handles the camera/tracker lifecycle, compatibility, calibration, the readiness check and gesture routing.
  - "Start playing" is an explicit action. A 50 ms watchdog drives loss detection even when frames stop.
  - A tracker or camera failure pauses the session.
  - Turning the camera off, hiding the page, a configuration change or a lane resize releases camera-held lanes and needs open hands again.
  - CPU is used until the benchmark has chosen. "Measure tracking speed" runs each delegate with the live camera and keeps the successful one with the lower p95 turnaround.
- `SessionController.armCamera`: camera presses never arm themselves.
- UI:
  - Camera panel with a mirrored, letterboxed 240×135 preview (`object-fit: contain`, the same transform as hit testing) and the readiness check.
  - Calibration screen: large feed, one instruction at a time, real progress, retry/skip/cancel, and a privacy note.
  - L/R cursor rings and a silent hover outline drawn from the same `LayoutDefinition` through refs (no per-frame React state). "Open your left/right hand to resume" hints.
  - Camera status in the status strip.
  - Settings → Camera & calibration: camera choice, recalibrate, benchmark results, and live diagnostics labelled as component measurements.

## Checks run (2026-10-12)

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm run test -- --run` | 21 files, 192 tests passed |
| `npm run verify:assets` | 7 assets, 3 licenses verified |
| `npm run build` | Pass (the worker bundles separately: `vision.worker-*.js`, 156 kB) |
| `npm run test:e2e` (dev server) | 29 passed |
| `test:e2e` against `npm run start` (strict CSP); the dev-only simulator and showcase tests excluded | 27 passed: MediaPipe worker and WASM load under CSP with only `'wasm-unsafe-eval'` |

The camera end-to-end tests use Chromium's synthetic device and a simulated `NotAllowedError` / `NotReadableError`. They cover:
- The camera stays off on load; turning it on reaches "calibration needed".
- Live worker results appear in the diagnostics.
- Calibration opens focused and passes an axe scan; cancel works.
- Camera off stops all tracks; a hidden page stops the camera; three on/off cycles leave no live tracks.
- Denied and in-use cameras show their specific copy, and the keyboard still works.

Mutation check: reversing the benchmark's choice rule (picking the higher p95) makes its test fail.

## Component measurements (not a benchmark)

A synthetic probe used headless Chromium 156 (Playwright build 1248) with software WebGL, the synthetic 1280×720 / 20 fps camera, frames at 640×360, no hands in view, and 4 s per delegate. Vite dev server and Playwright were running on the same i7-10510U.

| Delegate | Results | Inference p50 / p95 | Frame-to-result p50 / p95 | Results/s |
|---|---|---|---|---|
| CPU (worker) | 38 | 51 / 73 ms | 58 / 81 ms | ~10 |
| GPU (worker, software GL) | 0 accepted | 1773 / 2976 ms | — (both stale) | ~1 |

What this shows: the pipeline runs end to end, and a GPU delegate that initializes can still be unusable, so the delegate must be measured. It does **not** predict real Chrome on the laptop's GPU, or tracking with hands present (where the palm detector does not run every frame). If CPU turnaround stays near 60–80 ms on the real setup, the Phase 4 response target (<100 ms median) is at risk. Options include a 480 px processing edge or the GPU delegate, chosen from measurements.

## Owner measurement 1 — actual camera (2026-10-12, 18:50 EAT)

Conditions:
- Google Chrome 155.0.8059.39 (Flatpak `com.google.Chrome`), Wayland session.
- HP HD Camera; requested 1280×720 at 30 fps, and the settings report 30 fps.
- **On battery, CPU governor `powersave`** (about 1.9 GHz observed).
- Lighting not recorded. Hand presence during the benchmark not confirmed.
- No calibration yet. The GPU's backend (hardware or software WebGL) has not been checked; the machine has Intel UHD and NVIDIA Quadro P520.

| Delegate | Result | Frame to result, median / 95th | Results/s |
|---|---|---|---|
| CPU | Every result discarded as stale (>100 ms). Reported as "No frames were processed" by a reporting bug, since fixed. | not recorded (bug) | 5.0 |
| GPU (selected) | Worked | 69 / 79 ms | 7.5 |

Live tracking on GPU afterwards: camera frames 15.5/s; tracking results 14.5/s; inference median 66 ms, 95th 83 ms; frame to result median 68 ms, 95th 84 ms; 1 stale; 0 skipped.

Interpretation (estimate, not a measurement):
- The camera delivered about half its nominal rate, which is typical of auto-exposure in dim light.
- With a ~65 ms frame interval, ~68 ms frame-to-result, and the 2-frame pinch confirmation, the software path alone is roughly 200 ms before audio output. That is incompatible with the Phase 4 target of <100 ms median.
- To retest: on AC power with the balanced or performance profile; brighter front lighting (aiming for 30 fps delivery); and `chrome://gpu` checked for hardware-accelerated WebGL2.

Fix from this run: the benchmark now records the age of every result, including stale ones, and reports a too-slow delegate as "Results arrived too late to use" with its timings. There is a regression test for this.

## Owner measurement 2 — on AC power (2026-10-12, 21:22 EAT)

Conditions:
- Same Chrome and camera as measurement 1. **Charging; power profile balanced.** Evening indoor light.
- `chrome://gpu`: WebGL and WebGL2 hardware accelerated through `--render-node-override=/dev/dri/renderD128`, which is the Intel UHD (PCI 00:02.0). The NVIDIA Quadro P520 runs the `nouveau` driver and is not used.

| Delegate | Result | Frame to result, median / 95th (all results) | Results/s |
|---|---|---|---|
| CPU | Worked | 112 / 159 ms | 7.0 |
| GPU (selected) | Worked | 50 / 70 ms | 12.0 |

Live tracking on GPU: camera frames 15.0/s; tracking results 14.5/s; inference median 39 ms, 95th 67 ms; frame to result median 40 ms, 95th 69 ms; 1 stale; 0 skipped.

Findings:
- Battery power-saving roughly doubled the inference time (66 → 39 ms median).
- The camera still delivers 15 fps against 30 requested, which matches auto-exposure in dim light. This is now the largest remaining term.
- Software-path estimate (not a physical measurement): at 15 fps about 190 ms median before audio output; at 30 fps about 120–140 ms. Both are above the Phase 4 target of <100 ms median, so the physical measurement in Phase 4 is decisive.

Change from this run: Settings shows a warning when the camera delivers fewer than 25 frames per second while 30 were negotiated, explaining that light is the likely cause.

## Manual validation procedure (owner)

Preconditions:
- Install Google Chrome. Use the laptop camera, with even front lighting and a plain background if possible. Record the conditions.
- Run `npm run assets:prepare`, then `npm run dev`. Open `http://localhost:4173` in Chrome.

1. **Measure tracking speed:** Play → Camera on. Settings → Camera & calibration → Measure tracking speed, with both hands in view. Record the table (CPU and GPU: median, p95, results per second).
2. **Calibrate:** Play → Calibrate hands, and follow the prompts. Record any step that failed and its message. Confirm the readiness check marks both hands, then press Start playing.
3. **Selection** (gate item 1): for each of the 8 chord slots and 12 melody keys, hover with the open hand. Record whether the outline shows the intended target, and any flicker at boundaries. Repeat near the edges of the regions.
4. **One press, one release** (gate item 2): open Settings → Diagnostics → Recent input. On a few targets per hand, do 20 deliberate pinches. Count presses and releases; there should be exactly one of each per pinch. Hold a pinch for 3 s while moving across keys: there should be no new press and the held target should stay the same.
5. **Recovery** (gate item 3):
   - Move a hand out of view while pinched, then return it still pinched. There should be no press, and the hint should read "Open your … hand to resume".
   - Cross the hands. They should disarm, not swap lanes.
   - Enter the rest strip, then leave it open. It should re-arm without sound.
6. Record counts in a dated file under `docs/`, with browser version, delegate, lighting and calibration date.

Phase 4 repeats this at the full 500-attempt scale with sound and physical latency measurement.

## Decisions within the specification

- The model is passed to the worker as verified bytes (`modelAssetBuffer`) rather than a URL, so runtime integrity is checked. The WASM loader and binary are hashed, then loaded from the same-origin URL. This avoids adding `blob:` to `script-src`.
- The loss timeout is 150 ms on the main-thread path. Phase 4's audio lease enforces the 200 ms limit independently of main-thread delays.
- Mirroring is fixed on (selfie view) and stored in the profile; a change invalidates calibration.
- CPU is the default until the owner's benchmark picks a delegate; the preference is stored with the measurements.

## Limitations and remaining work

- No real-hand evidence yet. Accuracy, duplicates and comfort need the procedure above in Chrome.
- There is still no sound (Phase 4). Camera presses show Held/Pedal states and the diagnostics only.
- The thresholds (0.6 detector, 150 ms loss, 35 ms τ, 2-frame/20 ms confirmation, 0.12 overlap distance) are starting values to tune against labelled trials.

## Next required step

The owner runs the manual procedure in Chrome and records the results. Then Phase 4: the audio engine, piano samples, audio leases, and the instrument gate.
