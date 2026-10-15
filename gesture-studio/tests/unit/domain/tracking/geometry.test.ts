import { describe, expect, it } from "vitest";
import { fingerExtension, palmCenter, pinchRatio, toDisplay } from "../../../../src/domain/tracking/geometry";
import { syntheticHand } from "../../../fixtures/hands";

const square = { width: 640, height: 640 };
const wide = { width: 640, height: 360 };

describe("palmCenter", () => {
  it("is the mean of the wrist and the four MCP joints", () => {
    const hand = syntheticHand({ cx: 0.5, cy: 0.5 });
    const c = palmCenter(hand);
    const ids = [0, 5, 9, 13, 17];
    expect(c.x).toBeCloseTo(ids.reduce((s, i) => s + hand[i]!.x, 0) / 5, 10);
    expect(c.y).toBeCloseTo(ids.reduce((s, i) => s + hand[i]!.y, 0) / 5, 10);
  });
});

describe("pinchRatio", () => {
  it("decreases as thumb and index close, independent of hand scale", () => {
    const open = pinchRatio(syntheticHand({ cx: 0.5, cy: 0.5, pinch: 0 }), square);
    const closed = pinchRatio(syntheticHand({ cx: 0.5, cy: 0.5, pinch: 1 }), square);
    const openBig = pinchRatio(syntheticHand({ cx: 0.5, cy: 0.5, pinch: 0, scale: 0.16 }), square);
    expect(open.ok && closed.ok && openBig.ok).toBe(true);
    if (open.ok && closed.ok && openBig.ok) {
      expect(closed.value).toBeLessThan(0.1);
      expect(open.value).toBeGreaterThan(1);
      expect(openBig.value).toBeCloseTo(open.value, 6);
    }
  });

  it("corrects for camera aspect ratio before measuring distances", () => {
    // The same physical hand, captured in a 16:9 frame, is squashed in normalized y.
    const hand = syntheticHand({ cx: 0.5, cy: 0.5, pinch: 0.3 });
    const squashed = hand.map((p) => ({ ...p, y: 0.5 + (p.y - 0.5) * (640 / 360) }));
    const a = pinchRatio(hand, square);
    const b = pinchRatio(squashed, wide);
    expect(a.ok && b.ok && Math.abs(a.value - b.value)).toBeLessThan(1e-9);
  });

  it("rejects an implausibly small palm span instead of dividing by ~0", () => {
    const degenerate = syntheticHand({ cx: 0.5, cy: 0.5, scale: 0.0005 });
    expect(pinchRatio(degenerate, square).ok).toBe(false);
  });

  it("rejects landmark sets that are not 21 finite points", () => {
    expect(pinchRatio([], square).ok).toBe(false);
    const nan = syntheticHand({ cx: 0.5, cy: 0.5 });
    nan[4] = { x: Number.NaN, y: 0, z: 0 };
    expect(pinchRatio(nan, square).ok).toBe(false);
  });
});

describe("toDisplay", () => {
  it("mirrors x once when the view is mirrored", () => {
    expect(toDisplay({ x: 0.2, y: 0.3 }, true)).toEqual({ x: 0.8, y: 0.3 });
    expect(toDisplay({ x: 0.2, y: 0.3 }, false)).toEqual({ x: 0.2, y: 0.3 });
  });
});

describe("fingerExtension", () => {
  it("falls as the fingers fold, independent of hand position and scale", () => {
    const open = fingerExtension(syntheticHand({ cx: 0.5, cy: 0.5, flex: 0 }), square);
    const folded = fingerExtension(syntheticHand({ cx: 0.5, cy: 0.5, flex: 1 }), square);
    const movedBig = fingerExtension(syntheticHand({ cx: 0.2, cy: 0.7, flex: 0, scale: 0.15 }), square);
    expect(open.ok && folded.ok && movedBig.ok).toBe(true);
    if (open.ok && folded.ok && movedBig.ok) {
      expect(open.value - folded.value).toBeGreaterThan(0.6);
      expect(movedBig.value).toBeCloseTo(open.value, 6);
    }
  });

  it("corrects for camera aspect ratio", () => {
    const hand = syntheticHand({ cx: 0.5, cy: 0.5, flex: 0.4 });
    const squashed = hand.map((p) => ({ ...p, y: 0.5 + (p.y - 0.5) * (640 / 360) }));
    const a = fingerExtension(hand, square);
    const b = fingerExtension(squashed, wide);
    expect(a.ok && b.ok && Math.abs(a.value - b.value)).toBeLessThan(1e-9);
  });

  it("rejects degenerate hands", () => {
    expect(fingerExtension(syntheticHand({ cx: 0.5, cy: 0.5, scale: 0.0005 }), square).ok).toBe(false);
    expect(fingerExtension([], square).ok).toBe(false);
  });
});

