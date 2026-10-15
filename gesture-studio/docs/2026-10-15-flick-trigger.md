# Finger-flick play gesture (A10)

Date: 2026-10-15 · Status: **automated checks passed · manual validation pending**

## Why

Owner feedback after the first warm-up trial: pinching is **too slow** and **often doesn't register**. The warm-up also showed 14 notes from the resting hand in 50 attempts. The owner chose a **finger flick**: fingers flick down from the knuckles while the hand stays over the target; holding them down holds the note; lifting releases it. Pinch remains a setting.

## What changed

- **Signal:** `fingerExtension` (geometry.ts) is the mean projection of fingertips 8, 12 and 16 onto the wrist-to-middle-MCP axis, in palm widths and pixel space. It is unchanged by moving or resizing the whole hand (tested).
- **`FlickDetector`:** implements the same `TriggerDetector` interface as `PinchDetector`.
  - It presses during the stroke: two falling frame pairs over at least 20 ms, plus a fall of at least `dropMin`.
  - A slow fold, a single noisy frame, or whole-hand movement does not press.
  - Holding never re-presses; lifting releases; a reset needs an open hand.
- **Interpreter:** chooses the detector from the profile. A flick press latches the pad hovered on the stroke's first frame. Flick sensitivity (Less, Normal, More) scales the thresholds by 1.2, 1 or 0.8. Pinch behaviour is unchanged; every earlier pinch trace still passes.
- **Calibration:**
  - The profile moves to version 2 with `trigger`. Version 1 profiles are rejected, so the owner recalibrates.
  - A flick profile must carry flick thresholds with ordered levels. Choosing the other gesture makes the profile incompatible.
  - `calibrateFlick` places thresholds between ordinary movement and the owner's flicks, and rejects overlap or inconsistent flicks.
  - The wizard per hand: 2 s open, 8 prompted flicks (1.2 s each), then 6 s of moving between pads. The pace step uses flicks.
- **App:** `HandControl` remembers `triggerGesture` (default flick) and `flickSensitivity`, applies them immediately, and loads them at startup. Trials record the gesture and its thresholds.
- **UI:** Settings → Play gesture (Finger flick / Pinch radio group, with help text) and Flick sensitivity. Calibration, camera panel and status wording follow the chosen gesture.
- **Specs:** architecture A10 and §5 (signal, press rule, latch, calibration, sensitivity); PRD R03, R04, journey and acceptance wording; the design system's cursor wording.

## Checks

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Pass |
| `npm run test -- --run` | 284 passed: flick detector 10, flick calibration 7, flick interpreter traces 6, flick wizard 3, profile v2 4, gesture preferences 4, geometry 3 new |
| Browser | Gesture settings: default, persistence, sensitivity only for flick, axe scan; camera tests pass |

## Not yet known (owner)

- Whether real flicks are detected reliably, and fast enough, on this camera. Synthetic hands are not evidence.
- Procedure:
  1. Settings → Play gesture: Finger flick → Recalibrate.
  2. A 50-attempt trial with flick and one with pinch, in the same light. Export both.
  3. Film 20 flicks and 20 pinches to compare stroke-to-sound time.
- Flick stays the default only if the trials support it (A10).
