# Vybe: design system

Version: 1.0 · 2026-10-12 · Status: implementation specification; no interface has been rendered or user-tested

Read with [PRD.md](PRD.md), [architecture.md](architecture.md), and [AGENTS.md](AGENTS.md). This file owns visual tokens, screen composition, interaction presentation, copy, and accessibility. Product behavior belongs to the PRD. Materialize the tokens in `gesture-studio/src/styles/tokens.css` during Phase 2; do not create a second independently maintained palette.

## 1. Direction

The interface should feel like a compact electronic instrument: a stable playing surface, legible labels, clear status lights, and controls within reach. Music occupies the center. Configuration sits at the edge. The working wordmark is simply “Vybe.”

Use warm charcoal surfaces, ivory text, sage for the melody lane, and amber for the chord lane. Color identifies ownership, not decoration. Red is reserved for recording, overload, destructive actions, and errors, each accompanied by a distinct icon and label.

Do not add a landing-page hero, pricing cards, decorative gradients, glass panels, particles, animated backgrounds, floating badges, invented usage statistics, or an assistant mascot. Do not present “AI” as a feature label. Name the actual control: Note Guide, Scale Guard, Chord Guide.

### Design references and limits

These references inform interaction choices, not copied styling or claims of equivalent functionality. Research used public pages/help text; the browser preview connection was unavailable.

| Reference | Useful lesson | Application here |
|---|---|---|
| [Ableton Learning Music](https://learningmusic.ableton.com/) | Short musical experiments organized by concept | One teachable idea per exercise, immediate audition, optional explanation |
| [Chrome Music Lab: Song Maker](https://blog.google/products-and-platforms/products/education/simple-music-making-everyone/) | Direct musical manipulation with a low entry barrier | Visible selectable targets and a short route to the first sound |
| [BandLab Studio guide](https://help.bandlab.com/hc/en-us/articles/115002945153-Getting-Started-with-the-BandLab-Studio) | Explicit track, input, transport, and recording controls | Show routing and recording destinations before capture begins |

## 2. Tokens

### Color: canonical CSS values

```css
:root {
  color-scheme: dark;
  --bg-canvas: #111514;
  --bg-surface: #191f1d;
  --bg-raised: #232b27;
  --bg-hover: #2c3730;
  --text-primary: #f2f0e8;
  --text-secondary: #b8c1b9;
  --text-muted: #97a59a;
  --border-subtle: #36433a;
  --border-interactive: #75887b;
  --lane-melody: #87bcae;
  --lane-chord: #d8af6e;
  --status-danger: #f28b82;
  --status-warning: #e3be61;
  --status-success: #87bcae;
  --focus-on-dark: #c7dec9;
  --focus-on-light: #29483d;
  --key-natural: #ece8dd;
  --key-accidental: #232b27;
  --ink-on-light: #19201b;

  --font-ui: "IBM Plex Sans", system-ui, sans-serif;
  --font-data: "IBM Plex Mono", ui-monospace, monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --radius-control: 6px;
  --radius-panel: 10px;
  --radius-key: 4px;
  --shadow-overlay: 0 12px 32px rgb(0 0 0 / 28%);
  --motion-feedback: 90ms;
  --motion-panel: 160ms;
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --z-base: 0;
  --z-sticky: 10;
  --z-popover: 20;
  --z-dialog: 30;
  --z-toast: 40;
}
```

Use the subtle border only for decorative separation. Interactive outlines, selected targets, and focus indicators use the stronger tokens. Filled accent buttons use `--ink-on-light`, not white text. Disabled content stays legible; do not lower the opacity of an entire control tree.

The following ratios were calculated from these solid sRGB values. They validate the token pairings only, not an implemented interface.

| Pair | Ratio |
|---|---:|
| Primary text / surface | 14.66:1 |
| Secondary text / raised surface | 7.86:1 |
| Muted text / raised surface | 5.65:1 |
| Interactive border / raised surface | 3.85:1 |
| Dark ink / melody fill | 7.78:1 |
| Dark ink / chord fill | 8.13:1 |
| Dark ink / danger fill | 6.96:1 |
| Dark ink / warning fill | 9.34:1 |
| Dark ink / natural key | 13.57:1 |
| Dark focus / natural key | 8.21:1 |

Normal text must meet 4.5:1; meaningful control/focus boundaries must meet 3:1 against adjacent colors. Recheck new combinations, overlays, and opacity. [Contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

### Typography

Bundle IBM Plex Sans regular/medium/semibold and IBM Plex Mono regular locally with their license. No runtime font service. The family is available from the [official IBM Plex repository](https://github.com/IBM/plex).

| Role | Size / line height | Weight / face |
|---|---|---|
| Workspace title | 24 / 32 px | 500, UI |
| Panel title | 18 / 26 px | 500, UI |
| Body and instructions | 16 / 24 px | 400, UI |
| Control label | 14 / 20 px | 500, UI |
| Secondary information | 13 / 18 px | 400, UI |
| Note/chord primary label | 24 / 30 px | 500, UI |
| BPM, time, bar position | 14 / 20 px | 400, data; tabular figures |

Do not shrink controls below 13 px to fit more features. Use compact notation such as `Cmaj9`, with the full spoken name in the accessible label. Exact pitch lists include octave numbers, for example `C3 E3 B3 D4 G4`. Use contextual sharp/flat spelling while keeping MIDI pitch identity unchanged.

### Geometry

- Layout spacing follows the 4 px scale. Default panel padding: 20 px; workspace gutter: 24 px.
- Conventional controls have at least a 44 × 44 px hit area; a 24 px icon may sit inside it.
- Gesture chord targets are at least 88 × 96 px. Melody targets are at least 64 px wide and 76 px high. Their visible shape and hit geometry come from the same layout definition.
- Use 1 px panel dividers, 2 px selected-target outlines, and a 3 px focus ring with a 2 px offset. Drawing a border must not change element dimensions.
- Panels use borders rather than elevation. Shadows are reserved for popovers/dialogs. No pill-shaped panel containers.

## 3. Application composition

### Shared shell

Use a 56 px header: Vybe, Play / Practice / Studio navigation, project name/save state, Settings. Beneath it, a 64 px transport row contains Play/Pause, Stop playback, Record, BPM, count-in, metronome, Rest, and Stop all. A 28 px status strip reports camera/audio state and the active input route. Detailed diagnostics open separately.

At 1280 × 720, the essential playing controls must fit without vertical scrolling. Extra lesson text, project lists, and editors may scroll. Treat 1440 × 900 as the primary visual review size and 1024 × 640 as the minimum two-hand layout. Wide screens increase spacing modestly; cap the workspace at 1600 px.

```text
┌ Vybe   Play  Practice  Studio       Project · Saved       Settings ┐
├ Play/Pause  Stop playback  Record   BPM  Count-in   Rest  Stop all ┤
│ Assisted / Free   Guides   Scale Guard   Key/Scale   Sound         │
│                                                                  │
│ LEFT · CHORDS                   RIGHT · MELODY                     │
│ [ Cmaj9 ][ Am9  ][ Dm9 ][ G13 ]      [C#] [D#]     [F#] [G#] [A#] │
│ [ empty ][ empty ][empty][empty]   [C] [D] [E] [F] [G] [A] [B]    │
│ [ Rest left                  ]   [ Rest right                  ]  │
│                                                                  │
│ Exact chord pitches / guide explanation      Camera preview       │
├ Camera ready · Audio ready · Left → Chords / Right → Melody       ┤
└──────────────────────────────────────────────────────────────────┘
```

This is a structural wireframe. It does not prescribe box-drawing characters in the application.

### Play

Allocate approximately 40% of the playing width to chords and 60% to melody, with a 24 px gap. The chord grid has two rows and four columns. Melody has seven natural notes on the lower row; five accidentals sit above their corresponding boundaries. Preserve empty upper-row gaps between E/F and B/C.

The rest strip lies below each grid and is visually separated from the playable targets. Hand cursors are small labeled rings: `L` in amber and `R` in sage, with a visible pinch-state change. Keep them from obscuring note labels. Never add a trailing particle effect.

The camera inset is approximately 240 × 135 px, collapsible without stopping tracking, and labeled Camera on. The calibration screen expands the feed and overlays the same coordinate transform used by the playing engine. Do not draw the feed using a crop that differs from the hit-test transform.

### Practice

Retain the playing surface. Place a compact phrase/timing lane above it, with current exercise, target note/chord, speed, and section controls. Expand upcoming notes into the actual targets; avoid a second incompatible keyboard layout.

Keep the instructional text to one short action at a time. Put explanations of intervals, scale degrees, or chord extensions behind “Why this note?” Show a section-end summary with pitch, timing, and assistance context. Do not interrupt every wrong note with a toast or modal.

For MIDI import, use a focused inspector showing track name, available instrument mapping, range, duration, and polyphony warning. Original and simplified arrangements must have distinct labels. A range error offers transposition or a different phrase; it does not move notes automatically.

### Studio

Use a 224 px track header column, a horizontally scrollable timeline, and a collapsible 288 px inspector when space allows. Track rows are at least 64 px high. Show name, instrument, input route, arm, mute, solo, and level. A timeline note is not a generic rounded card.

Separate the original take from its timing edit controls. The default piano roll is inspectable and zoomable; do not display unsupported drag handles or a pencil tool. Percussion gets its specified step editor. Inactive drum steps and empty tracks are visually quiet but clearly actionable.

When recording, show a red record symbol, the word Recording, elapsed time, and armed destinations. Show a distinct Count-in state before capture. A solid status is enough; no continuous flashing.

### Settings, dialogs, and small windows

Group settings into Camera & calibration, Playing, Audio, Storage, and Diagnostics. Make errors actionable within the relevant group. A diagnostic setting is never required in the normal first-sound flow.

At widths below 1200 px, collapse the Studio inspector and place extra transport controls in a labeled menu. Below 1024 × 640, retain readable controls and conventional input; show “Enlarge the window to use both hand areas.” Never silently compress gesture targets below their minimum size. Browser zoom remains enabled.

Changing the viewport during hand performance disarms live input, recalculates layout, and asks for open hands before rearming. Do not preserve a stale hit target after a responsive reflow.

Dialogs have a visible title, focus containment, a close control, and focus restoration. Destructive actions explain the exact project/track involved. Blocking editors cannot open during recording; the disabled action states “Stop recording to edit.”

## 4. Component states

| Component/state | Presentation | Required behavior |
|---|---|---|
| Available note/pad | Neutral surface; readable pitch/label | No sound until activated |
| Selected by hand | 2 px lane-colored inset outline; cursor/target label | Selection remains silent |
| Sounding, held | Solid lane-colored fill, dark text, “Held” marker | Derived from engine state, not animation timing |
| Released with sustain | Neutral surface with a small Pedal marker | Key is no longer shown as physically held |
| Scale Guard blocked | Hatched corner, lock icon, readable note label | Announce reason on conventional activation; no note event |
| Empty chord slot | Dashed border and “Add chord” | Hand input is silent; click opens editor while stopped |
| Hand not ready/lost | Cursor fades; inline “Open left/right hand to resume” | No guessed position or animated fake hand |
| Resting | Rest strip selected, hand label “Resting” | Backing may continue |
| Asset loading | Instrument name and actual item count/indeterminate progress | Do not invent a percentage; instrument remains unarmed |
| Save in progress | “Saving…” | Never precedes commit with “Saved” |
| Save failed | Persistent warning with Export backup action | Remains until resolved or exported; no silent dismissal |
| Overload | Peak indicator plus “Reduce level” | No automatically changing user mix sliders |

Status hierarchy: hard failure near the affected controls; actionable warning in the status strip; routine success next to the completed action. Avoid success toasts for every autosave. Use notifications only for operations that need attention outside the current focus.

### Controls

- Primary buttons: sage fill and dark text. Use one dominant action per setup step.
- Secondary buttons: raised surface with interactive border. Destructive actions use a labeled danger treatment.
- Sliders: include a numeric value, units, keyboard adjustment, and a reset-to-default action. A rotary visual must still expose a conventional input.
- Segmented controls: one selected option with an explicit text label; no icon-only Assisted/Free switch.
- Toggles: label the effect, not the implementation. “Scale Guard” has nearby help: “Only melody notes in this scale can play.”
- Chord editor: mini keyboard, exact pitch list, name, Preview, Save, Cancel. Preview never replaces the pad until Save.
- Preset loader: list changed settings and preserve existing takes. “Apply setup” and “Cancel” are the actions; do not ask a vague “Are you sure?”

## 5. Keyboard and pointer contract

Shortcuts apply when the relevant workspace surface has focus, never in a text field, select, slider, or dialog. Ignore browser/system modifier combinations and key-repeat for toggled actions. Escape always performs Stop all before closing any app overlay.

| Input | Action |
|---|---|
| Space | Play/Pause the transport |
| R | Start/stop recording when a destination is armed |
| Escape | Stop all, clear sustain, disarm live input |
| Left Shift held | Sustain live instrument lanes; release on keyup/focus loss |
| `[` / `]` | Previous/next melody octave, only when idle and stopped |
| A S D F G H J | C D E F G A B in the active melody octave |
| W E T Y U | C-sharp D-sharp F-sharp G-sharp A-sharp |
| 1–8 | Chord slots in reading order |
| Tab / Shift+Tab | Standard focus navigation |

Mouse/pointer note presses use pointer capture; pointerup, pointercancel, and lost capture release the note. Space/Enter on a focused semantic note button auditions that button, taking precedence over transport shortcuts. Touch on ordinary controls is supported; this does not claim mobile camera support.

Conventional input goes through the same intent and audio path as gestures. Switching the active live input source requires release; do not let mouse audition and camera control fight for a hand lane. Editor Preview is a separate non-recorded source.

## 6. Motion and sound feedback

Audio begins independently of visual transitions. Sounding state changes immediately; do not ease a note-on. Hover/focus changes may take 90 ms; panels may take 160 ms. Use opacity or color changes, not target movement. No spring overshoot on pads, no animated rearrangement, and no automatically scrolling the interface beneath a held gesture.

With `prefers-reduced-motion: reduce`, remove decorative transitions and smooth scrolling. Retain necessary playhead position updates. Do not play interface sounds over a musical performance; the instrument itself confirms activation.

## 7. Accessibility and copy

Use native buttons, form labels, landmarks, headings, and visible focus. Pad accessible names include pitch, octave, and availability. Scale-blocked notes may remain focusable with `aria-disabled="true"` so their reason can be discovered; activation still passes through the same blocking rule. Avoid `role="application"`.

Hand positions and note animations are not live announcements. Announce meaningful state changes such as Camera disconnected, Recording started, or Save failed. Offer a quiet status region and a screen-reader-accessible list of current chord pitches. Note colors always have labels, markers, or patterns.

Write short, specific text:

| Situation | Preferred copy |
|---|---|
| Camera denied | “Camera access is off. Allow access to use hand control, or continue with the keyboard.” |
| Camera already in use | “The camera could not start. Close another camera app and try again.” |
| Hand recovery | “Open your left hand to resume.” |
| Asset failure | “Grand piano samples did not load. Retry loading.” |
| Scale restriction | “F-sharp is outside C major. Turn off Scale Guard to play it.” |
| Storage failure | “This take is not saved. Export a backup before closing.” |
| No takes | “Record a part to start this project.” |
| Imported polyphony | “This track contains overlapping notes. Create a simplified melody or use it as accompaniment.” |

Do not use “magical,” “effortless mastery,” “perfect accuracy,” “AI-powered creativity,” or a generic “Something went wrong” without a concrete next action. Do not call a user’s chromatic improvisation wrong.

## 8. Design verification

During Phase 2 create a component showcase covering every state above, using these tokens. It is a development fixture, not a new product screen. During implementation verify:

- Screens at 1440 × 900, 1280 × 720, and 1024 × 640; narrow/200%-zoom fallbacks remain usable.
- Real geometry matches pointer and hand hit testing, including mirroring, gutters, rest strips, and resized windows.
- Keyboard-only setup, chord editing, saving, importing, exporting, and error recovery.
- Contrast for actual rendered combinations; focus visibility; no color-only distinctions.
- Correct held/pedal/released visuals with identical pitches from multiple sources.
- Count-in versus recording; saving versus committed; original versus edited take.
- Empty, loading, permission-denied, missing-asset, quota, offline, and tracking-loss states.
- Reduced motion and absence of layout shifts while playing.

Save screenshots and findings with the phase evidence. A screenshot confirms layout only; actual gestures and audible behavior require their own tests.
