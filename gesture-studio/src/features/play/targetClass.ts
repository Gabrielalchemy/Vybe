import type { LayoutTarget } from "../../domain/layout";
import type { TargetView } from "./Lane";

export interface TargetFlags {
  /** Sounding with the key held (derived from engine state). */
  held?: boolean;
  /** Key released, voice kept by the pedal. */
  pedal?: boolean;
  /** Rest strip currently selected. */
  resting?: boolean;
  /** Hover selection by a hand cursor; always silent. */
  selected?: boolean;
  /** Blocked by Scale Guard (Phase 5); visible and readable, never substituted. */
  blocked?: boolean;
}

const ACCIDENTAL_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function targetClassName(target: Pick<LayoutTarget, "kind" | "index">, view: TargetView | null, flags: TargetFlags): string {
  return [
    "target",
    `target--${target.kind}`,
    target.kind === "melody-note" && ACCIDENTAL_PITCH_CLASSES.has(target.index) ? "target--accidental" : "",
    flags.held ? "is-held" : "",
    flags.pedal ? "is-pedal" : "",
    flags.selected ? "is-selected" : "",
    flags.blocked ? "is-blocked" : "",
    flags.resting ? "is-resting" : "",
    view?.empty ? "is-empty" : "",
    view && !view.available ? "is-unavailable" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
