import { describe, expect, it } from "vitest";
import { calibrateFlick, strokeFeatures } from "../../../../src/domain/tracking/calibration";

const range = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe("strokeFeatures", () => {
  it("measures the largest fall within 150 ms, the fastest falling frame pair and the lowest extension", () => {
    const f = strokeFeatures([
      { e: 2.0, tMs: 0 },
      { e: 2.0, tMs: 33 },
      { e: 1.7, tMs: 66 },
      { e: 1.3, tMs: 99 },
      { e: 1.2, tMs: 132 },
      { e: 1.8, tMs: 300 },
    ]);
    expect(f.drop).toBeCloseTo(0.8, 10);
    expect(f.rate).toBeCloseTo(0.4 / 0.033, 6);
    expect(f.minE).toBeCloseTo(1.2, 10);
  });

  it("returns zeros for fewer than two samples", () => {
    expect(strokeFeatures([{ e: 2, tMs: 0 }])).toEqual({ drop: 0, rate: 0, minE: 2 });
  });
});

describe("calibrateFlick", () => {
  const open = range(30, (i) => 1.95 + (i % 5) * 0.02);
  const flicks = range(8, (i) => ({ drop: 0.7 + (i % 3) * 0.05, rate: 10 + (i % 4), minE: 1.2 + (i % 3) * 0.03 }));
  const moves = range(12, (i) => ({ drop: 0.08 + (i % 4) * 0.02, rate: 1 + (i % 3) * 0.5, minE: 1.9 }));

  it("places thresholds between ordinary movement and the owner's flicks", () => {
    const r = calibrateFlick(open, flicks, moves);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.value;
    expect(c.dropMin).toBeGreaterThan(0.14);
    expect(c.dropMin).toBeLessThan(0.7);
    expect(c.rateMin).toBeGreaterThan(2);
    expect(c.rateMin).toBeLessThan(10);
    expect(c.flexLevel).toBeLessThan(c.releaseLevel);
    expect(c.releaseLevel).toBeLessThan(c.openLevel);
    expect(c.openLevel).toBeLessThanOrEqual(c.openLow);
  });

  it("rejects flicks that look like ordinary movement instead of pretending success", () => {
    const weak = range(8, () => ({ drop: 0.12, rate: 1.5, minE: 1.85 }));
    expect(calibrateFlick(open, weak, moves)).toMatchObject({ ok: false, error: { code: "flick-overlap" } });
  });

  it("rejects movement that is as fast as the flicks", () => {
    const fastMoves = range(12, () => ({ drop: 0.1, rate: 12, minE: 1.9 }));
    expect(calibrateFlick(open, flicks, fastMoves)).toMatchObject({ ok: false, error: { code: "flick-overlap" } });
  });

  it("rejects inconsistent flicks", () => {
    const erratic = range(8, (i) => ({ drop: i % 2 ? 1.2 : 0.3, rate: 10, minE: 1.2 }));
    expect(calibrateFlick(open, erratic, moves)).toMatchObject({ ok: false, error: { code: "flick-unreliable" } });
  });

  it("needs enough examples", () => {
    expect(calibrateFlick(open, flicks.slice(0, 3), moves)).toMatchObject({ ok: false, error: { code: "too-few-samples" } });
  });
});
