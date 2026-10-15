import { describe, expect, it } from "vitest";
import { steadyFrameRateConstraints } from "../../../../src/domain/tracking/exposure";

describe("steadyFrameRateConstraints", () => {
  const caps = { exposureMode: ["manual", "continuous"], exposureTime: { min: 40, max: 10000 } };

  it("caps manual exposure at 80% of a frame period, leaving the sensor time to read out (100 µs units)", () => {
    // A full-frame exposure (333) held the owner's camera at 25 fps; 80% of 33.3 ms = 26.6 ms.
    expect(steadyFrameRateConstraints(caps, 30)).toEqual({ ok: true, value: { exposureMode: "manual", exposureTime: 266 } });
  });

  it("respects the camera's exposure range", () => {
    expect(steadyFrameRateConstraints({ ...caps, exposureTime: { min: 40, max: 200 } }, 30)).toEqual({
      ok: true,
      value: { exposureMode: "manual", exposureTime: 200 },
    });
  });

  it("reports cameras that cannot do manual exposure", () => {
    expect(steadyFrameRateConstraints({ exposureMode: ["continuous"] }, 30).ok).toBe(false);
    expect(steadyFrameRateConstraints({}, 30).ok).toBe(false);
    expect(steadyFrameRateConstraints({ exposureMode: ["manual"] }, 30).ok).toBe(false);
  });
});
