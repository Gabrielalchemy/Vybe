import { percentile } from "./calibration";

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

/** Bounded in-memory window of recent samples (diagnostics only; never persisted). */
export class RollingWindow {
  private values: number[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(v: number): void {
    this.values.push(v);
    if (this.values.length > this.capacity) this.values.shift();
  }

  size(): number {
    return this.values.length;
  }

  summary(): Summary | null {
    if (this.values.length === 0) return null;
    return {
      count: this.values.length,
      p50: percentile(this.values, 50),
      p95: percentile(this.values, 95),
      max: Math.max(...this.values),
    };
  }

  clear(): void {
    this.values = [];
  }
}

/** Events per second over a trailing window. */
export class RateMeter {
  private marks: number[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  mark(tMs: number): void {
    this.marks.push(tMs);
    const cutoff = tMs - this.windowMs;
    while (this.marks.length && (this.marks[0] as number) <= cutoff) this.marks.shift();
  }

  perSecond(nowMs: number): number {
    const cutoff = nowMs - this.windowMs;
    return (this.marks.filter((t) => t > cutoff).length * 1000) / this.windowMs;
  }

  clear(): void {
    this.marks = [];
  }
}
