import type { HandRole } from "../events";
import { CHORD_LAYOUT, MELODY_LAYOUT, hoverTarget, type LayoutDefinition, type SizePx } from "../layout";
import type { CalibrationProfile } from "./calibration";
import { CursorFilter } from "./cursorFilter";
import { palmCenter, pinchRatio, toDisplay, type ImageSize, type Point2 } from "./geometry";
import { IdentityTracker, type Detection } from "./identity";
import { PinchDetector, type PinchState } from "./pinchDetector";

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
  pinch: PinchState;
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
  pinch: PinchDetector;
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

  constructor(opts: { profile: CalibrationProfile; lanePx: Record<HandRole, SizePx> }) {
    this.profile = opts.profile;
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
      pinch: h.pinch.state(),
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
        this.hands[role].pinch.invalidFrame();
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

  private fresh(_role: HandRole): HandRuntime {
    return {
      state: "disarmed",
      status: "not-visible",
      pinch: new PinchDetector(this.profile.hands[_role].pinch),
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
    h.pinch.reset();
    h.filter.reset();
    h.cursor = null;
    h.hoverTargetId = null;
    h.heldTargetId = null;
  }

  /** Returns true when the observation was valid. */
  private observe(role: HandRole, d: Detection, frame: TrackedFrameInput, events: TrackingEvent[]): boolean {
    const h = this.hands[role];
    const ratio = pinchRatio(d.landmarks, frame.imageSize);
    if (!ratio.ok) {
      // Present but unmeasurable: neither renews the hand nor advances a pinch.
      h.pinch.invalidFrame();
      h.status = "not-visible";
      return false;
    }
    const region = this.profile.hands[role].region;
    const display = toDisplay(palmCenter(d.landmarks), this.profile.camera.mirrored);
    const local = h.filter.update({ x: (display.x - region.x) / region.w, y: (display.y - region.y) / region.h }, frame.tMs);
    const hover = hoverTarget(LAYOUT[role], local, h.hoverTargetId, this.lanePx[role]);
    h.cursor = local;
    h.hoverTargetId = hover?.id ?? null;
    h.status = "tracking";
    h.lastValidMs = frame.tMs;

    const transition = h.pinch.update(ratio.value, frame.tMs);
    const inRest = hover?.kind === "rest";
    const tMs = frame.tMs;

    switch (h.state) {
      case "open":
        if (inRest) {
          events.push({ type: "rest", hand: role, tMs });
          h.state = "resting";
        } else if (transition === "closed") {
          events.push({ type: "press", hand: role, targetId: hover?.id ?? null, tMs });
          h.state = "held";
          h.heldTargetId = hover?.id ?? null;
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
        if (!inRest && h.pinch.state() === "open") {
          events.push({ type: "arm", hand: role, tMs });
          h.state = "open";
        }
        break;
    }
    return true;
  }
}
