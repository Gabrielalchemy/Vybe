import { describe, expect, it } from "vitest";
import { FlickDetector } from "../../../../src/domain/tracking/flickDetector";

// Extension values in palm widths; open hand ~2.0, fingers folded ~1.2.
const T = { openLevel: 1.8, releaseLevel: 1.6, dropMin: 0.35, rateMin: 3 };
const FRAME = 33;

function run(d: FlickDetector, values: number[], startMs = 0) {
  return values.map((v, i) => d.update(v, startMs + i * FRAME));
}

function armed() {
  const d = new FlickDetector(T);
  run(d, [2.0, 2.0]);
  return d;
}

describe("FlickDetector", () => {
  it("starts unknown and reports neutral open only after a confirmed open hand", () => {
    const d = new FlickDetector(T);
    expect(d.state()).toBe("unknown");
    expect(run(d, [2.0, 2.0])).toEqual([null, "opened"]);
    expect(d.state()).toBe("open");
  });

  it("a fast flick presses exactly once, on the second frame of the motion", () => {
    const d = armed();
    const out = run(d, [2.0, 1.75, 1.45, 1.25, 1.2, 1.2, 1.2], 2 * FRAME);
    expect(out).toEqual([null, null, "closed", null, null, null, null]);
    expect(d.onsetMs()).toBe(3 * FRAME); // the first moving frame
  });

  it("a slow fold never presses", () => {
    const d = armed();
    const out = run(d, [2.0, 1.95, 1.9, 1.85, 1.8, 1.75, 1.7, 1.65, 1.6, 1.55, 1.5, 1.45, 1.4, 1.35, 1.3, 1.25, 1.2], 2 * FRAME);
    expect(out.every((x) => x === null)).toBe(true);
  });

  it("a single-frame dip (tracking noise) does not press", () => {
    const d = armed();
    expect(run(d, [2.0, 1.3, 2.0, 2.0], 2 * FRAME).every((x) => x === null)).toBe(true);
  });

  it("holding the fingers down never retriggers; lifting releases", () => {
    const d = armed();
    run(d, [1.75, 1.45, 1.25], 2 * FRAME);
    expect(d.state()).toBe("closed");
    expect(run(d, [1.2, 1.15, 1.25, 1.1, 1.2], 5 * FRAME).every((x) => x === null)).toBe(true);
    expect(run(d, [1.65, 1.7], 10 * FRAME)).toEqual([null, "opened"]);
  });

  it("a second flick needs the fingers lifted first", () => {
    const d = armed();
    run(d, [1.75, 1.45, 1.25], 2 * FRAME);
    // A further jerk while still folded is not a new press.
    expect(run(d, [1.4, 1.0, 0.8], 5 * FRAME).every((x) => x === null)).toBe(true);
    run(d, [1.7, 1.75, 2.0, 2.0], 8 * FRAME);
    expect(run(d, [1.75, 1.45], 12 * FRAME)).toEqual([null, "closed"]);
  });

  it("an invalid frame breaks a stroke in progress", () => {
    const d = armed();
    run(d, [1.75], 2 * FRAME);
    d.invalidFrame();
    expect(run(d, [1.45, 1.25], 3 * FRAME)).toEqual([null, null]);
  });

  it("after reset a hand that comes back folded cannot press; it must open first", () => {
    const d = armed();
    d.reset();
    expect(run(d, [1.2, 1.2, 1.2], 2 * FRAME).every((x) => x === null)).toBe(true);
    expect(run(d, [2.0, 2.0], 5 * FRAME)).toEqual([null, "opened"]);
  });

  it("needs the motion to span at least 20 ms", () => {
    const d = armed();
    // The samples a stroke is judged on (open, falling, falling) span only 10 ms.
    expect([d.update(2.0, 100), d.update(1.75, 105), d.update(1.45, 110)]).toEqual([null, null, null]);
  });

  it("rejects thresholds that are not ordered", () => {
    expect(() => new FlickDetector({ ...T, releaseLevel: 1.9 })).toThrow();
    expect(() => new FlickDetector({ ...T, rateMin: 0 })).toThrow();
  });
});
