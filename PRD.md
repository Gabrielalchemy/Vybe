# Vybe: product requirements

Version: 1.0 · 2026-10-12 · Status: build specification, not an implemented product

Vybe is the working name for the personal gesture music studio. This document defines product behavior and acceptance. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) defines presentation; [architecture.md](architecture.md) defines implementation; [AGENTS.md](AGENTS.md) tells builders how to work. The [ten-phase breakdown](IMPLEMENTATION_PHASES.md) remains the delivery sequence. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) preserves the earlier product discussion. Where those earlier descriptions are less precise, use these four specifications. A later explicit user instruction takes precedence.

## 1. Purpose and user

One beginner musician wants to make pop, soul, and jazz on their own laptop using hand movements seen by its camera. The successful session is concrete: open a saved setup, play melody and chords, record several parts, refine the groove, save, reopen, and export the same piece.

Optimize for that person's reach, lighting, camera, and musical preferences. There are no customers, organizations, subscriptions, public profiles, or engagement metrics to serve.

The instrument provides one live melody trigger in the anatomical right hand and one live chord trigger in the anatomical left hand. A chord trigger sounds an explicitly configured group of notes. Multitrack recording supplies additional parts. This supports learning harmony, rhythm, listening, and improvisation; it does not establish mastery of physical piano fingering.

### Target environment

- Primary: Chrome on the user's Fedora laptop, using its HP webcam. The earlier environment inspection found an i7-10510U and approximately 16 GB RAM; recheck at implementation time.
- Desktop performance surface: at least 1024 × 640 CSS pixels. At smaller sizes, project management, playback, settings, and conventional input remain usable; camera performance asks for a larger window.
- Local execution at `http://localhost:4173`, with internet needed only to install or intentionally update dependencies/assets.
- Camera permission is required only for hand control. Mouse/keyboard audition, editing, playback, and export work without a camera. No microphone permission is requested.
- Start with built-in speakers or wired output for acceptance measurements. Record the actual output device in each measurement; do not silently generalize results to other devices.

## 2. Release boundaries and defaults

All requirements below belong to the complete first personal release. Phases are delivery checkpoints, not permission to omit later features.

| Area | Decision |
|---|---|
| Workspaces | Play, Practice, Studio; Settings opens from a persistent control |
| Live layout | One chromatic octave for melody; eight chord slots in a 2 × 4 bank |
| Range | Pitched notes A0–C8, MIDI 21–108; unavailable edge-octave notes visibly disabled |
| Pitch/velocity | Equal temperament, A4 = 440 Hz; fixed medium velocity initially |
| Instruments | Grand piano, electric piano, warm pad, plucked bass, percussion |
| Studio | Up to eight tracks in total, including percussion and backing audio |
| Recording | Linear takes or shared loops of 1, 2, 4, 8, or 16 bars |
| Studio timing | 4/4, 40–240 quarter-note BPM, one tempo per project; default loop length four bars |
| Practice timing | Preserve imported MIDI tempo and meter maps; speed 25–150% |
| Assistance | Suggestions require selection; no automatic chord arrangement or live quantization |
| Storage | Local autosave plus downloadable project archives |
| Imports/exports | MIDI and MP3/WAV import; MIDI, WAV, and project archive export |

Explicitly outside this release: accounts, cloud synchronization, publishing, collaboration, payment systems, microphone recording, audio-to-MIDI transcription, audio time stretching, automatic accompaniment generation, external MIDI device control, mobile camera performance, and arbitrary ten-finger piano simulation. Optional included drum grooves are fixed editable patterns that the user starts.

## 3. Required journeys

### First playable session

Open Play → start the session with a click → prepare audio → enable camera → frame both hands → calibrate reach and pinches → see a silent preview → make the first sound → try a chord and melody together → learn Rest and Stop. A denied camera permission leaves a usable conventional-input instrument and a clear retry path.

### Return to a favorite setup

Open the last saved project → start audio → optionally enable camera → check hands against the saved calibration → explicitly resume. Restore musical settings, never active notes, pedal-down state, armed recording, or running playback.

### Build a piece

Choose a preset → route left and right input to instrument tracks → arm one or both lanes → count in → capture the take → add another part → audition timing edits → undo or retain them → save → export. Both hands can be recorded in the same pass as separate tracks. The interface must show exactly which lanes and tracks are armed.

### Practice a song

Import MIDI → choose the melody track and accompaniment → inspect range and polyphony warnings → optionally create a labeled simplified practice version → choose a phrase and speed → practice → review pitch and timing independently. Original files and the unmodified performance remain available.

## 4. Functional requirements

### R01 — Local operation and privacy · phases 1, 2, 10

All normal application, inference, instrument, font, and project operations use local assets. No runtime analytics, remote model requests, account prompts, or CDN fallbacks. Camera frames and landmarks stay transient; only calibration parameters and musical results are saved. An optional diagnostic export contains timings, settings, and failure reasons, not images or hand-landmark recordings.

Acceptance: after installation, complete the main journey with external network access disabled. Inspect requests and confirm camera/media data are never transmitted.

### R02 — Session lifecycle · phases 2–4

Make camera, audio, transport, and saving status independently visible. Enable sound through a user action. Do not start the camera on page load. Camera-off mode permits editing and playback. Settings that change gesture targets require idle hands and a stopped transport; they cannot change notes already sounding.

Acceptance: denied permissions, unavailable cameras, missing samples, and interrupted audio each have a specific recoverable state. Returning to the page never starts sound automatically.

### R03 — Calibration · phase 3

Save per-camera movement regions, mirroring configuration, pinch thresholds, smoothing settings, and a profile version. Use comfortable seated reach; never require both hands to reach across each other. Calibration records open and closed examples and rejects overlapping distributions rather than pretending success. Provide a short readiness check and explicit recalibration. Recommend a beginner exercise tempo from measured repeatable gestures, not an invented skill score.

Acceptance: a saved profile survives restart; changing the camera or processing geometry invalidates the relevant calibration. Bad calibration cannot arm hand performance.

### R04 — Selection and pinch semantics · phases 3, 4

Palm position selects a target silently. Pinch close triggers it once; release ends the key hold; a held pinch never retriggers or changes pitch as the hand moves. Closing over a gap, disabled note, or empty chord pad produces no sound and still requires an open hand before a later trigger. Notes do not jump to the nearest enabled pad.

Mirrored video and cursor geometry must agree. The left/right role is anatomical, not a detection-array index or the side of the screen a hand happens to occupy.

Acceptance: slow movement across boundaries, tremor, sustained pinches, and entering a pad while already pinched produce deterministic results.

### R05 — Rest, sustain, and recovery · phase 4

Ordinary key release respects sustain. The rest strip or Rest control releases that hand's live voices even when sustain is down; accompaniment continues. Reentering from rest or tracking loss requires a neutral open hand. A short, valid tracking gap may retain held voices but cannot initiate new ones.

Within 200 ms of the last valid observation of a lost hand, stop feeding its live dry audio. Existing short effect tails may decay; a stuck dry note is a failure. Other live hands and recorded tracks continue. Camera failure, worker failure, or a hidden page pauses transport, finalizes the current partial take as interrupted, releases all voices, and requires explicit resume. Escape stops all audio, including effect returns, and clears pedal state.

Acceptance: no stuck or spontaneously reacquired notes; recorded playback is unaffected by an isolated hand loss. Test sustain-down and overlapping-pitch cases.

### R06 — Assistance and Free Play · phase 5

Assisted Play exposes three separate settings: Note Guide highlights scale/chord tones, Chord Guide offers explained suggestions, and Scale Guard disables out-of-scale melody targets. Selecting a chord changes guidance, never a held melody note or the pad layout. The selected chord context remains visible after its sound ends.

Free Play bypasses all musical restrictions and suggestions, while retaining tracking stabilization. Remember Assisted settings for the next switch. Guidance does not constitute permission to change a chord. Preview is an explicit button; accepting a suggestion is a separate action.

Acceptance: an A7 pad retains C-sharp in a C-major project. Scale Guard never filters chord contents. With guard off, the melody can play the same chromatic note.

### R07 — Chord vocabulary and editing · phase 5

Provide major/minor/diminished/suspended triads, sixths, major/minor/dominant/half-diminished sevenths, major/minor/dominant ninths, thirteenths, selected altered dominants, inversions, slash chords, and rootless examples. Allow one to eight unique pitched notes per custom pad. Show exact note names and octaves as well as the chord label. Empty pads remain silent.

The stored pitch list is authoritative. Names and theoretical interpretations are annotations. Chord banks and suggestions cannot silently rewrite existing takes. Major, natural minor, major/minor pentatonic, and blues scales are available to the melody guide.

Acceptance: the displayed pitch list equals the triggered and recorded pitches, including custom labels and unusual voicings.

### R08 — Sound and expression · phases 4, 6

Provide a sampled grand piano with three velocity layers; synthesized electric piano, pad, and plucked bass; and sampled percussion. Offer velocity values 48, 80, and 112 out of 127, with medium selected initially. Optional pinch-speed velocity is separately calibrated and clamped to 1–127. Switching it on must not change trigger thresholds or target selection.

Include per-track volume/pan, reverb send, electric-piano tremolo, master volume, and overload indication. Required samples must be ready before arming that instrument. Never substitute an oscillator for a failed piano asset while showing “Grand piano.”

Acceptance: repeated notes, releases, dense chords, and instrument changes have no unintended clicks. Missing assets name the affected instrument and a recovery action.

### R09 — Presets · phase 6

| Preset | First four chord slots | Tempo | Assistance | Optional groove |
|---|---|---|---|---|
| Pop Session | C, G, Am, F | 90 | Note/Chord Guide on; Scale Guard on | Straight eighths |
| Soul Session | Cmaj9, Am9, Dm9, G13 | 76 | Guides on; Scale Guard off | Sixteenth-note swing, 56% |
| Jazz Session | Dm7, G7, Cmaj7, A7 | 100 | Guides on; Scale Guard off | Eighth-note swing, 60% |

All use C as the reference key, melody octave 4, medium velocity, four-bar loops, and stopped accompaniment. Slots five to eight start empty. Pop/Jazz live lanes use grand piano; Soul uses electric piano. Pad/bass/percussion are available for additional tracks, not generated automatically. Exact initial voicings are fixed in architecture.md.

Save personal scenes. Show the settings that loading a scene will replace and retain an undo checkpoint. Loading a scene does not delete takes or reassign the instruments of existing recorded tracks.

### R10 — Transport and recording · phase 7

Transport offers Play/Pause, Stop, Record, tempo, count-in, metronome, and loop controls. New recordings use a one-bar count-in by default. Arm at most one destination per live hand; both may share a compatible instrument track or use separate tracks. Failed input and preview sounds are never recorded as notes. Percussion capture uses an explicitly selected percussion target bank, where pitch guidance is inapplicable.

Store the actual performed pitches, velocity, key release, and sustain events. Keep the original audio-clock timing and assistance context. A partial take survives stop, tracking-system failure, and page hiding. Completed/interrupted takes save immediately. A muted armed track is rejected until the user unmutes it so recorded notes are audibly monitored.

Acceptance: one two-hand pass produces the intended tracks; capture equals the monitored events; count-in and metronome are excluded from takes and mix export.

### R11 — Loop workspace and reversible edits · phase 7

The eight-track limit counts instrument, percussion, and backing tracks. A loop project has one shared loop length and one active take per instrument/percussion track. Retakes preserve the previous take for undo; layering means recording another track. Loop recording captures one full pass, then returns to playback. Linear recording continues until stopped, up to the session duration limit.

Expose mute, solo, duplicate, instrument assignment, take replacement, and undo. The piano roll supports inspection and timing-edit preview; arbitrary drawn-note editing and a full clip arrangement editor are not required. Drum patterns have an editable step grid.

Quantization supports eighths, sixteenths, eighth-note triplets, and eighth/sixteenth swing from 50–67%. Store reversible edit settings separately from the original. Never quantize live input. Changing project tempo or loop length requires stopped transport; shortening a loop warns about notes beyond the new boundary and preserves the original take.

Acceptance: remove edits to recover the exact source take. Notes and sustain are properly released at loop wrap. Eight-track playback has no growing scheduling drift.

### R12 — Lessons and feedback · phase 8

Create original short exercises in five groups: gesture control; melody/rhythm; two-hand chords; sevenths/ninths/inversions; syncopation/swing/improvisation. Provide at least two exercises per group, with demonstration, call-and-response, wait-for-note, and continuous modes where meaningful. Explain one concept at a time and make every exercise replayable.

Match pitch and timing separately. Wrong/blocked attempts remain visible; guide-assisted completion is labeled. Wait-for-note pauses accompaniment at the target and is not a timing assessment. Free improvisation has descriptive summaries, not a correctness percentage. Music training progress is stored locally.

Acceptance: Scale Guard cannot turn a wrong attempted note into a correct score. Skipping an exercise never hides the instrument or studio.

### R13 — MIDI practice import · phase 8

Support Standard MIDI Files type 0 and 1 using PPQ timing, note events, tempo/meter maps, and sustain CC64. Reject type 2 or SMPTE timing with an explanation. Unsupported sound-program changes/controllers are reported; no claim of faithful rendering of arbitrary General MIDI arrangements. Let the user assign available instruments and map drum tracks explicitly.

Preview tracks, range, overlap, and duration before creating a practice session. Select one melody track plus optional accompaniment. A polyphonic melody requires explicit highest-note simplification or accompaniment-only use. Preserve the original and label every derived arrangement. Speed changes scale the complete tempo map; transposition never silently folds an out-of-range note into another octave.

Acceptance: original tempo/meter events survive import; selected accompaniment stays aligned at changed speed. MIDI practice and Studio use one transport at a time.

### R14 — Audio backing · phase 8

Accept decodable MP3 and WAV files. Show duration, volume, start offset, and audition controls. The user sets the intended project BPM before activating backing; do not guess beat alignment. While any backing track is active, lock project tempo. Muting all backing tracks unlocks it and displays a reminder to realign before reactivation.

A linear backing file follows the transport in seconds. In a loop project, repeat the explicitly selected audio window, with short boundary fades; pad a short window with silence. No stretching, pitch correction, or transcription. Audio-backed practice remains at original speed; MIDI-only practice retains speed control.

### R15 — Projects, recovery, and export · phase 9

Provide named projects, duplication, autosave status, recent projects, and Trash with explicit restore/permanent delete. Save local edits within two seconds of idle and takes immediately. Show “Saved” only after the storage transaction commits. Browser persistent-storage approval is useful but is not a backup.

Export/import `.vybe.zip` archives including project data and user-imported media. Built-in instruments are referenced by immutable asset-pack version. Restore creates a new project and never overwrites a project with the same name. Validate before committing; newer unsupported schemas remain importable as files but cannot be opened for editing.

Export type-1 MIDI with separate musical tracks, baking sustain and forced releases into note durations so pedal behavior is preserved without leaving lost-hand notes held. Original key/pedal events remain in the project archive. Omit backing audio and effects with a visible explanation. Export stereo 48 kHz, 16-bit PCM WAV with the selected mix, backing, and effect tail; exclude count-in/metronome. Export original or edited timing through an explicit selection, defaulting to the current edited mix. Export runs with transport stopped and live input disarmed.

Acceptance: archive restore reproduces notes/settings/media. Quota or export failures retain the project and offer a smaller/exportable recovery path.

### R16 — Interface and accessibility · phases 2–10

Follow DESIGN_SYSTEM.md for dimensions, colors, typography, controls, shortcuts, and states. Keep Rest, Stop, transport, camera status, and recording destination visible in performance. Distinguish camera acquisition failure from musical restrictions. All ordinary controls work by keyboard and pointer; camera-only testing cannot substitute for accessible control behavior.

Acceptance: complete setup/settings/save/export by keyboard, inspect at 200% zoom, and verify contrast and reduced-motion behavior. Do not announce frame-by-frame hand positions to assistive technology.

## 5. Capacity and resource limits

These are explicit first-release limits, chosen to bound browser memory and parsing costs. They are not verified performance results.

- Maximum linear project/practice duration: 10 minutes; maximum Studio tracks: eight.
- MIDI: 10 MiB, 100,000 note events, 64 source tracks; select at most eight for simultaneous practice playback.
- Audio: 100 MiB per file, 10 minutes decoded duration; PCM WAV and browser-decodable MP3/WAV. Reject unsupported codecs without changing the open project.
- Project archive: 256 MiB compressed, 512 MiB expanded. Reject invalid paths, duplicate entries, missing referenced assets, and expansion beyond the limit.
- Decoded audio buffer budget: 512 MiB shared across samples and backing. If a proposed load exceeds it, explain what to unload or shorten; do not silently degrade an instrument.
- One export at a time, with an additional 768 MiB temporary render/encode buffer budget; preflight allocations before starting.
- Pitched polyphony budget: 128 voices, with recorded voice-stealing diagnostics and a deterministic policy in architecture.md.

## 6. Acceptance evidence

| Check | Required result | Evidence |
|---|---|---|
| Intentional triggers | At least 99% correct over 500 labeled attempts across three sessions; zero duplicates | Intended target, observed result, condition, and counts |
| Accidental notes | At most one per five-minute neutral-movement test | Timed test including repositioning and resting |
| Loss recovery | Affected live dry audio ends within 200 ms of last valid observation | Synthetic stall tests plus actual-camera loss/sustain checks |
| Physical response | Median below 100 ms; p95 below 150 ms | Independent motion-and-audio measurement; never inferred solely from browser metrics |
| Comfort | A 20-minute session with ordinary rests is comfortable to the owner | Owner feedback on reach, repeated pinches, and fatigue |
| Musical integrity | Displayed, sounded, recorded, restored, and exported pitches agree | Fixtures for every factory pad and representative custom chords |
| Sustained session | 30 minutes with eight tracks and live input; no stuck notes or accumulating drift | Resource/timing trace and an audible check |
| Persistence | Restore a complete project and reproduce the current mix | Archive round-trip and saved-schema fixtures |
| Offline operation | Full main journey after disconnecting external network | Browser request inspection and restart test |

Annotate test conditions: browser/build, camera settings, delegate, audio output, instrument/track load, lighting, and calibration version. Report sample counts and missed/wrong/duplicate triggers separately. Physical latency is measured from completed pinch to audible onset. Label in-app capture/inference/dispatch/output figures as component measurements or estimates.

Use statuses `not started`, `in progress`, `automated checks passed`, `manual validation pending`, and `accepted`. A simulator result cannot pass a camera gate. The Phase 4 instrument gate precedes studio expansion; missing owner validation remains explicit rather than being replaced by an agent's judgment.

## 7. Requirement-to-phase map

| Phase | Requirements and completion evidence |
|---|---|
| 1 — Baseline | R01, limits, hardware unknowns, measurement procedure, this specification |
| 2 — Foundation | R01–R02, R16; module boundaries, simulators, storage/asset contracts |
| 3 — Tracking | R02–R04; real calibration and isolated tracking tests |
| 4 — Instrument | R04–R05, initial R08; accuracy, loss recovery, response, comfort gate |
| 5 — Musical control | R06–R07; assistance and exact-voicing fixtures |
| 6 — Sound | R08–R09; asset, expression, and scene validation |
| 7 — Studio | R10–R11; capture, transport, eight-track timing, undo |
| 8 — Practice/import | R12–R14; lesson scoring, MIDI maps, backing alignment |
| 9 — Durability/export | R15; transactional saves, migrations, archive/MIDI/WAV round-trips |
| 10 — Acceptance | All requirements, R16 polish, offline/package documentation, full owner journey |

## 8. Definition of complete

All required features exist; automated checks pass; manual gates have recorded results; runtime assets work offline; projects recover correctly; and the owner can perform the complete session described in section 1. Known limitations are documented in the app and handoff. No requirement is satisfied by a placeholder control, fabricated metric, silent fallback, or a screenshot alone.
