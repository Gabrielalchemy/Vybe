import { describe, expect, it } from "vitest";
import { CursorFilter } from "../../../../src/domain/tracking/cursorFilter";
import { PinchDetector } from "../../../../src/domain/tracking/pinchDetector";

describe("CursorFilter", () => {
  it("passes the first sample through", () => {
    const f = new CursorFilter(35);
    expect(f.update({ x: 0.3, y: 0.4 }, 1000)).toEqual({ x: 0.3, y: 0.4 });
  });

  it("uses timestamp-based alpha so equal elapsed time gives equal smoothing at any frame rate", () => {
    const at30 = new CursorFilter(35);
    at30.update({ x: 0, y: 0 }, 0);
    at30.update({ x: 1, y: 0 }, 33.3);
    const r30 = at30.update({ x: 1, y: 0 }, 66.6);
    const at60 = new CursorFilter(35);
    at60.update({ x: 0, y: 0 }, 0);
    for (const t of [16.65, 33.3, 49.95]) at60.update({ x: 1, y: 0 }, t);
    const r60 = at60.update({ x: 1, y: 0 }, 66.6);
    expect(r60.x).toBeCloseTo(r30.x, 2);
    expect(r30.x).toBeCloseTo(1 - Math.exp(-66.6 / 35), 6);
  });

  it("does not move on a non-advancing timestamp", () => {
    const f = new CursorFilter(35);
    f.update({ x: 0, y: 0 }, 100);
    expect(f.update({ x: 1, y: 1 }, 100)).toEqual({ x: 0, y: 0 });
  });

  it("restarts from the next sample after reset", () => {
    const f = new CursorFilter(35);
    f.update({ x: 0, y: 0 }, 0);
    f.reset();
    expect(f.update({ x: 0.9, y: 0.1 }, 50)).toEqual({ x: 0.9, y: 0.1 });
  });
});

describe("PinchDetector", () => {
  // Calibrated thresholds: below `press` counts as closed, above `release` as open.
  const thresholds = { press: 0.4, release: 0.8 };
  const feed = (d: PinchDetector, samples: [number, number][]) => samples.map(([ratio, t]) => d.update(ratio, t));

  it("starts unknown and reports neutral open only after a confirmed open", () => {
    const d = new PinchDetector(thresholds);
    expect(d.state()).toBe("unknown");
    expect(feed(d, [[1.2, 0]])).toEqual([null]);
    expect(feed(d, [[1.2, 33]])).toEqual(["opened"]);
    expect(d.state()).toBe("open");
  });

  it("confirms a close only after two valid frames spanning at least 20 ms", () => {
    const d = new PinchDetector(thresholds);
    feed(d, [[1.2, 0], [1.2, 33]]);
    expect(feed(d, [[0.2, 66], [0.2, 80]])).toEqual([null, null]); // only 14 ms apart
    expect(feed(d, [[0.2, 90]])).toEqual(["closed"]);
  });

  it("ignores a single-frame dip (tremor) below the press threshold", () => {
    const d = new PinchDetector(thresholds);
    feed(d, [[1.2, 0], [1.2, 33]]);
    expect(feed(d, [[0.2, 66], [1.1, 99], [1.1, 132]])).toEqual([null, null, null]);
    expect(d.state()).toBe("open");
  });

  it("holds state inside the hysteresis band and never retriggers while held", () => {
    const d = new PinchDetector(thresholds);
    feed(d, [[1.2, 0], [1.2, 33], [0.2, 66], [0.2, 99]]);
    expect(d.state()).toBe("closed");
    const out = feed(d, [[0.6, 132], [0.3, 165], [0.6, 198], [0.3, 231], [0.7, 264]]);
    expect(out.every((x) => x === null)).toBe(true);
    expect(feed(d, [[0.9, 297], [0.9, 330]])).toEqual([null, "opened"]);
  });

  it("an invalid frame breaks a pending confirmation", () => {
    const d = new PinchDetector(thresholds);
    feed(d, [[1.2, 0], [1.2, 33], [0.2, 66]]);
    d.invalidFrame();
    expect(feed(d, [[0.2, 99]])).toEqual([null]);
    expect(feed(d, [[0.2, 132]])).toEqual(["closed"]);
  });

  it("reset returns to unknown so recovery needs fresh neutral evidence", () => {
    const d = new PinchDetector(thresholds);
    feed(d, [[1.2, 0], [1.2, 33], [0.2, 66], [0.2, 99]]);
    d.reset();
    expect(d.state()).toBe("unknown");
    // A closed hand after reset is reported as closed, which the hand state machine will not treat as a press.
    expect(feed(d, [[0.2, 132], [0.2, 165]])).toEqual([null, "closed"]);
  });

  it("rejects thresholds without a positive hysteresis band", () => {
    expect(() => new PinchDetector({ press: 0.5, release: 0.5 })).toThrow();
  });
});
