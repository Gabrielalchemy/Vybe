/** The gesture that plays a note. */
export type TriggerGesture = "flick" | "pinch";

export type TriggerState = "unknown" | "open" | "closed";
export type TriggerTransition = "opened" | "closed" | null;

/**
 * Common surface of the play-gesture detectors (pinch, flick). "closed" is a
 * press, "opened" a release or neutral-open evidence. Implementations never
 * re-press without an "opened" in between.
 */
export interface TriggerDetector {
  update(value: number, tMs: number): TriggerTransition;
  state(): TriggerState;
  invalidFrame(): void;
  reset(): void;
  /** Start of the stroke behind the latest press, when it differs from the press frame. */
  onsetMs(): number | null;
}
