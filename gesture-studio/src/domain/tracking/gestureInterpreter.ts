import type { HandRole } from "../events";
import { CHORD_LAYOUT, MELODY_LAYOUT, hoverTarget, type LayoutDefinition, type SizePx } from "../layout";
import type { CalibrationProfile } from "./calibration";
import { CursorFilter } from "./cursorFilter";
import { FlickDetector } from "./flickDetector";
import { fingerExtension, palmCenter, pinchRatio, toDisplay, type ImageSize, type Landmark, type Point2 } from "./geometry";
import { IdentityTracker, type Detection } from "./identity";
import { PinchDetector } from "./pinchDetector";
import type { TriggerDetector, TriggerState } from "./triggerDetector";

/** Flick sensitivity: scales the calibrated flick speed and depth thresholds. */
export type FlickSensitivity = "less" | "normal" | "more";
const SENSITIVITY_SCALE: Readonly<Record<FlickSensitivity, number>> = { less: 1.2, normal: 1, more: 0.8 };

/**
 * A hand with no valid observation for this long is declared lost. The audio
 * lease (Phase 4) independently silences its live voices by 200 ms even if this
 * main-thread path is delayed.
 */
export const LOSS_TIMEOUT_MS = 150;

export type TrackingEvent =
  | { type: "arm"; hand: HandRole; tMs: number }
  | { type: "press"; hand: HandRole; targetId: string | null; tMs: number }
  | { type: "release" | "rest" | "lost"; hand: HandRole; tMs: number };

export type HandState = "disarmed" | "open" | "held" | "resting";
export type HandStatus = "not-visible" | "tracking" | "ambiguous";

export interface HandView {
  state: HandState;
  status: HandStatus;
  /** Smoothed palm cursor in lane-local coordinates (may lie outside 0..1), null when not visible. */
  cursor: Point2 | null;
  hoverTargetId: string | null;
  heldTargetId: string | null;
  /** State of the play-gesture detector (pinch or flick). */
  trigger: TriggerState;
}

export interface TrackedFrameInput {
  /** Main-thread capture timestamp (performance.now()) of the frame. */
  tMs: number;
  detections: readonly Detection[];
  imageSize: ImageSize;
}

interface HandRuntime {
  state: HandState;
  status: HandStatus;
  trigger: TriggerDetector;
  /** Recent hover targets by frame time, so a flick can latch the pad from its first frame. */
  hoverHistory: { tMs: number; id: string | null }[];
  filter: CursorFilter;
  cursor: Point2 | null;
  hoverTargetId: string | null;
  heldTargetId: string | null;
  lastValidMs: number | null;
}

const LAYOUT: Readonly<Record<HandRole, LayoutDefinition>> = { left: CHORD_LAYOUT, right: MELODY_LAYOUT };
const ROLES = ["left", "right"] as const;

/**
 * Pure interpretation of tracked frames into explicit hand events, following
 * the hand state table in architecture.md §5. Selection is silent; a confirmed
 * close presses once; movement while held changes nothing; recovery after
 * loss, rest, ambiguity or reset needs neutral-open evidence.
 */
export class GestureInterpreter {
  private readonly profile: CalibrationProfile;
  private readonly lanePx: Record<HandRole, SizePx>;
  private readonly identity: IdentityTracker;
  private readonly hands: Record<HandRole, HandRuntime>;
  private readonly sensitivity: FlickSensitivity;

  constructor(opts: { profile: CalibrationProfile; lanePx: Record<HandRole, SizePx>; sensitivity?: FlickSensitivity }) {
    this.profile = opts.profile;
    this.sensitivity = opts.sensitivity ?? "normal";
    this.lanePx = { ...opts.lanePx };
    this.identity = new IdentityTracker(opts.profile.handednessCorrection);
    this.hands = { left: this.fresh("left"), right: this.fresh("right") };
  }

  /** Lane pixel size changed (resize): hover hysteresis uses it. Callers disarm on reflow. */
  setLaneSize(hand: HandRole, size: SizePx): void {
    this.lanePx[hand] = { ...size };
  }

  view(): Record<HandRole, HandView> {
    const v = (h: HandRuntime): HandView => ({
      state: h.state,
      status: h.status,
      cursor: h.cursor && { ...h.cursor },
      hoverTargetId: h.hoverTargetId,
      heldTargetId: h.heldTargetId,
      trigger: h.trigger.state(),
    });
    return { left: v(this.hands.left), right: v(this.hands.right) };
  }

  /**
   * `observed` lists hands with a valid, unambiguous measurement in this frame;
   * only those may renew an audio lease.
   */
  process(frame: TrackedFrameInput): { events: TrackingEvent[]; observed: HandRole[] } {
    const events: TrackingEvent[] = [];
    const observed: HandRole[] = [];
    const assignment = this.identity.assign(frame.detections, frame.tMs);

    if (assignment.ambiguous) {
      for (const role of ROLES) {
        const h = this.hands[role];
        if (h.state === "open" || h.state === "held") events.push({ type: "lost", hand: role, tMs: frame.tMs });
        this.forget(role, h.state === "resting" ? "resting" : "disarmed");
        h.status = "ambiguous";
      }
      return { events, observed };
    }

    for (const role of ROLES) {
      const d = assignment[role];
      if (d) {
        if (this.observe(role, d, frame, events)) observed.push(role);
      } else {
        this.hands[role].trigger.invalidFrame();
        this.hands[role].status = "not-visible";
      }
    }
    events.push(...this.tick(frame.tMs));
    return { events, observed };
  }

  /** Watchdog: call regularly (also when frames stop) to expire hands without valid observations. */
  tick(nowMs: number): TrackingEvent[] {
    const events: TrackingEvent[] = [];
    for (const role of ROLES) {
      const h = this.hands[role];
      if (h.lastValidMs === null || nowMs - h.lastValidMs < LOSS_TIMEOUT_MS) continue;
      if (h.state === "open" || h.state === "held") events.push({ type: "lost", hand: role, tMs: nowMs });
      this.forget(role, h.state === "resting" ? "resting" : "disarmed");
      h.lastValidMs = null;
    }
    return events;
  }

  /** Require neutral-open evidence again for one hand, keeping its loss timer. */
  disarm(role: HandRole): void {
    const lastValidMs = this.hands[role].lastValidMs;
    this.forget(role, "disarmed");
    this.hands[role].lastValidMs = lastValidMs;
  }

  /** Configuration change, camera restart or resize: everything needs neutral recovery. */
  reset(): void {
    this.identity.reset();
    for (const role of ROLES) {
      this.forget(role, "disarmed");
      this.hands[role].lastValidMs = null;
    }
  }

  private detector(role: HandRole): TriggerDetector {
    const hand = this.profile.hands[role];
    if (this.profile.trigger === "flick") {
      if (!hand.flick) throw new Error(`The ${role} hand has no flick calibration.`);
      const k = SENSITIVITY_SCALE[this.sensitivity];
      return new FlickDetector({ ...hand.flick, dropMin: hand.flick.dropMin * k, rateMin: hand.flick.rateMin * k });
    }
    if (!hand.pinch) throw new Error(`The ${role} hand has no pinch calibration.`);
    return new PinchDetector(hand.pinch);
  }

  private signal(landmarks: readonly Landmark[], size: ImageSize) {
    return this.profile.trigger === "flick" ? fingerExtension(landmarks, size) : pinchRatio(landmarks, size);
  }

  private fresh(role: HandRole): HandRuntime {
    return {
      state: "disarmed",
      status: "not-visible",
      trigger: this.detector(role),
      hoverHistory: [],
      filter: new CursorFilter(this.profile.cursorTauMs),
      cursor: null,
      hoverTargetId: null,
      heldTargetId: null,
      lastValidMs: null,
    };
  }

  private forget(role: HandRole, state: HandState): void {
    const h = this.hands[role];
    h.state = state;
    h.status = "not-visible";
    h.trigger.reset();
    h.hoverHistory = [];
    h.filter.reset();
    h.cursor = null;
    h.hoverTargetId = null;
    h.heldTargetId = null;
  }

  /** Returns true when the observation was valid. */
  private observe(role: HandRole, d: Detection, frame: TrackedFrameInput, events: TrackingEvent[]): boolean {
    const h = this.hands[role];
    const ratio = this.signal(d.landmarks, frame.imageSize);
    if (!ratio.ok) {
      // Present but unmeasurable: neither renews the hand nor advances the gesture.
      h.trigger.invalidFrame();
      h.status = "not-visible";
      return false;
    }
    const region = this.profile.hands[role].region;
    const display = toDisplay(palmCenter(d.landmarks), this.profile.camera.mirrored);
    const local = h.filter.update({ x: (display.x - region.x) / region.w, y: (display.y - region.y) / region.h }, frame.tMs);
    const hover = hoverTarget(LAYOUT[role], local, h.hoverTargetId, this.lanePx[role]);
    h.cursor = local;
    h.hoverTargetId = hover?.id ?? null;
    h.hoverHistory = [...h.hoverHistory, { tMs: frame.tMs, id: h.hoverTargetId }].slice(-4);
    h.status = "tracking";
    h.lastValidMs = frame.tMs;

    const transition = h.trigger.update(ratio.value, frame.tMs);
    const inRest = hover?.kind === "rest";
    const tMs = frame.tMs;

    switch (h.state) {
      case "open":
        if (inRest) {
          events.push({ type: "rest", hand: role, tMs });
          h.state = "resting";
        } else if (transition === "closed") {
          // A flick latches the pad under the hand when the stroke began.
          const onset = h.trigger.onsetMs();
          const latched = onset === null ? (hover?.id ?? null) : (h.hoverHistory.find((x) => x.tMs === onset)?.id ?? hover?.id ?? null);
          events.push({ type: "press", hand: role, targetId: latched, tMs });
          h.state = "held";
          h.heldTargetId = latched;
        }
        break;
      case "held":
        if (inRest) {
          events.push({ type: "rest", hand: role, tMs });
          h.state = "resting";
          h.heldTargetId = null;
        } else if (transition === "opened") {
          events.push({ type: "release", hand: role, tMs });
          h.state = "open";
          h.heldTargetId = null;
        }
        break;
      case "disarmed":
      case "resting":
        if (!inRest && h.trigger.state() === "open") {
          events.push({ type: "arm", hand: role, tMs });
          h.state = "open";
        }
        break;
    }
    return true;
  }
}
