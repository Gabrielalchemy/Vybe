import type { TriggerDetector, TriggerState, TriggerTransition } from "./triggerDetector";

export interface FlickThresholds {
  /** Extension at or above which the fingers count as open (neutral evidence). */
  openLevel: number;
  /** Extension at or above which held fingers count as lifted (release). releaseLevel < openLevel. */
  releaseLevel: number;
  /** Minimum fall in extension, from the recent maximum, for a flick. */
  dropMin: number;
  /** Minimum falling rate on the latest frame pair, extension units per second. */
  rateMin: number;
}

/** Recent samples kept for the drop measurement. */
export const FLICK_WINDOW_MS = 150;
/** The samples a stroke is judged on must span at least this long (two-frame confirmation). */
export const MIN_STROKE_SPAN_MS = 20;

interface Sample {
  e: number;
  tMs: number;
}

/**
 * Detects a finger flick from the finger-extension signal. A press fires
 * during the motion, once the fall has continued over two frame pairs; it
 * needs no full closure. A slow fold, a single noisy frame or moving the whole
 * hand (extension unchanged) does not press. Release needs the fingers lifted.
 */
export class FlickDetector implements TriggerDetector {
  private readonly t: FlickThresholds;
  private current: TriggerState = "unknown";
  private history: Sample[] = [];
  private confirm: { target: "open"; firstMs: number; frames: number } | null = null;
  private onset: number | null = null;

  constructor(thresholds: FlickThresholds) {
    if (!(thresholds.releaseLevel < thresholds.openLevel) || !(thresholds.dropMin > 0) || !(thresholds.rateMin > 0)) {
      throw new RangeError("Flick thresholds need releaseLevel < openLevel and positive drop and rate.");
    }
    this.t = { ...thresholds };
  }

  state(): TriggerState {
    return this.current;
  }

  /** Time of the first frame of the stroke that produced the latest press. */
  onsetMs(): number | null {
    return this.onset;
  }

  update(e: number, tMs: number): TriggerTransition {
    this.history.push({ e, tMs });
    this.history = this.history.filter((s) => tMs - s.tMs <= FLICK_WINDOW_MS);

    if (this.current === "closed") {
      return this.confirmLevel(e >= this.t.releaseLevel, tMs) ? this.set("open", "opened") : null;
    }
    if (this.current === "unknown") {
      return this.confirmLevel(e >= this.t.openLevel, tMs) ? this.set("open", "opened") : null;
    }
    // Open: look for a stroke over the last three samples.
    const n = this.history.length;
    if (n < 3) return null;
    const [a, b, c] = this.history.slice(-3) as [Sample, Sample, Sample];
    if (c.tMs - a.tMs < MIN_STROKE_SPAN_MS) return null;
    const rate = (from: Sample, to: Sample) => (to.tMs > from.tMs ? ((from.e - to.e) * 1000) / (to.tMs - from.tMs) : 0);
    const peak = Math.max(...this.history.map((s) => s.e));
    if (rate(a, b) >= this.t.rateMin / 2 && rate(b, c) >= this.t.rateMin && peak - c.e >= this.t.dropMin) {
      this.onset = b.tMs;
      this.confirm = null;
      return this.set("closed", "closed");
    }
    return null;
  }

  invalidFrame(): void {
    this.history = [];
    this.confirm = null;
  }

  reset(): void {
    this.current = "unknown";
    this.history = [];
    this.confirm = null;
    this.onset = null;
  }

  private confirmLevel(met: boolean, tMs: number): boolean {
    if (!met) {
      this.confirm = null;
      return false;
    }
    if (!this.confirm) {
      this.confirm = { target: "open", firstMs: tMs, frames: 1 };
      return false;
    }
    this.confirm.frames += 1;
    if (this.confirm.frames >= 2 && tMs - this.confirm.firstMs >= MIN_STROKE_SPAN_MS) {
      this.confirm = null;
      return true;
    }
    return false;
  }

  private set(state: TriggerState, transition: Exclude<TriggerTransition, null>): TriggerTransition {
    this.current = state;
    if (state === "open") this.history = this.history.slice(-1);
    return transition;
  }
}
