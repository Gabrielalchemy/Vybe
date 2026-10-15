import { describe, expect, it } from "vitest";
import {
  PROFILE_VERSION,
  calibratePinch,
  calibrateReach,
  checkCompatibility,
  percentile,
  recommendTempo,
  validateCalibrationProfile,
  type CalibrationProfile,
} from "../../../../src/domain/tracking/calibration";

const range = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe("percentile", () => {
  it("interpolates linearly between order statistics", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 90)).toBeCloseTo(4.6, 10);
    expect(percentile([5, 1, 3], 0)).toBe(1);
  });
});

describe("calibratePinch", () => {
  const closed = range(40, (i) => 0.15 + (i % 5) * 0.01); // 0.15..0.19
  const open = range(40, (i) => 1.2 + (i % 5) * 0.02); // 1.20..1.28

  it("derives press and release thresholds from the gap between distributions", () => {
    const r = calibratePinch(open, closed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { closedHigh, openLow, press, release } = r.value;
    expect(closedHigh).toBeCloseTo(0.19, 6);
    expect(openLow).toBeCloseTo(1.2, 6);
    const gap = openLow - closedHigh;
    expect(press).toBeCloseTo(closedHigh + 0.25 * gap, 10);
    expect(release).toBeCloseTo(closedHigh + 0.65 * gap, 10);
  });

  it("rejects overlapping open and closed distributions instead of pretending success", () => {
    const r = calibratePinch(range(40, (i) => 0.3 + i * 0.01), range(40, (i) => 0.2 + i * 0.01));
    expect(r).toMatchObject({ ok: false, error: { code: "pinch-overlap" } });
  });

  it("rejects a gap smaller than three times the larger spread", () => {
    const noisyClosed = range(40, (i) => 0.2 + (i % 10) * 0.05); // MAD 0.1
    const r = calibratePinch(range(40, () => 0.8), noisyClosed);
    expect(r).toMatchObject({ ok: false, error: { code: "pinch-unreliable" } });
  });

  it("requires enough samples of each", () => {
    expect(calibratePinch([1.2, 1.3], closed)).toMatchObject({ ok: false, error: { code: "too-few-samples" } });
  });
});

describe("calibrateReach", () => {
  const cloud = (cx: number, cy: number, w: number, h: number) =>
    range(200, (i) => ({ x: cx + (((i * 37) % 100) / 100 - 0.5) * w, y: cy + (((i * 61) % 100) / 100 - 0.5) * h }));

  it("uses the 5th to 95th percentile bounds of the comfortable movement", () => {
    const r = calibrateReach(cloud(0.3, 0.5, 0.3, 0.3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.x).toBeGreaterThan(0.15);
    expect(r.value.x + r.value.w).toBeLessThan(0.45);
    expect(r.value.w).toBeGreaterThan(0.24);
  });

  it("rejects a region too small to hold distinct targets", () => {
    expect(calibrateReach(cloud(0.3, 0.5, 0.05, 0.3))).toMatchObject({ ok: false, error: { code: "reach-too-small" } });
  });
});

describe("recommendTempo", () => {
  it("recommends from the slower end of repeatable cycles, rounded down to 5 BPM", () => {
    // Cycle periods ~600..800 ms; p90 ~780 ms -> 76.9 BPM -> 75.
    const periods = range(10, (i) => 600 + i * 20);
    expect(recommendTempo(periods)).toBe(75);
  });

  it("clamps to the beginner range and needs at least five cycles", () => {
    expect(recommendTempo(range(6, () => 200))).toBe(120);
    expect(recommendTempo(range(6, () => 3000))).toBe(40);
    expect(recommendTempo([500, 500])).toBeNull();
  });
});

const profile = (): CalibrationProfile => ({
  profileVersion: PROFILE_VERSION,
  trigger: "pinch",
  createdAt: "2026-10-12T12:00:00.000Z",
  camera: { deviceId: "cam-1", label: "HP HD Camera", width: 1280, height: 720, mirrored: true },
  processing: { longEdgePx: 640, modelSha256: "a".repeat(64) },
  handednessCorrection: "as-reported",
  hands: {
    left: { region: { x: 0.05, y: 0.2, w: 0.35, h: 0.6 }, pinch: { press: 0.45, release: 0.85, closedHigh: 0.2, openLow: 1.2 } },
    right: { region: { x: 0.55, y: 0.2, w: 0.38, h: 0.6 }, pinch: { press: 0.4, release: 0.8, closedHigh: 0.18, openLow: 1.1 } },
  },
  cursorTauMs: 35,
  recommendedTempoBpm: 70,
});

describe("validateCalibrationProfile", () => {
  it("accepts a well-formed profile after a JSON round trip", () => {
    expect(validateCalibrationProfile(JSON.parse(JSON.stringify(profile()))).ok).toBe(true);
  });

  it("rejects regions where the left hand sits right of the right hand", () => {
    const p = profile();
    p.hands.left.region.x = 0.6;
    p.hands.right.region.x = 0.05;
    expect(validateCalibrationProfile(p).ok).toBe(false);
  });

  it("rejects thresholds without hysteresis and unknown versions", () => {
    const a = profile();
    a.hands.right.pinch!.release = 0.3;
    expect(validateCalibrationProfile(a).ok).toBe(false);
    const b = { ...profile(), profileVersion: 99 };
    expect(validateCalibrationProfile(b).ok).toBe(false);
  });
});

describe("checkCompatibility", () => {
  const current = { deviceId: "cam-1", width: 1280, height: 720, mirrored: true, longEdgePx: 640, modelSha256: "a".repeat(64), trigger: "pinch" as const };

  it("accepts the same camera and processing geometry", () => {
    expect(checkCompatibility(profile(), current)).toEqual([]);
  });

  it("invalidates on a different camera, aspect ratio, mirroring, processing size or model", () => {
    expect(checkCompatibility(profile(), { ...current, deviceId: "cam-2" })).toContain("camera");
    expect(checkCompatibility(profile(), { ...current, width: 640, height: 480 })).toContain("aspect");
    expect(checkCompatibility(profile(), { ...current, mirrored: false })).toContain("mirroring");
    expect(checkCompatibility(profile(), { ...current, longEdgePx: 960 })).toContain("processing");
    expect(checkCompatibility(profile(), { ...current, modelSha256: "b".repeat(64) })).toContain("model");
  });

  it("allows a different resolution with the same aspect ratio", () => {
    expect(checkCompatibility(profile(), { ...current, width: 1920, height: 1080 })).toEqual([]);
  });
});

describe("profile version 2 and the play gesture", () => {
  const flick = { openLevel: 1.8, releaseLevel: 1.6, dropMin: 0.35, rateMin: 5, flexLevel: 1.25, openLow: 1.95 };
  const flickProfile = (): CalibrationProfile => ({
    ...profile(),
    trigger: "flick",
    hands: {
      left: { region: profile().hands.left.region, flick: { ...flick } },
      right: { region: profile().hands.right.region, flick: { ...flick } },
    },
  });

  it("accepts a flick profile with flick thresholds", () => {
    expect(validateCalibrationProfile(JSON.parse(JSON.stringify(flickProfile()))).ok).toBe(true);
  });

  it("rejects a flick profile without flick thresholds, or with disordered levels", () => {
    const missing = { ...flickProfile(), hands: profile().hands };
    expect(validateCalibrationProfile(missing).ok).toBe(false);
    const disordered = flickProfile();
    disordered.hands.left.flick!.releaseLevel = 1.9;
    expect(validateCalibrationProfile(disordered).ok).toBe(false);
  });

  it("rejects a version 1 profile so the owner recalibrates", () => {
    const { trigger: _t, ...v1 } = { ...profile(), profileVersion: 1 };
    void _t;
    expect(validateCalibrationProfile(v1).ok).toBe(false);
  });

  it("needs recalibration when the chosen play gesture differs from the profile's", () => {
    const current = { deviceId: "cam-1", width: 1280, height: 720, mirrored: true, longEdgePx: 640, modelSha256: "a".repeat(64), trigger: "flick" as const };
    expect(checkCompatibility(profile(), current)).toEqual(["trigger"]);
    expect(checkCompatibility(flickProfile(), current)).toEqual([]);
  });
});

