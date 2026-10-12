# Phase 1 — Specification and technical baseline

Date: 2026-10-12 · Status: **manual validation pending**

The specification documents (PRD, architecture, design system, phases, agent guide) are complete and committed at the workspace root. This file records what was checked on the target machine and what remains unverified.

## Requirement IDs

R01 (local operation), capacity limits (PRD §5), hardware unknowns, measurement procedure.

## Environment observed (software inspection only)

| Item | Observed | How |
|---|---|---|
| OS | Fedora Linux 44 Workstation, kernel 7.2.9-300.vanilla.fc44 | `/etc/os-release`, `uname -r` |
| CPU / memory | Intel Core i7-10510U; 15 GiB RAM reported by `free -h` | `lscpu`, `free -h` |
| Camera | `/dev/video0`, `/dev/video1`; device name "HP HD Camera" | sysfs `video4linux` |
| Audio server | PulseAudio on PipeWire 1.6.9 | `pactl info` |
| Default audio output | **Bluetooth sink** (`bluez_output…`) | `pactl info` |
| Node / npm | 24.16.0 / 11.16.0 | `node -v`, `npm -v` |
| npm policy | `min-release-age = 3` (packages must be at least 3 days old) | `npm config list` |
| Google Chrome | **Not installed.** Firefox is installed. Playwright Chromium headless shell 156.0.8078.4 (build 1248) installed for automated tests. | `which`, Playwright install |
| Port 4173 | Free at time of check | `ss -ltn` |

The camera was not opened, and no audio was played or recorded, for this baseline.

## Unknowns that need validation tasks

| Unknown | Why it matters | When / how |
|---|---|---|
| Camera's negotiated resolution and frame rate | Frame interval sets a floor on pinch confirmation latency (2 frames, ≥20 ms) | Phase 3: read `MediaStreamTrack.getSettings()` in Chrome |
| Worker GPU vs CPU MediaPipe delegate | Architecture A03 requires a measured choice | Phase 3 benchmark: p95 frame turnaround per delegate |
| Audio output path | A Bluetooth output typically adds tens to hundreds of ms and would invalidate the <100 ms median / <150 ms p95 response target | **Phase 4 precondition:** run acceptance measurements on built-in speakers or wired output, and record the device |
| Chrome availability | The PRD's primary target browser | Owner installs Chrome before Phase 3 camera trials; automated tests use Playwright Chromium meanwhile |
| Physical gesture-to-sound latency | Cannot be inferred from browser metrics | Phase 4 procedure below |

## Physical response measurement procedure (draft for Phase 4)

1. Record a phone video at ≥240 fps (or the highest available) framing both the hand and the laptop speaker/screen, with audio.
2. Use built-in speakers or a wired output; note the device, volume and Chrome build.
3. Perform at least 100 deliberate pinches per session at a comfortable rate, across the three sessions required for the accuracy gate.
4. For each attempt, measure from the first video frame where thumb and index touch (completed pinch) to the audible onset in the recording's audio track.
5. Report median, p95, minimum, maximum and sample count. Report missed, wrong and duplicate triggers separately.
6. Label in-app component timings (frame delivery, inference, dispatch, `outputLatency`) as component measurements or estimates, never as the physical result.

## Remaining

- Owner confirmation of camera, audio output and Chrome installation.
- The physical measurement procedure is a draft until it is first executed in Phase 4.
