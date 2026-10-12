import type { HandRole } from "../../domain/events";
import type { TargetKind } from "../../domain/layout";
import { SaveIndicator } from "../../ui/SaveIndicator";
import type { TargetView } from "../play/Lane";
import { TargetFace } from "../play/TargetFace";
import { targetClassName, type TargetFlags } from "../play/targetClass";

/**
 * Development fixture (DESIGN_SYSTEM.md §8): every component state rendered
 * with the production classes and components. Not a product screen. States for
 * features built in later phases are marked as such.
 */
interface Sample {
  caption: string;
  kind: TargetKind;
  hand: HandRole;
  index: number;
  view: TargetView | null;
  flags: TargetFlags;
}

const note = (label: string, detail: string, available = true): TargetView => ({ label, detail, accessibleName: detail, available });
const chordView = (label: string, detail: string): TargetView => ({ label, detail, accessibleName: label, available: true });

const SAMPLES: Sample[] = [
  { caption: "Available natural", kind: "melody-note", hand: "right", index: 0, view: note("C", "C4"), flags: {} },
  { caption: "Available accidental", kind: "melody-note", hand: "right", index: 1, view: note("C#", "C#4"), flags: {} },
  { caption: "Selected by hand (silent)", kind: "melody-note", hand: "right", index: 1, view: note("C#", "C#4"), flags: { selected: true } },
  { caption: "Sounding, held", kind: "melody-note", hand: "right", index: 4, view: note("E", "E4"), flags: { held: true } },
  { caption: "Released with sustain", kind: "melody-note", hand: "right", index: 3, view: note("D#", "D#4"), flags: { pedal: true } },
  { caption: "Scale Guard blocked (Phase 5)", kind: "melody-note", hand: "right", index: 6, view: note("F#", "F#4"), flags: { blocked: true } },
  { caption: "Outside piano range", kind: "melody-note", hand: "right", index: 1, view: note("C#", "C#8", false), flags: {} },
  { caption: "Chord available", kind: "chord-pad", hand: "left", index: 0, view: chordView("Cmaj9", "C3 E3 B3 D4 G4"), flags: {} },
  { caption: "Chord selected (silent)", kind: "chord-pad", hand: "left", index: 1, view: chordView("Am9", "A2 G3 B3 C4 E4"), flags: { selected: true } },
  { caption: "Chord held", kind: "chord-pad", hand: "left", index: 2, view: chordView("Dm9", "D3 F3 C4 E4 A4"), flags: { held: true } },
  { caption: "Chord with pedal", kind: "chord-pad", hand: "left", index: 3, view: chordView("G13", "G2 F3 B3 E4 A4"), flags: { pedal: true } },
  { caption: "Empty chord slot", kind: "chord-pad", hand: "left", index: 4, view: { label: "Empty", detail: "", accessibleName: "Empty", available: true, empty: true }, flags: {} },
  { caption: "Rest strip", kind: "rest", hand: "left", index: -1, view: null, flags: {} },
  { caption: "Resting", kind: "rest", hand: "left", index: -1, view: null, flags: { resting: true } },
];

export function Showcase() {
  return (
    <main className="showcase">
      <h1 className="workspace-title">Component showcase (development fixture)</h1>

      <section>
        <h2 className="panel__title">Playing targets</h2>
        <div className="showcase__grid">
          {SAMPLES.map((s) => (
            <div key={s.caption} className="showcase__item">
              <div className={s.kind === "melody-note" ? "lane--melody" : "lane--chord"}>
                <button type="button" className={`${targetClassName(s, s.view, s.flags)} ${s.hand === "left" ? "chord" : "melody"}`} aria-label={s.caption}>
                  <TargetFace kind={s.kind} hand={s.hand} view={s.view} flags={s.flags} />
                </button>
              </div>
              <span className="showcase__caption">{s.caption}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Hand cursors (Phase 3)</h2>
        <div className="cursor-demo">
          <span className="hand-cursor hand-cursor--left"><span>L</span></span> Open
          <span className="hand-cursor hand-cursor--left is-pinched"><span>L</span></span> Pinched
          <span className="hand-cursor hand-cursor--right"><span>R</span></span> Open
          <span className="hand-cursor hand-cursor--right is-pinched"><span>R</span></span> Pinched
          <span className="hand-cursor hand-cursor--right is-lost"><span>R</span></span> Open your right hand to resume.
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Save states</h2>
        <div className="cursor-demo">
          <SaveIndicator status={{ kind: "saved", revision: 3 }} />
          <SaveIndicator status={{ kind: "unsaved", revision: 3 }} />
          <SaveIndicator status={{ kind: "saving", revision: 3 }} />
          <SaveIndicator status={{ kind: "failed", revision: 3, error: { code: "quota-exceeded", message: "" } }} />
        </div>
        <p className="notice notice--danger"><span aria-hidden="true">✕ </span>This take is not saved. Export a backup before closing.</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Status and notices</h2>
        <p className="notice notice--warning"><span aria-hidden="true">▲ </span>Camera access is off. Allow access to use hand control, or continue with the keyboard.</p>
        <p className="notice notice--warning"><span aria-hidden="true">▲ </span>Grand piano samples did not load. Retry loading.</p>
        <p>Grand piano: loading 12 of 48 samples (Phase 4)</p>
        <p className="meter"><span className="meter__bar"><span className="meter__fill" style={{ width: "100%" }} /></span> <span aria-hidden="true">▲ </span>Peak — Reduce level (Phase 6)</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Buttons</h2>
        <div className="cursor-demo">
          <button type="button" className="button button--primary">Primary</button>
          <button type="button" className="button">Secondary</button>
          <button type="button" className="button button--danger"><span aria-hidden="true">■ </span>Stop all</button>
          <button type="button" className="button" disabled>Disabled</button>
        </div>
      </section>
    </main>
  );
}
