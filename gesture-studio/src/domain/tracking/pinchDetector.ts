export interface PinchThresholds {
  /** Ratio at or below which the pinch counts as closed. */
  press: number;
  /** Ratio at or above which the pinch counts as open. press < release. */
  release: number;
}

export type PinchState = "unknown" | "open" | "closed";
export type PinchTransition = "opened" | "closed" | null;

/** A crossing must persist across this many valid frames spanning at least MIN_CONFIRM_MS. */
export const CONFIRM_FRAMES = 2;
export const MIN_CONFIRM_MS = 20;

/**
 * Hysteresis pinch detector on the raw (unsmoothed) pinch ratio. Reports
 * confirmed transitions only; the hand state machine decides what they mean.
 */
export class PinchDetector {
  private current: PinchState = "unknown";
  private candidate: { target: "open" | "closed"; firstMs: number; frames: number } | null = null;
  private readonly t: PinchThresholds;

  constructor(thresholds: PinchThresholds) {
    if (!(thresholds.press > 0) || !(thresholds.release > thresholds.press)) {
      throw new RangeError("Pinch thresholds need 0 < press < release.");
    }
    this.t = { ...thresholds };
  }

  state(): PinchState {
    return this.current;
  }

  update(ratio: number, tMs: number): PinchTransition {
    const zone: "open" | "closed" | null = ratio <= this.t.press ? "closed" : ratio >= this.t.release ? "open" : null;
    if (zone === null || zone === this.current) {
      this.candidate = null;
      return null;
    }
    if (this.candidate?.target !== zone) {
      this.candidate = { target: zone, firstMs: tMs, frames: 1 };
      return null;
    }
    this.candidate.frames += 1;
    if (this.candidate.frames >= CONFIRM_FRAMES && tMs - this.candidate.firstMs >= MIN_CONFIRM_MS) {
      this.current = zone;
      this.candidate = null;
      return zone === "closed" ? "closed" : "opened";
    }
    return null;
  }

  /** A frame without a usable measurement interrupts any pending confirmation. */
  invalidFrame(): void {
    this.candidate = null;
  }

  /** Forget the state entirely (loss, ambiguity, rest): recovery needs fresh evidence. */
  reset(): void {
    this.current = "unknown";
    this.candidate = null;
  }
}
