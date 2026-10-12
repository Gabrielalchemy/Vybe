import { beforeEach, describe, expect, it } from "vitest";
import { CHORD_LAYOUT, MELODY_LAYOUT, type LayoutTarget } from "../../../../src/domain/layout";
import { GestureInterpreter, LOSS_TIMEOUT_MS, type TrackingEvent } from "../../../../src/domain/tracking/gestureInterpreter";
import type { CalibrationProfile } from "../../../../src/domain/tracking/calibration";
import type { Detection } from "../../../../src/domain/tracking/identity";
import { handAtPalm } from "../../../fixtures/hands";

const PROFILE: CalibrationProfile = {
  profileVersion: 1,
  createdAt: "2026-10-12T12:00:00.000Z",
  camera: { deviceId: "cam", label: "cam", width: 640, height: 360, mirrored: true },
  processing: { longEdgePx: 640, modelSha256: "a".repeat(64) },
  handednessCorrection: "as-reported",
  hands: {
    left: { region: { x: 0.05, y: 0.1, w: 0.4, h: 0.8 }, pinch: { press: 0.4, release: 0.8, closedHigh: 0.1, openLow: 0.9 } },
    right: { region: { x: 0.55, y: 0.1, w: 0.4, h: 0.8 }, pinch: { press: 0.4, release: 0.8, closedHigh: 0.1, openLow: 0.9 } },
  },
  cursorTauMs: 35,
  recommendedTempoBpm: null,
};
const IMAGE = { width: 640, height: 360 };
const LANE_PX = { left: { width: 500, height: 400 }, right: { width: 750, height: 400 } };

type HandPose = { target: string; pinch: number; dx?: number } | { local: { x: number; y: number }; pinch: number };

let interp: GestureInterpreter;
let t = 0;

function centre(layoutTarget: LayoutTarget) {
  return { x: layoutTarget.x + layoutTarget.w / 2, y: layoutTarget.y + layoutTarget.h / 2 };
}

/** Lane-local point -> unmirrored image coordinates through the calibrated region and mirroring. */
function toImage(hand: "left" | "right", local: { x: number; y: number }) {
  const r = PROFILE.hands[hand].region;
  const display = { x: r.x + local.x * r.w, y: r.y + local.y * r.h };
  return { x: 1 - display.x, y: display.y };
}

function detection(hand: "left" | "right", pose: HandPose): Detection {
  let local: { x: number; y: number };
  if ("target" in pose) {
    const layout = hand === "left" ? CHORD_LAYOUT : MELODY_LAYOUT;
    const tgt = layout.targets.find((x) => x.id === pose.target);
    if (!tgt) throw new Error(pose.target);
    local = centre(tgt);
    local.x += pose.dx ?? 0;
  } else {
    local = pose.local;
  }
  const img = toImage(hand, local);
  return { landmarks: handAtPalm(img.x, img.y, pose.pinch), label: hand === "left" ? "Left" : "Right" };
}

function frame(poses: { left?: HandPose; right?: HandPose }, stepMs = 33): TrackingEvent[] {
  t += stepMs;
  const detections: Detection[] = [];
  if (poses.left) detections.push(detection("left", poses.left));
  if (poses.right) detections.push(detection("right", poses.right));
  return interp.process({ tMs: t, detections, imageSize: IMAGE }).events;
}

const OPEN = 0;
const CLOSED = 1;
const kinds = (events: TrackingEvent[]) => events.map((e) => `${e.hand}:${e.type}${e.type === "press" ? `:${e.targetId}` : ""}`);

beforeEach(() => {
  t = 0;
  interp = new GestureInterpreter({ profile: PROFILE, lanePx: LANE_PX });
});

function armRight(target = "melody-pc-4") {
  frame({ right: { target, pinch: OPEN } });
  return frame({ right: { target, pinch: OPEN } });
}

describe("arming and hover", () => {
  it("arms only after confirmed neutral-open evidence, and hover alone is silent", () => {
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: OPEN } }))).toEqual([]);
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: OPEN } }))).toEqual(["right:arm"]);
    // The smoothed cursor takes a few frames to settle after a jump of three keys.
    const out = [1, 2, 3].flatMap(() => frame({ right: { target: "melody-pc-7", pinch: OPEN } }));
    expect(out).toEqual([]);
    expect(interp.view().right.hoverTargetId).toBe("melody-pc-7");
  });

  it("maps the anatomical left hand to the chord lane through mirroring", () => {
    frame({ left: { target: "chord-slot-5", pinch: OPEN } });
    frame({ left: { target: "chord-slot-5", pinch: OPEN } });
    expect(interp.view().left.hoverTargetId).toBe("chord-slot-5");
  });
});

describe("press and release", () => {
  it("a confirmed pinch emits exactly one press for the hovered target", () => {
    armRight();
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: CLOSED } }))).toEqual([]);
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: CLOSED } }))).toEqual(["right:press:melody-pc-4"]);
    for (let i = 0; i < 20; i++) expect(frame({ right: { target: "melody-pc-4", pinch: CLOSED } })).toEqual([]);
  });

  it("moving while held never retriggers or changes the latched target", () => {
    armRight();
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    for (const target of ["melody-pc-5", "melody-pc-7", "melody-pc-9"]) {
      expect(frame({ right: { target, pinch: CLOSED } })).toEqual([]);
    }
    expect(interp.view().right).toMatchObject({ state: "held", heldTargetId: "melody-pc-4" });
    frame({ right: { target: "melody-pc-9", pinch: OPEN } });
    expect(kinds(frame({ right: { target: "melody-pc-9", pinch: OPEN } }))).toEqual(["right:release"]);
  });

  it("a single-frame tremor dip does not press", () => {
    armRight();
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: OPEN } }))).toEqual([]);
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: OPEN } }))).toEqual([]);
  });

  it("partial closure inside the hysteresis band neither presses nor releases", () => {
    armRight();
    for (let i = 0; i < 10; i++) expect(frame({ right: { target: "melody-pc-4", pinch: 0.5 } })).toEqual([]);
  });

  it("closing over a gap presses with no target (the router keeps it silent)", () => {
    frame({ right: { local: { x: 3 / 7, y: 0.2 }, pinch: OPEN } });
    frame({ right: { local: { x: 3 / 7, y: 0.2 }, pinch: OPEN } });
    frame({ right: { local: { x: 3 / 7, y: 0.2 }, pinch: CLOSED } });
    expect(kinds(frame({ right: { local: { x: 3 / 7, y: 0.2 }, pinch: CLOSED } }))).toEqual(["right:press:null"]);
  });

  it("hands are independent", () => {
    frame({ left: { target: "chord-slot-0", pinch: OPEN }, right: { target: "melody-pc-0", pinch: OPEN } });
    frame({ left: { target: "chord-slot-0", pinch: OPEN }, right: { target: "melody-pc-0", pinch: OPEN } });
    frame({ left: { target: "chord-slot-0", pinch: CLOSED }, right: { target: "melody-pc-0", pinch: OPEN } });
    expect(kinds(frame({ left: { target: "chord-slot-0", pinch: CLOSED }, right: { target: "melody-pc-0", pinch: OPEN } }))).toEqual([
      "left:press:chord-slot-0",
    ]);
  });
});

describe("rest strip", () => {
  it("entering the rest strip rests the hand; leaving it open re-arms without sound", () => {
    armRight();
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    const moving = [1, 2, 3].flatMap(() => frame({ right: { target: "rest", pinch: CLOSED } }));
    expect(kinds(moving)).toEqual(["right:rest"]);
    expect(interp.view().right.state).toBe("resting");
    expect(frame({ right: { target: "rest", pinch: OPEN } })).toEqual([]);
    expect(frame({ right: { target: "rest", pinch: OPEN } })).toEqual([]);
    const leaving = [1, 2, 3].flatMap(() => frame({ right: { target: "melody-pc-2", pinch: OPEN } }));
    expect(kinds(leaving)).toEqual(["right:arm"]);
  });

  it("a hand leaving rest while still closed must open before it can press", () => {
    armRight();
    frame({ right: { target: "rest", pinch: OPEN } });
    frame({ right: { target: "rest", pinch: CLOSED } });
    frame({ right: { target: "rest", pinch: CLOSED } });
    expect(kinds(frame({ right: { target: "melody-pc-2", pinch: CLOSED } }))).toEqual([]);
    expect(kinds(frame({ right: { target: "melody-pc-2", pinch: CLOSED } }))).toEqual([]);
    frame({ right: { target: "melody-pc-2", pinch: OPEN } });
    expect(kinds(frame({ right: { target: "melody-pc-2", pinch: OPEN } }))).toEqual(["right:arm"]);
  });
});

describe("loss and recovery", () => {
  it(`declares a hand lost ${LOSS_TIMEOUT_MS} ms after its last valid observation`, () => {
    armRight();
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    const last = t;
    expect(interp.tick(last + LOSS_TIMEOUT_MS - 1)).toEqual([]);
    expect(kinds(interp.tick(last + LOSS_TIMEOUT_MS))).toEqual(["right:lost"]);
    expect(interp.tick(last + LOSS_TIMEOUT_MS + 50)).toEqual([]);
  });

  it("a short gap keeps the held note but cannot start a new one", () => {
    armRight();
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    frame({ right: { target: "melody-pc-4", pinch: CLOSED } });
    expect(frame({}, 60)).toEqual([]);
    expect(interp.view().right.state).toBe("held");
    frame({ right: { target: "melody-pc-4", pinch: OPEN } }, 40);
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: OPEN } }))).toEqual(["right:release"]);
  });

  it("a closed hand reacquired after loss is not a new press", () => {
    armRight();
    t += LOSS_TIMEOUT_MS + 10;
    expect(kinds(interp.tick(t))).toEqual(["right:lost"]);
    for (let i = 0; i < 5; i++) expect(frame({ right: { target: "melody-pc-4", pinch: CLOSED } })).toEqual([]);
    expect(interp.view().right.state).toBe("disarmed");
    frame({ right: { target: "melody-pc-4", pinch: OPEN } });
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: OPEN } }))).toEqual(["right:arm"]);
  });

  it("an ambiguous identity frame disarms both armed hands immediately", () => {
    frame({ left: { target: "chord-slot-0", pinch: OPEN }, right: { target: "melody-pc-0", pinch: OPEN } });
    frame({ left: { target: "chord-slot-0", pinch: OPEN }, right: { target: "melody-pc-0", pinch: OPEN } });
    t += 33;
    const same = detection("right", { target: "melody-pc-0", pinch: OPEN });
    const out = interp.process({ tMs: t, detections: [same, { ...same, label: "Right" }], imageSize: IMAGE }).events;
    expect(kinds(out).sort()).toEqual(["left:lost", "right:lost"]);
    expect(interp.view().right.status).toBe("ambiguous");
  });

  it("a frame with a degenerate hand does not renew the hand", () => {
    armRight();
    const last = t;
    t += 33;
    const tiny = { landmarks: handAtPalm(0.3, 0.5, 0, 0.0004), label: "Right" as const };
    expect(interp.process({ tMs: t, detections: [tiny], imageSize: IMAGE }).events).toEqual([]);
    expect(kinds(interp.tick(last + LOSS_TIMEOUT_MS))).toEqual(["right:lost"]);
  });

  it("reset forgets everything and requires neutral recovery", () => {
    armRight();
    interp.reset();
    expect(interp.view().right.state).toBe("disarmed");
    expect(kinds(frame({ right: { target: "melody-pc-4", pinch: CLOSED } }))).toEqual([]);
  });
});

describe("observations for audio leases", () => {
  it("reports only hands with a valid measurement in this frame", () => {
    t += 33;
    const ok = interp.process({ tMs: t, detections: [detection("right", { target: "melody-pc-0", pinch: OPEN })], imageSize: IMAGE });
    expect(ok.observed).toEqual(["right"]);
    t += 33;
    const tiny = { landmarks: handAtPalm(0.3, 0.5, 0, 0.0004), label: "Right" as const };
    expect(interp.process({ tMs: t, detections: [tiny], imageSize: IMAGE }).observed).toEqual([]);
  });

  it("reports nothing for an ambiguous frame", () => {
    t += 33;
    const same = detection("right", { target: "melody-pc-0", pinch: OPEN });
    expect(interp.process({ tMs: t, detections: [same, { ...same }], imageSize: IMAGE }).observed).toEqual([]);
  });
});

