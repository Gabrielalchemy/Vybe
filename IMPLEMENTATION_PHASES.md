# Personal Gesture Studio — Implementation Phases

Saved: 2026-10-09  
Status: All phases pending; implementation has not started.  
Companion document: [Refined implementation plan](IMPLEMENTATION_PLAN.md)

Implement this in **10 phases**, each with a defined scope, deliverables, and acceptance criteria. The early phases prove that playing feels reliable; the later phases build the musical studio around that foundation.

The agreed requirements remain: personal use, your Fedora laptop and Chrome, right-hand melody, left-hand chords, optional assistance, and a focus on pop, soul, and jazz.

## Phase 1: Finalize the specification and technical baseline

Establish exactly what we are building and how we will judge it.

### Work required

- Consolidate the agreed features into one implementation specification.
- Document gesture behavior, hand roles, note layouts, chord banks, assistance settings, and studio controls.
- Define the application states: setup, calibration, ready, playing, resting, recording, playback, and recovery.
- Confirm the development environment, Chrome availability, camera capabilities, and audio output.
- Establish performance measurements and distinguish software timings from physical gesture-to-sound latency.
- Document the limits: two live gesture triggers, eight studio tracks, fixed 4/4 studio projects, and imported MIDI practice with its original timing.
- Record external dependencies, sample sources, licenses, and offline requirements.

### Deliverables

A requirements document, architecture outline, acceptance checklist, and ordered implementation backlog.

### Completion gate

Every agreed feature has a destination in the implementation phases and a way to verify it. Remaining hardware uncertainties have explicit validation tasks.

## Phase 2: Build the application foundation

Create the structure needed to develop and test the instrument safely.

### Work required

- Create `gesture-studio/` while preserving existing workspace content.
- Configure React, TypeScript, Vite, linting, Vitest, and Playwright.
- Establish the Play, Practice, Studio, and Settings application structure.
- Define shared contracts for tracking frames, gesture intents, performance events, calibration, chord pads, presets, and projects.
- Separate the interface, tracking, gesture interpretation, music theory, audio, recording, and storage modules.
- Build an event simulator so musical behavior can be tested without a camera.
- Establish versioned local storage and asset-loading interfaces.
- Configure a fixed localhost address and local delivery of model and audio assets.
- Add visible loading and error states.

### Deliverables

A runnable application shell, shared interfaces, test infrastructure, and simulated input controls.

### Completion gate

The application starts consistently, foundational checks pass, and simulated input can move through the intended event pipeline.

## Phase 3: Implement camera tracking and personal calibration

Turn camera input into stable, understandable hand controls.

### Work required

- Add camera permission, selection, preview, start, and stop controls.
- Run MediaPipe tracking in a worker.
- Process one inference job at a time and discard superseded frames.
- Benchmark CPU and GPU processing on the laptop.
- Track hand identity using position continuity and handedness.
- Map palm positions into independent left- and right-hand playing areas.
- Implement pinch detection with separate closing and opening thresholds.
- Smooth cursor movement independently from pinch detection.
- Build calibration for comfortable reach, hand size, open/closed pinches, and sensitivity.
- Save calibration and provide a short readiness check for later sessions.
- Handle missing hands, overlap, poor tracking, stale frames, and camera failures.
- Display selected pads and tracking status without producing music yet.

### Deliverables

A working two-hand controller, calibration workflow, saved profile, and tracking diagnostics.

### Completion gate

Both hands consistently select the intended pads. Pinches produce one press and one release, and tracking recovery cannot create an unexpected press.

## Phase 4: Build and validate the core instrument

Connect gestures to a piano and prove that the central experience works.

### Work required

- Build the Web Audio engine with one shared audio clock.
- Load the piano samples before enabling performance.
- Implement independent voice ownership for every sounding note.
- Connect right-hand melody and left-hand chord triggers.
- Support pinch-to-play, hold, release, sustain, octave controls, rest areas, and Escape-to-stop.
- Keep pitches fixed while a pinch remains held.
- Prevent configuration changes from remapping held notes.
- Release affected live voices when tracking is lost, including voices held by sustain.
- Keep accompaniment behavior separate from live-hand recovery.
- Add mouse or keyboard test controls to isolate audio faults from tracking faults.
- Instrument the complete software path.

### Deliverables

A playable gesture piano with basic chord pads and reliable recovery behavior.

### Completion gate

On the actual laptop:

- At least 99% correct triggers across 500 labeled attempts in three sessions.
- No duplicated triggers.
- No more than one accidental note during a five-minute neutral-movement test.
- Affected live voices release within 200 ms of tracking loss.
- Comfortable use through a 20-minute session with ordinary rests.

The physical response targets remain below 100 ms median and 150 ms at the 95th percentile. These require independent measurement; software timings alone cannot establish them.

**This is the main technical gate.** Tracking or audio problems discovered here must be resolved before expanding the studio.

## Phase 5: Implement musical control and assistance

Make the instrument useful for both learning and deliberate performance.

### Work required

- Add Free Play with unrestricted chromatic melody notes.
- Implement Note Guide, Chord Guide, and Scale Guard as separate controls.
- Keep pad positions stable when assistance changes.
- Restrict Scale Guard to melody input; preserve explicitly configured chords.
- Show the exact notes contained in each chord pad.
- Build the chord editor, chord banks, inversions, slash chords, and custom voicings.
- Include the agreed triads, suspended chords, sixths, sevenths, ninths, thirteenths, and selected altered chords.
- Use Tonal for musical calculations and explicit rules for suggestions.
- Require selection before applying a suggested chord or voicing.
- Preserve attempted gestures separately from sounded notes for honest practice feedback.
- Save musical settings and chord banks.

### Deliverables

Complete Assisted and Free Play modes, a chord library, and editable personal chord banks.

### Completion gate

Every chord sounds exactly as displayed. Assistance never silently changes a voicing, repositions a pad, or alters live timing. Free Play preserves your selected pitches.

## Phase 6: Develop sound quality, expression, and genre presets

Give the instrument the sound and character needed for your music.

### Work required

- Complete the five instrument families: grand piano, electric piano, warm pad, plucked bass, and percussion.
- Bundle the selected samples and their source/license information.
- Share decoded sample buffers across tracks.
- Add fixed soft, medium, and loud dynamics.
- Implement optional calibrated pinch-speed dynamics.
- Add track volume, pan, reverb, electric-piano tremolo, and master output protection.
- Prevent clicks during voice release and instrument changes.
- Build the Pop, Soul, and Jazz starter presets.
- Include fixed, editable chord voicings and clearly visible assistance settings.
- Add percussion sounds and editable groove data for later transport playback.
- Save and restore personal presets.

### Deliverables

The complete instrument collection, effects, expressive controls, and three musical starting setups.

### Completion gate

Instruments load predictably, sound consistently across their supported ranges, and remain responsive during dense chord playback. Expressive dynamics produce repeatable differences without increasing false triggers.

## Phase 7: Build recording, transport, and the loop studio

Turn performances into editable musical projects.

### Work required

- Implement the transport, tempo controls, metronome, and count-in.
- Record actual sounded notes, velocity, duration, and sustain against the audio clock.
- Support ordinary linear takes and an eight-track loop workspace.
- Add 1-, 2-, 4-, 8-, and 16-bar loop lengths.
- Implement track arming, mute, solo, duplication, instrument assignment, and undo.
- Provide a readable piano-roll view.
- Schedule recorded playback ahead of time without delaying live notes.
- Handle notes and sustain correctly at loop boundaries, stop, and seek.
- Add optional percussion-pattern playback.
- Implement reversible straight, triplet, and swing quantization.
- Preserve original takes and save completed recordings immediately.
- Keep the metronome separate from the recorded mix.

### Deliverables

A functioning multitrack studio with live overdubbing, looping, and reversible timing edits.

### Completion gate

Live performance stays responsive during playback. Repeated loops do not accumulate timing drift or stuck notes. Undo and removal of timing edits restore the original take.

## Phase 8: Build practice, lessons, and song imports

Create a guided path from learning the controls to playing music.

### Work required

- Build original exercises for gestures, melody, rhythm, chords, two-hand coordination, extensions, and improvisation.
- Add demonstrations, call-and-response, wait-for-note, and continuous practice.
- Score pitch and timing separately.
- Show when assistance affected a practice attempt.
- Use descriptive feedback for improvisation rather than treating every chromatic note as incorrect.
- Import MIDI tracks, tempo changes, meter information, and sustain.
- Support melody-track selection and optional accompaniment.
- Add practice speed, section loops, and explicit transposition.
- Offer clearly labeled simplification for polyphonic melody tracks while preserving the original.
- Flag octave changes and passages that exceed the active gesture layout.
- Import MP3/WAV accompaniment with volume and start-offset controls.
- Preserve backing audio’s original speed and pitch; prevent incompatible studio tempo changes.
- Handle unsupported or malformed imports with useful messages.

### Deliverables

A beginner learning path, MIDI song practice, and audio accompaniment.

### Completion gate

Exercises behave predictably, imported timing remains correct, and practice results cannot mistake assistance for unaided accuracy. Imported originals remain recoverable.

## Phase 9: Finish project durability, backup, and export

Make saved work dependable and portable. Storage is introduced earlier; this phase completes and hardens it.

### Work required

- Complete transactional autosave for projects, preferences, calibration, and presets.
- Add project naming, duplication, recovery, and recoverable deletion.
- Request persistent browser storage and display storage failures.
- Preserve unsaved work in memory when saving fails.
- Build project archive export and restore, including imported media.
- Implement MIDI export of musical tracks.
- Render complete mixes to WAV, including effects and backing audio.
- Exclude the metronome from exports.
- Preserve original timing, edits, exact chord pitches, and sound-library versions.
- Test schema migrations against older saved projects.
- Verify interrupted saves, missing assets, corrupt archives, and storage exhaustion.

### Deliverables

Reliable project management, backups, recovery, MIDI export, and WAV export.

### Completion gate

A restored project reproduces the saved arrangement and settings. Failed saves are visible, and updating the application does not silently change existing performances.

## Phase 10: Polish, package, and perform final acceptance

Make the complete application comfortable for daily personal use.

### Work required

- Refine the dark studio interface, spacing, labels, and visual hierarchy.
- Verify selected, sounding, disabled, and tracking-loss states.
- Make core controls keyboard-accessible and avoid color-only feedback.
- Keep camera setup clear and the performance view uncluttered.
- Optimize startup, sample loading, rendering, and sustained resource use.
- Provide a single local launch command and a short setup guide.
- Verify offline operation after installation.
- Confirm camera shutdown and audio cleanup when appropriate.
- Run the full automated suite and real-camera regression checks.
- Complete a 30-minute session with layered playback.
- Document known limits and troubleshooting steps.

### Deliverables

The packaged personal application, usage guide, and final verification report.

### Completion gate

You can complete this workflow successfully:

**Open a preset → play with assistance → switch to Free Play → record several parts → edit the groove → save → restart offline → reopen → export.**

## Your participation

The three points that need your direct participation are personal calibration, the core playing test in Phase 4, and final acceptance. Automated checks can verify musical and application behavior; your actual camera setup and playing comfort need hands-on validation.
