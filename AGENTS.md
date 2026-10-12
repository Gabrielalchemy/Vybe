# Guide for agents building Vybe

This guide applies throughout this workspace. Follow the user's current request and the environment's permissions. This file explains project intent and working rules; it does not authorize deployment, unrelated changes, or work beyond the assigned task.

## 1. Know what you are building

Vybe is one person's local camera-controlled music studio for pop, soul, and jazz. Anatomical right-hand movement selects melody notes; left-hand movement selects explicit chord voicings. Pinches trigger sounds. Assisted and Free Play, practice, recording, an eight-track studio, and local project recovery are required.

At this guide's creation on 2026-10-12, the workspace contains planning documents and no implemented application. Inspect the actual files each session; do not continue treating this snapshot as current once code exists. Planned commands below are not evidence that scripts already exist or pass.

The application belongs in `gesture-studio/`. Preserve the root planning documents and the unrelated `Proposed plan.odt`. Do not derive music-product requirements from that legacy document. Do not manually alter `.git` or write into protected `.agents`, `.codex`, or `.aws` directories.

## 2. Read in this order

1. [PRD.md](PRD.md): required behavior, defaults, boundaries, requirement IDs, acceptance evidence.
2. [architecture.md](architecture.md): module boundaries, contracts, clocks, ownership, storage, failure handling.
3. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): tokens, screen structure, component states, shortcuts, accessibility.
4. [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md): the ten delivery phases and their gates.
5. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): earlier product context when needed.
6. Any implemented code, tests, and dated phase evidence relevant to the task.

The PRD owns product behavior, architecture owns technical contracts, and the design system owns presentation. These newer specifications refine the earlier plan. If two current documents disagree materially, identify the conflict, resolve it against the explicit user intent, and update both before relying on the decision. Do not silently pick whichever interpretation is easiest.

## 3. Work within a phase

- Determine the requested outcome and current phase before editing. A documentation request does not start application implementation.
- Inspect existing changes and local guidance first. Preserve work you did not create.
- Identify the relevant PRD requirement IDs and the phase's completion gate.
- Make the smallest complete implementation of the behavior. Do not leave visible controls wired to placeholders or fake data presented as real output.
- Build domain behavior and focused tests before connecting timing-sensitive UI. Add a fixture that demonstrates any bug being fixed.
- Run the relevant checks, inspect the actual result, and record limitations accurately.
- Update dated progress/evidence during implementation under `gesture-studio/docs/`; keep the root specifications current only when their intended behavior changes.
- Routine engineering choices within the specification can proceed without repeated approval questions. Do not add scope merely because a library offers a feature.

Phase 4 is the instrument gate. Do not claim it passed or expand into the later studio phases while required accuracy, recovery, response, and comfort evidence is missing. Complete safe work within the current phase and provide a concrete manual test procedure when the owner's participation is needed. Missing evidence is `manual validation pending`, not `accepted` or a reason to fabricate results.

Do not infer permission to create subagents from this document's name. Follow the session's delegation instructions.

## 4. Invariants that must survive every change

1. **Sound follows explicit input.** Hover is silent; each confirmed pinch produces at most one attack; release is required before retriggering. A closed hand entering a pad after loss/rest is not a new press.
2. **Free Play remains free.** Tracking stabilization stays on, but musical correction does not. Suggestions require selection. Scale Guard affects melody only and never redirects a blocked note to another pitch.
3. **A chord means its stored pitches.** Display, playback, recording, restore, and export agree. Library updates cannot reinterpret an old take's chord label.
4. **Identity owns release.** Track every voice by a unique ID and source. A note-off for one owner cannot stop another owner's copy of the same pitch.
5. **Loss releases safely.** Affected live dry audio expires within 200 ms, including sustain-held notes. Isolated hand loss does not stop accompaniment. Use the audio lease specified in architecture.md, not only a main-thread timeout.
6. **Audio time owns music.** React renders UI. AudioContext time schedules sound. JavaScript intervals fill a lookahead queue; they do not define beats. Live attacks bypass playback lookahead.
7. **Original performances survive editing.** Quantization/swing are reversible. Store actual sounded events and their original timing. Never apply live timing correction.
8. **State changes are explicit.** Loading a scene, switching a mapping, restarting a camera, and seeking cannot revive stale events. Epochs/configuration revisions and neutral-hand recovery are required.
9. **Privacy is local.** Camera frames and landmarks are transient. No microphone, telemetry, remote inference, runtime CDN, account, or cloud storage dependency.
10. **Saved means committed.** Storage failures remain visible and recoverable. Never reset a database or overwrite a source take to make a test or migration pass.
11. **Silence is not successful fallback.** Failed piano assets cannot become an oscillator while the UI says Grand piano. Failed imports cannot partly replace the current project.
12. **Metrics need evidence.** Simulators, screenshots, and browser latency estimates do not prove actual-camera accuracy, physical response time, audible quality, or comfort.

## 5. Coding and dependency rules

- Use TypeScript strict mode and explicit units (`Ms`, `Sec`, `Tick`). Validate imported files, stored records, worker messages, and numeric settings at runtime.
- Keep pure logic in `src/domain`; keep React and browser globals out of it. Put device/audio/storage access behind adapters that tests can replace.
- Keep high-rate landmarks, cursors, voice registries, and scheduler state out of React state. Do not implement note-on/off by reacting to a component render.
- Release resources deliberately: stop MediaStream tracks, terminate workers, close transferred bitmaps, disconnect retired audio nodes, cancel scheduled sources, and revoke temporary object URLs.
- Use one owned AudioContext and idempotent lifecycle cleanup. Test development remounts and repeated start/stop cycles.
- Never use a generic `any` cast or ignored rejection to hide a protocol, import, or lifecycle mismatch. Errors carry a useful code and a user-facing recovery action.
- Use the selected stack and npm lockfile. Check primary documentation before adopting an API; pin compatible versions during implementation rather than asserting an unverified latest version.
- Read package changes and installation output. Do not introduce cloud SDKs, a second audio scheduler, another state framework, or a native wrapper without a concrete requirement and recorded trade-off.
- Asset preparation records exact upstream sources, licenses, hashes, and conversion steps. Test with licensed/original fixtures; preserve original user imports.
- Use source-appropriate editing tools and preserve existing work. Avoid unrelated formatting sweeps and destructive git operations.

## 6. Design implementation rules

Implement the exact tokens and state vocabulary in DESIGN_SYSTEM.md. Use semantic controls with readable labels and units. Keep large gesture targets, stable positions, visible selection versus sounding state, and persistent Rest/Stop controls.

Do not improvise gradients, glass cards, decorative motion, marketing copy, a landing page, or fabricated statistics. Do not add an automatic “smart” mode that takes musical choices away from the user. Use context-specific errors and real progress states.

Use the same layout data for rendering and hit testing. Test mirrored coordinates, both hands, rest strips, disabled notes, viewport changes, and conventional input. Color alone is never the status signal. Do not animate a note-on or delay sound for a transition.

## 7. Commands and verification

During Phase 2 implement these scripts in `gesture-studio/package.json`. Until then, report their absence rather than pretending to have run them.

| Command, run inside `gesture-studio/` | Purpose |
|---|---|
| `npm ci` | Reproducible dependency installation once a lockfile exists |
| `npm run dev` | Development server at strict `http://localhost:4173` |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | Non-mutating lint checks |
| `npm run test -- --run` | Unit/integration tests through Vitest |
| `npm run test:e2e` | Playwright workflows and relevant accessibility checks |
| `npm run verify:assets` | Asset availability, hashes, and manifest/license references |
| `npm run build` | Production build |
| `npm run start` | Loopback server for the built app at the same origin |

Do not change the port automatically or kill an unrelated process to free it; the origin is part of local persistence behavior. Initial dependency/assets installation may need internet. Runtime offline verification happens after installation.

Choose checks according to the change:

- Gesture or coordinate changes: synthetic traces for jitter, held pinches, mirroring, crossing, gaps, and neutral recovery; repeat affected real-camera trials.
- Audio/lifecycle changes: independent identical-pitch owners, sustain, lease expiry under stalls, seek/stop cancellation, repeated initialization, audible release and overload checks.
- Music/timing changes: all factory voicings, chromatic Free Play, guard scope, tempo maps, loop boundaries, edit reversal, and imported MIDI fixtures.
- Persistence/import changes: malformed and oversized files, failed transactions, quota, archive round-trip, migrations, shared assets, and no partial overwrite.
- UI changes: relevant view sizes, keyboard/pointer operation, focus, contrast, reduced motion, recording/save/error states, and screenshots.
- Documentation-only changes: links, requirement coverage, naming/default consistency, units, source support, and agreement with the actual repository. Do not scaffold an app merely to test documents.

Use real assertions about outcomes. Avoid tests that only mirror constants or screenshots that stand in for behavior. Never weaken or delete a failing safety/timing assertion without explaining and fixing the underlying requirement or implementation.

## 8. Evidence, decisions, and handoff

For each implementation phase record: requirement IDs, completed work, exact checks and outcomes, environment/build, asset/calibration versions, manual evidence, failures, and remaining work. Use statuses `not started`, `in progress`, `automated checks passed`, `manual validation pending`, or `accepted`.

For camera/audio benchmarks include conditions and distributions; do not report a lone average as proof of the p95 target. Label physical measurements, component timings, and estimates separately. Never activate the camera or record media solely to improve a documentation task.

When a substantial technical decision changes, record its context, selected approach, alternatives, and consequences in architecture.md, then update affected PRD/design requirements and tests. New accounts, public hosting, hardware purchases, third-party uploads, or remote processing require explicit user scope; they are not routine implementation choices.

End a work session with a concise report of what changed, what was verified, what remains unverified, and the next required step. Use real file links. Do not call the whole project complete because one phase passes. A request to review or diagnose alone does not authorize implementing unrelated fixes.
