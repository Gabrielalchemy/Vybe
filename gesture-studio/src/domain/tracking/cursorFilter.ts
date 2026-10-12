import type { Point2 } from "./geometry";

/** Initial time constant (architecture.md §5); tuned only against measured trials. */
export const DEFAULT_CURSOR_TAU_MS = 35;

/**
 * Exponential cursor smoothing with timestamp-based alpha, so the same elapsed
 * time produces the same smoothing at any frame rate. Applied to the palm
 * cursor only, never to pinch onset.
 */
export class CursorFilter {
  private value: Point2 | null = null;
  private lastMs = 0;
  private readonly tauMs: number;

  constructor(tauMs: number = DEFAULT_CURSOR_TAU_MS) {
    if (!(tauMs > 0)) throw new RangeError("Cursor time constant must be positive.");
    this.tauMs = tauMs;
  }

  update(p: Point2, tMs: number): Point2 {
    if (this.value === null) {
      this.value = { x: p.x, y: p.y };
      this.lastMs = tMs;
      return { ...this.value };
    }
    const dt = tMs - this.lastMs;
    if (dt <= 0) return { ...this.value };
    const alpha = 1 - Math.exp(-dt / this.tauMs);
    this.value = { x: this.value.x + alpha * (p.x - this.value.x), y: this.value.y + alpha * (p.y - this.value.y) };
    this.lastMs = tMs;
    return { ...this.value };
  }

  reset(): void {
    this.value = null;
  }
}
