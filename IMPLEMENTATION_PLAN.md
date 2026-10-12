# Personal Gesture Studio for Pop, Soul, and Jazz

Saved: 2026-10-09  
Status: Planning complete; implementation has not started.  
Companion document: [Implementation phases](IMPLEMENTATION_PHASES.md)

## 1. The refined product

Build a private musical instrument and recording studio around your hands, your laptop, and your musical taste.

The central experience should be: **open a favorite setup, comfortably play a melody over rich chords, record the idea, and build it into a piece of music.**

The application will provide three connected spaces:

- **Play:** immediate performance with optional musical guidance.
- **Practice:** learn gestures, rhythm, harmony, and imported songs.
- **Studio:** record, layer, refine, and export your music.

Target your existing Fedora laptop, HP webcam, and Chrome. Everything runs locally after installation.

Live performance uses one melody trigger in the right hand and one chord trigger in the left. Each chord can contain several notes; recorded layers provide additional parts.

“Perfect” becomes a set of measurable requirements: dependable triggers, comfortable movement, responsive audio, understandable assistance, expressive sounds, and recoverable recordings.

## 2. Make the instrument comfortable and predictable

### A stable playing surface

Use a piano-inspired melody layout: seven natural notes across the lower row and five sharps/flats above them. Show one chromatic octave at a time, with octave controls providing access across the piano range.

Use eight large, editable chord pads for the left hand. Additional chord banks are selected through buttons or shortcuts.

Both hands have separately calibrated movement areas. The same physical position continues selecting the same pad until you explicitly change the layout or octave. Musical suggestions must never rearrange the pads during performance.

| Your action | Result |
|---|---|
| Move an open hand over a pad | Silently highlight the selected note or chord. |
| Close a thumb–index pinch | Trigger the highlighted sound once. |
| Hold the pinch | Hold the selected keys; their natural sound continues. |
| Move while holding | Keep the original pitches fixed. |
| Open the pinch | Release the keys, respecting the sustain pedal. |
| Move into the designated rest area | Disarm that hand and release its live voices. |
| Press Escape | Stop all voices, sustain, and playback. |

Use palm position for selection, reducing cursor movement caused by the pinch itself. Apply boundary hysteresis so small tracking movements do not rapidly alternate between adjacent pads.

Changing a chord bank, octave, or play mode requires releasing the live gestures first. Previously recorded tracks keep their original notes.

### Personal calibration and readiness

First-run setup should establish:

- A comfortable seated position with both hands visible.
- Separate left- and right-hand reach areas.
- Your open and closed pinch distances.
- Normal movement variation and suitable cursor smoothing.
- A comfortable repetition speed for early exercises.

Save this profile against the camera configuration. Subsequent sessions run a short readiness check for tracking stability, frame delivery, and loaded audio assets.

Calibration must fail visibly when open and closed gestures cannot be distinguished reliably. Offer a specific correction—such as repositioning a hand or adjusting the camera—before retrying.

Compact reach areas, clear feedback, and avoiding hand overlap follow established hand-interface design principles. Their suitability for this laptop must be confirmed through actual use. [Design guidance](https://docs.ultraleap.com/xr-guidelines/Getting%20started/design-principles.html?highlight=finger)

### Feedback and expression

Give pads distinct **available, selected, sounding, and disabled** appearances, supported by labels rather than color alone.

The camera preview is prominent during setup and collapses to an inset during performance. Keep recording status, the active instrument, and stop controls visible.

Default to consistent medium note strength. Offer calibrated pinch-speed dynamics as an explicit expressive setting, plus fixed soft, medium, and loud alternatives.

Use a sustain button and keyboard shortcut. Provide a Rest control that suspends live input while accompaniment continues.

## 3. Musical features designed for your styles

### Assistance that leaves you in control

Separate assistance into independently visible controls:

| Control | What it does |
|---|---|
| Note Guide | Highlights scale notes and notes belonging to the selected chord. |
| Chord Guide | Suggests chords or alternative voicings and explains their relationship. |
| Scale Guard | Disables melody notes outside the selected scale without moving the remaining pads. |
| Free Play | Removes musical restrictions and recommendations while retaining reliable gesture detection. |

Scale Guard affects melody selection only. It must not remove notes from a chord you deliberately configured.

Enable Scale Guard in the first beginner exercises and the Pop starter preset. Disable it in the Soul and Jazz presets, where chromatic notes remain available. Display that setting clearly.

Suggestions require your selection. The application does not silently substitute chords, change inversions, generate extra notes, or correct live timing.

A chord pad always displays its chord symbol and exact notes. Previewing and accepting a different voicing updates that pad explicitly.

### Richer harmony

Include editable presets for:

- Major, minor, diminished, and suspended chords.
- Sixth, major seventh, minor seventh, dominant seventh, and half-diminished chords.
- Major ninth, minor ninth, dominant ninth, thirteenth, and altered dominant examples.
- Inversions, slash chords, and selected rootless voicings.

Provide a small keyboard editor for creating any custom voicing. Store its exact pitches rather than reconstructing it from a chord name during playback.

Teach chord extensions and voicing gradually. These are particularly relevant to jazz and contemporary piano harmony. [Berklee voicing reference](https://online.berklee.edu/takenote/basic-piano-voicing-techniques/)

### Three useful starter presets

Each preset saves instruments, chord pads, tempo, groove, assistance settings, and effects. Loading one displays a summary before replacing the current setup.

| Preset | Starting sound and harmony | Starting rhythm |
|---|---|---|
| Pop Session | Grand piano and optional pad; C–G–Am–F | 90 BPM, straight |
| Soul Session | Electric piano and bass; Cmaj9–Am9–Dm9–G13 | 76 BPM, optional light sixteenth-note swing |
| Jazz Session | Grand piano and bass; Dm7–G7–Cmaj7–A7 | 100 BPM, optional swung eighths |

These are editable starting points. Accompaniment starts only when you activate playback.

Include five instrument families: grand piano, electric piano, warm pad, plucked bass, and percussion. Use locally bundled Salamander piano samples and a curated VCSL percussion subset, retaining their source and license information. [Piano samples](https://github.com/sfzinstruments/SalamanderGrandPiano), [percussion library](https://github.com/sgossner/VCSL)

Provide volume, pan, modest reverb, electric-piano tremolo, and master output protection. Share decoded sample buffers between tracks.

### Practice that develops musical skill

Organize original exercises in this sequence:

1. Select, pinch, hold, release, and rest.
2. Play short melodies and repeated rhythms.
3. Change chords while maintaining a melody.
4. Explore sevenths, ninths, and chord inversions.
5. Practice syncopation, swing, and short improvised phrases.

Offer demonstration, call-and-response, wait-for-note, and continuous practice.

For imported MIDI, select a melody track and optional accompaniment tracks. Preserve tempo changes and meter information. Offer slower playback, section loops, and explicit transposition.

Polyphonic melody tracks require an explicitly selected simplified version for single-note gesture practice. Preserve the original file. Flag octave changes and passages beyond the current layout instead of silently changing their pitches.

Measure pitch and timing separately. In improvisation, show descriptive feedback rather than treating chromatic notes as mistakes. Scale Guard usage must be visible in practice results.

MP3/WAV files serve as backing tracks with volume and start-offset controls. They do not automatically become note-by-note lessons.

### Recording and studio workflow

Provide linear recording and an eight-track loop workspace with 1-, 2-, 4-, 8-, and 16-bar loops.

Include a metronome, count-in, mute, solo, undo, track duplication, and a readable piano-roll view. Studio-created projects use a shared tempo and 4/4 meter; MIDI practice preserves imported timing and meter maps.

Offer reversible straight, triplet, and swing quantization. Keep the original performance intact and apply timing edits only to recorded clips. Never delay live notes to align them to a grid.

Add optional, editable percussion patterns for pop, soul, and swing practice. Store them as ordinary musical events.

Record the actual sounded notes, velocity, duration, and sustain. Keep metronome audio outside the exported mix.

Support:

- MIDI export of musical tracks.
- WAV export of the complete mix.
- Project archives containing recordings, settings, and imported media.

Backing audio retains its original speed and pitch. Changing studio tempo is disabled while backing audio is active.

## 4. Implementation and reliability

### Architecture

Create the application in `gesture-studio/`, preserving existing workspace content.

Use:

- React, TypeScript, and Vite for the application.
- MediaPipe Hand Landmarker in a worker for two-hand tracking.
- Native Web Audio for instruments, effects, and scheduling.
- Tonal for note, scale, chord, and interval calculations.
- `@tonejs/midi` for MIDI import/export.
- IndexedDB for projects, calibration, and preferences.

Tonal provides reusable musical calculations; application-specific suggestion rules remain explicit and testable. [Tonal reference](https://github.com/tonaljs/tonal)

The critical path is:

**Camera frame → tracking → gesture intent → musical event → audio**

Visuals, recording, and practice feedback consume these events without delaying audio. MediaPipe video detection is synchronous, so inference belongs off the interface thread. [MediaPipe reference](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)

Allow only one inference job at a time and discard superseded frames. Benchmark worker-based CPU and GPU processing, then save the better stable configuration.

Use one audio clock for notes, recording, loops, and the metronome. Schedule live sounds immediately and prerecorded events ahead of time.

### Internal interfaces

Define these shared contracts:

- **TrackingFrame:** timestamp, stable hand identifiers, landmarks, and tracking status.
- **GestureIntent:** selected target and pinch transition, including attempts blocked by Scale Guard.
- **PerformanceEvent:** actual note/sustain event, voice identifier, source, track, velocity, and audio time.
- **ChordPad:** label, exact pitches, voicing description, and display spelling.
- **ScenePreset:** instruments, pad assignments, musical settings, assistance, and effects.
- **StudioProject:** schema version, original takes, reversible edits, clips, assets, and sound-library versions.
- **CalibrationProfile:** camera configuration, movement areas, thresholds, and sensitivity.

Separating attempted gestures from sounded events prevents assistance from producing misleading practice scores.

### Failure behavior

Track hand identity through position continuity and handedness, rather than detection-array order.

Use separate pinch closing/opening thresholds and a mandatory release before retriggering. Ambiguous tracking must not generate a speculative note.

Release affected live voices within 200 ms of hand loss or stale tracking, overriding sustain for those voices. Other hands and recorded accompaniment continue normally.

A camera failure, worker failure, or hidden page pauses transport and releases all voices. Returning requires an explicit resume. Reacquiring a closed pinch never triggers a note automatically.

Every voice has its own identity, allowing two sources to play the same pitch without one source’s release stopping the other.

### Saved work and local operation

Serve the application from one fixed localhost origin. Bundle runtime assets so normal use needs no network connection after installation.

Keep camera frames transient. Store musical performances, settings, and calibration locally; microphone access is unnecessary.

Autosave completed takes immediately and other edits transactionally. Request persistent browser storage, while retaining project archive export and restore because browser storage remains user-clearable.

On storage failure, keep the unsaved project in memory and offer export. Test schema upgrades against saved projects and preserve a recoverable copy before migration.

## 5. Delivery gates and acceptance tests

### Gate 1: The instrument feels dependable

Build calibration, selection, pinch detection, piano playback, rest handling, and diagnostics.

Test at least 500 deliberate triggers across three sessions on your laptop. Target:

- At least 99% correct triggers.
- Zero duplicated triggers.
- No more than one accidental note in a five-minute neutral-movement test.
- Correct recovery from hand overlap, frame loss, and leaving the camera.
- Comfortable playing through a 20-minute session with ordinary rest breaks.

Measure frame delivery, inference, event dispatch, and reported audio latency separately. Target median physical response below 100 ms and a 95th percentile below 150 ms, but only label that result verified when independently measured. Browser-reported output latency is an estimate, not a measurement of the entire gesture-to-sound path. [Audio latency reference](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)

Resolve failures here before expanding the studio.

### Gate 2: Musical control is trustworthy

Verify that every pad sounds its displayed pitches, Free Play preserves chromatic notes, Scale Guard affects only the intended melody input, and suggestions never change a performance without selection.

Test chord extensions, inversions, sustain, overlapping identical pitches, and changes between presets.

### Gate 3: Recording preserves your performance

Verify loop boundaries, tempo handling, swing and triplet edits, undo, MIDI round-trips, backing alignment, and WAV rendering.

Restoring original timing must reproduce the unedited take. Opening an older project must not reinterpret its chords using newer presets.

### Gate 4: The complete personal workflow succeeds

Use Vitest for gesture states, harmony, and timing; Playwright for application workflows; and real-camera sessions for actual playing quality.

Run a 30-minute session with layered playback, followed by offline restart and project restoration. Check audio interruptions, memory growth, responsiveness, camera failures, and storage failures.

Final acceptance is a complete personal session: choose a Pop, Soul, or Jazz preset, play with assistance, switch to Free Play, record several parts, edit the groove, save, reopen, and export the same piece successfully.

**Scope defaults:** one personal user; this laptop and Chrome; local processing; melody-and-chord hand roles; conventional studio controls; eight tracks; five instrument families; MIDI lessons and audio backing. Automatic audio transcription, cloud accounts, external MIDI hardware control, and automatic chord arranging are outside this release.
