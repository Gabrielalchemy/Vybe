import { beforeEach, describe, expect, it } from "vitest";
import { CalibrationSession, PHASE_MS, REACH_MS } from "../../../../src/domain/tracking/calibrationSession";
import type { Detection } from "../../../../src/domain/tracking/identity";
import { handAtPalm } from "../../../fixtures/hands";

const IMAGE = { width: 640, height: 360 };
let s: CalibrationSession;
let t = 0;

/** Unmirrored image position for a display-space point (camera view is mirrored). */
const img = (displayX: number, y: number) => ({ x: 1 - displayX, y });

/** `swapLabels` simulates an SDK whose handedness labels are opposite to anatomy. */
function hand(role: "left" | "right", displayX: number, y: number, pinch = 0, swapLabels = false): Detection {
  const p = img(displayX, y);
  const anatomical = role === "left" ? "Left" : "Right";
  const label = swapLabels ? (anatomical === "Left" ? "Right" : "Left") : anatomical;
  return { landmarks: handAtPalm(p.x, p.y, pinch), label };
}

function feed(detections: Detection[], stepMs = 33) {
  t += stepMs;
  s.feed({ tMs: t, detections, imageSize: IMAGE });
}

function runFor(ms: number, make: (i: number) => Detection[]) {
  const end = t + ms;
  let i = 0;
  while (t < end) feed(make(i++));
}

// Comfortable reach clouds on each side of the mirrored view.
const leftReach = (i: number) => hand("left", 0.12 + ((i * 7) % 30) / 100, 0.15 + ((i * 11) % 70) / 100);
const rightReach = (i: number) => hand("right", 0.58 + ((i * 7) % 30) / 100, 0.15 + ((i * 11) % 70) / 100);

function identifyBoth(swap = false) {
  runFor(1200, () => [hand("left", 0.3, 0.5, 0, swap)]);
  runFor(1200, () => [hand("right", 0.7, 0.5, 0, swap)]);
}

function promptedPinches(role: "left" | "right", x: number) {
  for (let cycle = 0; cycle < 5; cycle++) {
    runFor(PHASE_MS, () => [hand(role, x, 0.5, 0)]);
    runFor(PHASE_MS, () => [hand(role, x, 0.5, 1)]);
  }
}

beforeEach(() => {
  t = 0;
  s = new CalibrationSession({
    camera: { deviceId: "cam", label: "HP HD Camera", width: 1280, height: 720, mirrored: true },
    processing: { longEdgePx: 640, modelSha256: "c".repeat(64) },
    nowIso: () => "2026-10-12T12:00:00.000Z",
    startMs: 0,
  });
});

describe("CalibrationSession", () => {
  it("walks identify -> reach -> pinch -> pace and produces a valid profile", () => {
    expect(s.step()).toMatchObject({ kind: "identify", hand: "left" });
    identifyBoth();
    expect(s.step()).toMatchObject({ kind: "reach", hand: "left" });
    runFor(REACH_MS + 100, (i) => [leftReach(i)]);
    expect(s.step()).toMatchObject({ kind: "reach", hand: "right" });
    runFor(REACH_MS + 100, (i) => [rightReach(i)]);
    expect(s.step()).toMatchObject({ kind: "pinch", hand: "left" });
    promptedPinches("left", 0.3);
    expect(s.step()).toMatchObject({ kind: "pinch", hand: "right" });
    promptedPinches("right", 0.7);
    expect(s.step()).toMatchObject({ kind: "pace" });
    // Self-paced pinching about every 700 ms.
    for (let k = 0; k < 9; k++) {
      runFor(350, () => [hand("right", 0.7, 0.5, 0)]);
      runFor(350, () => [hand("right", 0.7, 0.5, 1)]);
    }
    const step = s.step();
    expect(step.kind).toBe("done");
    if (step.kind !== "done") return;
    const p = step.profile;
    expect(p.handednessCorrection).toBe("as-reported");
    expect(p.hands.left.region.x + p.hands.left.region.w / 2).toBeLessThan(p.hands.right.region.x + p.hands.right.region.w / 2);
    expect(p.hands.left.pinch.press).toBeLessThan(p.hands.left.pinch.release);
    // ~730 ms cycles (frame-quantized) -> about 80 BPM from the slower end, rounded down to 5.
    expect(p.recommendedTempoBpm).toBeGreaterThanOrEqual(75);
    expect(p.recommendedTempoBpm).toBeLessThanOrEqual(85);
    expect(p.camera).toMatchObject({ deviceId: "cam", mirrored: true });
  });

  it("records a swapped handedness correction when the SDK labels are opposite", () => {
    identifyBoth(true);
    expect(s.step()).toMatchObject({ kind: "reach", hand: "left" });
    expect(s.handednessCorrection()).toBe("swapped");
  });

  it("fails identification when the same hand is raised twice, and can retry", () => {
    runFor(1200, () => [hand("left", 0.3, 0.5)]);
    runFor(1200, () => [hand("left", 0.3, 0.5)]);
    expect(s.step()).toMatchObject({ kind: "failed", error: { code: "identify-inconsistent" } });
    s.retry();
    expect(s.step()).toMatchObject({ kind: "identify", hand: "left" });
  });

  it("waits during identification while both hands are visible", () => {
    runFor(2000, () => [hand("left", 0.3, 0.5), hand("right", 0.7, 0.5)]);
    expect(s.step()).toMatchObject({ kind: "identify", hand: "left" });
    expect(s.progress()).toBe(0);
  });

  it("rejects pinches that cannot be told apart instead of saving a profile", () => {
    identifyBoth();
    runFor(REACH_MS + 100, (i) => [leftReach(i)]);
    runFor(REACH_MS + 100, (i) => [rightReach(i)]);
    // The owner never really changes the pinch: open and closed examples coincide.
    for (let cycle = 0; cycle < 5; cycle++) {
      runFor(PHASE_MS, (i) => [hand("left", 0.3, 0.5, 0.5 + ((i % 3) - 1) * 0.02)]);
      runFor(PHASE_MS, (i) => [hand("left", 0.3, 0.5, 0.5 + ((i % 3) - 1) * 0.02)]);
    }
    expect(s.step()).toMatchObject({ kind: "failed", error: { code: expect.stringMatching(/pinch-/) } });
    s.retry();
    expect(s.step()).toMatchObject({ kind: "pinch", hand: "left" });
  });

  it("rejects reach regions where the hands would cross", () => {
    identifyBoth();
    runFor(REACH_MS + 100, (i) => [hand("left", 0.6 + ((i * 7) % 30) / 100, 0.15 + ((i * 11) % 70) / 100)]);
    runFor(REACH_MS + 100, (i) => [hand("right", 0.1 + ((i * 7) % 30) / 100, 0.15 + ((i * 11) % 70) / 100)]);
    expect(s.step()).toMatchObject({ kind: "failed", error: { code: "regions-crossed" } });
    s.retry();
    expect(s.step()).toMatchObject({ kind: "reach", hand: "left" });
  });

  it("allows skipping the pace step, leaving no tempo recommendation", () => {
    identifyBoth();
    runFor(REACH_MS + 100, (i) => [leftReach(i)]);
    runFor(REACH_MS + 100, (i) => [rightReach(i)]);
    promptedPinches("left", 0.3);
    promptedPinches("right", 0.7);
    s.skipPace();
    const step = s.step();
    expect(step.kind === "done" && step.profile.recommendedTempoBpm).toBeNull();
  });
});
