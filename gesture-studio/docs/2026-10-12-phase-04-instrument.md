# Phase 4 — Core instrument

Date: 2026-10-12 · Status: **in progress (software built; automated checks passed) · instrument gate: manual validation pending**

**The Phase 4 gate has not passed.** It requires all of the following on the actual laptop, and none has been run yet: ≥99% correct triggers over 500 labelled attempts in three sessions; zero duplicates; ≤1 accidental note in five minutes of neutral movement; live voices released within 200 ms of tracking loss; a comfortable 20-minute session; and a physical pinch-to-sound median under 100 ms with p95 under 150 ms. Phase 3's manual validation is also still pending. Phases 5+ do not start until this gate is met.

## Requirement IDs

- R04/R05: sounding behaviour for presses, releases, sustain, rest, loss and Stop all, with recovery.
- Initial R08: sampled grand piano with three velocity layers, medium velocity, no substitute instrument, missing assets named.
- R02: sound starts only from a user action; audio interruption is a recoverable state.

## Completed

**Assets.** Salamander Grand Piano V3 (Alexander Holm, CC-BY 3.0) is pinned to `sfzinstruments/SalamanderGrandPiano@3382bf9`:
- **Selection:** 30 roots (A0 to C8, every minor third) × velocity layers 4, 10 and 16 = 90 files. Each download is verified against its git blob SHA-1 at the pinned commit. The originals are kept unchanged in git-ignored `asset-cache/`.
- **Derived files:** 48 kHz 16-bit FLAC with triangular dither; trimmed to 10 s (below C3), 7 s (to B4), 5 s (to B6) or 3 s, with a 0.5 s fade. The manifest records each file's root, layer, attack offset (0–9.6 ms, measured at −60 dBFS with 2 ms pre-roll), length, decoded-size estimate and SHA-256.
- **Size:** 23 MB on disk, 221 MiB decoded, within the 512 MiB budget.

**Domain** (pure, tested):
- `sampleMap`: the nearest root (always within ±1 semitone) and the playback rate to reach the note. Layer weights: each layer is used alone in its range; equal-power blending of neighbouring layers happens only at velocities 44–60 and 92–108. Medium (80) and loud (112) each use a single layer.
- `lease`: renewing from an observation schedules the fade to start at +180 ms and reach zero at +200 ms. A lease cannot be renewed after it expires, and an older observation cannot extend it.
- `voicePolicy`: the voice-limit order. Oldest released tail first, then the oldest pedal-held key, then the oldest voice, with ties broken by voice id.
- `VoiceRegistry.forget` and `SessionController.voiceStolen` keep the session's bookkeeping consistent with what is actually sounding.
- `GestureInterpreter.process` returns `observed`: hands with a valid, unambiguous measurement in the frame. Only these renew leases.

**Runtime and app:**
- `AudioEngine`:
  - **Graph:** voice envelope → lane safety gain → lane bus → master (−6 dB) → compressor (overload protection, not a true-peak limiter) → analyser → output.
  - **Attacks** start at the current audio time and are never backdated. Voices are identified by `voiceId`, never by pitch.
  - **Releases:** a key or pedal release decays exponentially with τ = 0.12 s for the piano. Forced releases fade exponentially with τ = 3.5 ms and stop at 30 ms. A linear ramp after `cancelAndHoldAtTime` clicked in Chrome, so it was replaced (a test covers this).
  - **Leases and voice limit:** leases are scheduled on the audio thread; voices are stolen at 128.
- `pianoBank`: every file is checksum-verified, then decoded four at a time with real progress counts. A missing or corrupt file fails the whole instrument with "Grand piano samples did not load (…). Retry loading." There is never a stand-in sound.
- `AudioRuntime`:
  - One `AudioContext` with `latencyHint: "interactive"`, created only from **Start sound**.
  - It becomes the session clock, so performance events now carry audio time.
  - An unexpected suspension pauses the session (`audio-interrupted`) and offers **Resume sound**.
  - It is the lease target for hand control.
- `HandControl` (leases):
  - **Start playing** is refused until sound is ready ("Start sound first…").
  - Camera lanes then run under leases. Each valid observation renews its lane's lease *before* that frame's events are routed.
  - The watchdog retires an expired lane and releases the hand in the session.
  - Leases are switched off when the camera stops or hand control pauses.
- **Stop all / Escape** release every live voice, clear the pedals and also cut decaying tails.
- **UI:**
  - Performance row: Start sound, a loading count, Sound on, Resume sound, and an error with Retry loading.
  - Status strip: sound state.
  - Settings → Audio: sample rate, the browser's base and output latency (labelled estimates), and sounding voices out of 128 with any stolen.
  - Settings → Camera: frame-to-note-sent timing (median and 95th).

## Checks run (2026-10-12)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Pass, 0 problems |
| `npm run test -- --run` | 22 files, 218 tests passed |
| `npm run verify:assets` | 97 assets, 4 licenses |
| `npm run build` | Pass |
| `npm run test:e2e` (dev server, Chromium 156 headless) | 41 passed |
| Production-build e2e | **Not run this time:** port 4173 was in use by the owner's dev server |

The audio tests render the real engine in `OfflineAudioContext`:
- **Releases:** a key release decays to silence with no step above 0.1. Releasing one owner's copy of a pitch leaves the other's sounding. A forced loss release is silent by 30 ms without a click.
- **Leases:**
  - An unrenewed camera lease silences a held note by 200 ms with no release sent and no main-thread code running (the stall case).
  - Renewal extends the sound to 200 ms after the latest observation.
  - A renewal during the fade recovers without a click.
  - Keyboard lanes are not leased.
- **Limits:** at 128 voices the oldest voices are stolen and reported. Panic is silent within 30 ms.

With the real piano, every key A0–C8 is non-silent. Pitch (autocorrelation with interpolation, notes 40–96) is within 19 cents of equal temperament. Offsets rise in steps of three notes from 0 in the bass to +19 cents near C7, which is the recording's stretch tuning, reproduced faithfully. Velocity 112 is ≥1.5× the RMS of velocity 48.

Browser tests also cover:
- No sound on page load; Start sound loads the piano; a held key shows 1 of 128 voices.
- A missing sample (a 404 for `C4-v10.flac`) shows the named error with Retry, and never "Sound on".

## Decisions within the specification

- **Sample trimming.** Full-length layers would need about 600 MB decoded, over the 512 MiB budget. Trimmed lengths with fades keep the piano at 221 MiB. Low notes held longer than 10 s (or high notes longer than 3–7 s) fade out early. This is audible on long sustained chords; the owner's listening review decides whether to revisit it (for example, longer bass tails with fewer layers).
- **Layer blending** only near boundaries, so the medium default plays one recording without phasing.
- **Forced releases** use an exponential fade, a workaround for Chrome's `cancelAndHoldAtTime` plus linear-ramp behaviour.

## Gate procedures (owner, actual laptop)

Preconditions:
- Charger connected, power profile Balanced or Performance.
- Bright, even front lighting; check Settings → Camera frames ≈ 30/s.
- **Built-in speakers or wired output, not Bluetooth.**
- Chrome; `npm run dev`; Start sound; Camera on; calibrate; Start playing.
- Record the date, Chrome version, delegate, calibration date, lighting and output device.

1. **Physical response** (median <100 ms, p95 <150 ms):
   - Film the hand and the laptop speaker with a phone at the highest available frame rate (≥240 fps if possible), with audio.
   - Make 100 deliberate single pinches on one key at about 1 per second.
   - For each one, measure from the first video frame where thumb and index touch to the audible onset in the recording.
   - Report the median, p95, min, max and n, plus the in-app "Frame to note sent" and browser latency estimates, labelled as component values.
2. **Trigger accuracy:**
   - Over three sessions, perform at least 500 attempts on prompted targets across both lanes and all pads.
   - Log intended versus observed (Settings → Diagnostics → Recent input).
   - Report correct, missed, wrong-target and duplicate counts separately.
3. **Accidental notes:** five minutes of neutral movement (repositioning, resting, gesturing without pinching), counting any notes that sound.
4. **Loss release:** while holding a chord with sustain down (Left Shift), move the hand out of view. The sound should stop within about 200 ms; video can confirm this. Repeat with the hands crossing.
5. **Comfort:** a 20-minute session with ordinary rests. Note reach, pinch fatigue and posture.

Measured inputs so far (Phase 3 measurements 1–2): ~40 ms tracking turnaround on GPU, and a camera at 15 fps in the evening. The estimated software path at 30 fps is ~120–140 ms, so the physical-response item is at risk.

## Remaining work

- The owner runs the gate procedures above.
- Run the production-build e2e (strict CSP) once port 4173 is free.
- Optional tooling for the 500-attempt trial: an in-app prompted-target trial that logs intended/observed counts. It is not built yet; I recommend it before step 2.
