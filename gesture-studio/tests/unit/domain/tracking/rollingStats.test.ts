import { describe, expect, it } from "vitest";
import { RateMeter, RollingWindow } from "../../../../src/domain/tracking/rollingStats";

describe("RollingWindow", () => {
  it("reports percentiles over the most recent samples only", () => {
    const w = new RollingWindow(5);
    for (const v of [100, 100, 1, 2, 3, 4, 5]) w.push(v);
    expect(w.size()).toBe(5);
    expect(w.summary()).toEqual({ count: 5, p50: 3, p95: 4.8, max: 5 });
  });

  it("returns null when empty", () => {
    expect(new RollingWindow(3).summary()).toBeNull();
  });
});

describe("RateMeter", () => {
  it("measures events per second over a trailing window", () => {
    const m = new RateMeter(1000);
    for (let t = 0; t <= 1000; t += 33.3) m.mark(t);
    expect(m.perSecond(1000)).toBeCloseTo(30, 0);
    expect(m.perSecond(2500)).toBe(0);
  });
});
