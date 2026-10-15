import { beforeEach, describe, expect, it } from "vitest";
import { MELODY_LAYOUT } from "../../../../src/domain/layout";
import { GestureInterpreter, type TrackingEvent } from "../../../../src/domain/tracking/gestureInterpreter";
import type { CalibrationProfile } from "../../../../src/domain/tracking/calibration";
import { fingerExtension } from "../../../../src/domain/tracking/geometry";
import { handAtPalm } from "../../../fixtures/hands";

const IMAGE = { width: 640, height: 360 };
const LANE_PX = { left: { width: 500, height: 400 }, right: { width: 750, height: 400 } };

// Thresholds derived from the synthetic hand itself: open (flex 0) versus folded (flex 1).
const eOpen = (() => { const r = fingerExtension(handAtPalm(0.3, 0.5, 0, 0.08, 0), IMAGE); if (!r.ok) throw new Error(); return r.value; })();
const eFold = (() => { const r = fingerExtension(handAtPalm(0.3, 0.5, 0, 0.08, 1), IMAGE); if (!r.ok) throw new Error(); return r.value; })();
const range = eOpen - eFold;
const flick = {
  openLow: eOpen,
  flexLevel: eFold,
  openLevel: eFold + 0.8 * range,
  releaseLevel: eFold + 0.5 * range,
  dropMin: 0.4 * range,
  rateMin: (0.25 * range) / 0.033, // a quarter of the range in one 30 fps frame
};
const region = { x: 0.55, y: 0.1, w: 0.4, h: 0.8 };
const PROFILE: CalibrationProfile = {
  profileVersion: 2,
  trigger: "flick",
  createdAt: "2026-10-15T12:00:00.000Z",
  camera: { deviceId: "cam", label: "cam", width: 640, height: 360, mirrored: true },
  processing: { longEdgePx: 640, modelSha256: "a".repeat(64) },
  handednessCorrection: "as-reported",
  hands: { left: { region: { x: 0.05, y: 0.1, w: 0.4, h: 0.8 }, flick: { ...flick } }, right: { region, flick: { ...flick } } },
  cursorTauMs: 35,
  recommendedTempoBpm: null,
};

let interp: GestureInterpreter;
let t = 0;

function at(targetId: string) {
  const tgt = MELODY_LAYOUT.targets.find((x) => x.id === targetId)!;
  return { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
}
function frame(local: { x: number; y: number }, flex: number): TrackingEvent[] {
  t += 33;
  const display = { x: region.x + local.x * region.w, y: region.y + local.y * region.h };
  const landmarks = handAtPalm(1 - display.x, display.y, 0, 0.08, flex);
  return interp.process({ tMs: t, detections: [{ landmarks, label: "Right" }], imageSize: IMAGE }).events;
}
const kinds = (ev: TrackingEvent[]) => ev.map((e) => `${e.type}${e.type === "press" ? `:${e.targetId}` : ""}`);
const settleOpen = (target: string) => [1, 2, 3, 4].flatMap(() => frame(at(target), 0));

beforeEach(() => {
  t = 0;
  interp = new GestureInterpreter({ profile: PROFILE, lanePx: LANE_PX });
});

describe("flick trigger", () => {
  it("arms on an open hand and presses once during a quick flick", () => {
    expect(kinds(settleOpen("melody-pc-4"))).toEqual(["arm"]);
    expect(kinds(frame(at("melody-pc-4"), 0.4))).toEqual([]);
    expect(kinds(frame(at("melody-pc-4"), 0.8))).toEqual(["press:melody-pc-4"]);
    expect(kinds([0.9, 1, 1, 1].flatMap((f) => frame(at("melody-pc-4"), f)))).toEqual([]);
  });

  it("keeps the pad hovered at the start of the stroke even if the palm drifts mid-flick", () => {
    settleOpen("melody-pc-4");
    frame(at("melody-pc-4"), 0.4);
    const out = frame(at("melody-pc-11"), 0.8);
    expect(kinds(out)).toEqual(["press:melody-pc-4"]);
  });

  it("moving the open hand between rows and keys never presses", () => {
    settleOpen("melody-pc-1");
    const moves = ["melody-pc-1", "melody-pc-0", "melody-pc-2", "melody-pc-3", "melody-pc-4", "melody-pc-9", "melody-pc-8", "melody-pc-11"];
    expect(moves.flatMap((m) => [frame(at(m), 0), frame(at(m), 0)].flat())).toEqual([]);
  });

  it("a slow fold never presses", () => {
    settleOpen("melody-pc-4");
    const slow = Array.from({ length: 20 }, (_, i) => (i + 1) / 20);
    expect(slow.flatMap((f) => frame(at("melody-pc-4"), f))).toEqual([]);
  });

  it("lifting the fingers releases; a new flick then presses again", () => {
    settleOpen("melody-pc-4");
    frame(at("melody-pc-4"), 0.4);
    frame(at("melody-pc-4"), 0.8);
    frame(at("melody-pc-4"), 1);
    expect(kinds([0.2, 0].flatMap((f) => frame(at("melody-pc-4"), f)))).toEqual(["release"]);
    frame(at("melody-pc-4"), 0);
    frame(at("melody-pc-4"), 0.4);
    expect(kinds(frame(at("melody-pc-4"), 0.8))).toEqual(["press:melody-pc-4"]);
  });

  it("sensitivity scales what counts as a flick", () => {
    const small = (s: "less" | "normal" | "more") => {
      t = 0;
      interp = new GestureInterpreter({ profile: PROFILE, lanePx: LANE_PX, sensitivity: s });
      settleOpen("melody-pc-4");
      return kinds([0.22, 0.44, 0.5].flatMap((f) => frame(at("melody-pc-4"), f)));
    };
    expect(small("normal")).toEqual([]);
    expect(small("more")).toEqual(["press:melody-pc-4"]);
  });
});
