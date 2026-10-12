import type { HandRole } from "../events";
import {
  PROFILE_VERSION,
  calibratePinch,
  calibrateReach,
  recommendTempo,
  type CalibrationProfile,
  type HandCalibration,
  type PinchCalibration,
  type Rect,
} from "./calibration";
import { DEFAULT_CURSOR_TAU_MS } from "./cursorFilter";
import { palmCenter, pinchRatio, toDisplay, type ImageSize, type Point2 } from "./geometry";
import { IdentityTracker, type Detection } from "./identity";
import { PinchDetector } from "./pinchDetector";

export const IDENTIFY_MIN_FRAMES = 15;
export const IDENTIFY_MIN_MS = 1000;
export const REACH_MS = 6000;
export const PINCH_CYCLES = 5;
export const PHASE_MS = 1500;
/** Samples in the first part of each prompted phase are discarded (reaction time). */
export const PHASE_SETTLE_MS = 500;
export const PACE_PINCHES = 8;
export const PACE_TIMEOUT_MS = 15_000;

export type CalibrationFailureCode =
  | "identify-unclear"
  | "identify-inconsistent"
  | "regions-crossed"
  | "too-few-samples"
  | "pinch-overlap"
  | "pinch-unreliable"
  | "reach-too-small";

type RetryTarget = { kind: "identify" } | { kind: "reach"; hand: HandRole } | { kind: "pinch"; hand: HandRole };

export type CalibrationStep =
  | { kind: "identify"; hand: HandRole }
  | { kind: "reach"; hand: HandRole }
  | { kind: "pinch"; hand: HandRole; cycle: number; phase: "open" | "closed" }
  | { kind: "pace" }
  | { kind: "done"; profile: CalibrationProfile }
  | { kind: "failed"; error: { code: CalibrationFailureCode; message: string }; retry: RetryTarget };

export interface CalibrationSetup {
  camera: CalibrationProfile["camera"];
  processing: CalibrationProfile["processing"];
  nowIso: () => string;
  startMs: number;
}

export interface CalibrationFrame {
  tMs: number;
  detections: readonly Detection[];
  imageSize: ImageSize;
}

const LABEL: Record<HandRole, "Left" | "Right"> = { left: "Left", right: "Right" };
const centreX = (r: Rect) => r.x + r.w / 2;

/**
 * Pure calibration wizard. Feed it tracked frames; it advances through the
 * steps, rejects unreliable data with a specific correction, and only
 * produces a profile when every step succeeded. Stores parameters, never
 * frames or landmark traces.
 */
export class CalibrationSession {
  private readonly setup: CalibrationSetup;
  private current: CalibrationStep = { kind: "identify", hand: "left" };
  private correction: "as-reported" | "swapped" = "as-reported";
  private identity = new IdentityTracker("as-reported");

  // Per-step working state.
  private stepStartMs: number | null = null;
  private labels: string[] = [];
  private reachSamples: Point2[] = [];
  private openSamples: number[] = [];
  private closedSamples: number[] = [];
  private paceDetector: PinchDetector | null = null;
  private paceCloses: number[] = [];

  private readonly regions: Partial<Record<HandRole, Rect>> = {};
  private readonly pinches: Partial<Record<HandRole, PinchCalibration>> = {};

  constructor(setup: CalibrationSetup) {
    this.setup = setup;
  }

  step(): CalibrationStep {
    return this.current;
  }

  handednessCorrection(): "as-reported" | "swapped" {
    return this.correction;
  }

  /** 0..1 progress within the current step, for honest progress display. */
  progress(nowMs?: number): number {
    const c = this.current;
    const elapsed = this.stepStartMs === null ? 0 : (nowMs ?? this.lastMs) - this.stepStartMs;
    switch (c.kind) {
      case "identify":
        return Math.min(this.labels.length / IDENTIFY_MIN_FRAMES, elapsed / IDENTIFY_MIN_MS, 1);
      case "reach":
        return this.stepStartMs === null ? 0 : Math.min(elapsed / REACH_MS, 1);
      case "pinch":
        return this.stepStartMs === null ? 0 : Math.min(elapsed / (PINCH_CYCLES * 2 * PHASE_MS), 1);
      case "pace":
        return Math.min(this.paceCloses.length / PACE_PINCHES, 1);
      case "done":
        return 1;
      case "failed":
        return 0;
    }
  }

  instruction(): string {
    const c = this.current;
    switch (c.kind) {
      case "identify":
        return `Raise only your ${c.hand} hand, palm towards the camera, and hold it still.`;
      case "reach":
        return `Move your ${c.hand} hand slowly around the area where it is comfortable to play, including the bottom edge where you will rest. Do not stretch.`;
      case "pinch":
        return c.phase === "open"
          ? `${capital(c.hand)} hand: open — keep thumb and index finger apart. (${c.cycle + 1} of ${PINCH_CYCLES})`
          : `${capital(c.hand)} hand: pinch — touch thumb to index fingertip and hold. (${c.cycle + 1} of ${PINCH_CYCLES})`;
      case "pace":
        return "Right hand: pinch and open at a steady, comfortable pace, as if tapping a beat. You can skip this.";
      case "done":
        return "Calibration complete.";
      case "failed":
        return c.error.message;
    }
  }

  feed(frame: CalibrationFrame): void {
    this.lastMs = frame.tMs;
    const c = this.current;
    switch (c.kind) {
      case "identify":
        return this.feedIdentify(c.hand, frame);
      case "reach":
        return this.feedReach(c.hand, frame);
      case "pinch":
        return this.feedPinch(c, frame);
      case "pace":
        return this.feedPace(frame);
      default:
        return;
    }
  }

  retry(): void {
    const c = this.current;
    if (c.kind !== "failed") return;
    if (c.retry.kind === "identify") this.enter({ kind: "identify", hand: "left" });
    else if (c.retry.kind === "reach") this.enter({ kind: "reach", hand: c.retry.hand });
    else this.enter({ kind: "pinch", hand: c.retry.hand, cycle: 0, phase: "open" });
  }

  skipPace(): void {
    if (this.current.kind === "pace") this.finish(null);
  }

  private lastMs = 0;

  private enter(step: CalibrationStep): void {
    this.current = step;
    this.stepStartMs = null;
    this.labels = [];
    this.reachSamples = [];
    this.openSamples = [];
    this.closedSamples = [];
    this.paceCloses = [];
    this.paceDetector = null;
    this.identity = new IdentityTracker(this.correction);
  }

  private failWith(code: CalibrationFailureCode, message: string, retry: RetryTarget): void {
    this.current = { kind: "failed", error: { code, message }, retry };
  }

  private feedIdentify(hand: HandRole, frame: CalibrationFrame): void {
    if (frame.detections.length !== 1) return;
    if (this.stepStartMs === null) this.stepStartMs = frame.tMs;
    this.labels.push((frame.detections[0] as Detection).label);
    if (this.labels.length < IDENTIFY_MIN_FRAMES || frame.tMs - this.stepStartMs < IDENTIFY_MIN_MS) return;

    const lefts = this.labels.filter((l) => l === "Left").length;
    const majority: "Left" | "Right" = lefts * 2 >= this.labels.length ? "Left" : "Right";
    const share = (majority === "Left" ? lefts : this.labels.length - lefts) / this.labels.length;
    if (share < 0.8) {
      this.failWith("identify-unclear", "The camera could not tell which hand this is. Hold one hand still, palm facing the camera, in good light.", { kind: "identify" });
      return;
    }
    if (hand === "left") {
      this.correction = majority === "Left" ? "as-reported" : "swapped";
      this.enter({ kind: "identify", hand: "right" });
      return;
    }
    const expected = this.correction === "as-reported" ? LABEL.right : LABEL.left;
    if (majority !== expected) {
      this.failWith("identify-inconsistent", "That looked like the same hand both times. Raise your left hand first, then your right hand.", { kind: "identify" });
      return;
    }
    this.enter({ kind: "reach", hand: "left" });
  }

  private roleDetection(hand: HandRole, frame: CalibrationFrame): Detection | null {
    const a = this.identity.assign(frame.detections, frame.tMs);
    return a.ambiguous ? null : a[hand];
  }

  private feedReach(hand: HandRole, frame: CalibrationFrame): void {
    const d = this.roleDetection(hand, frame);
    if (d) {
      if (this.stepStartMs === null) this.stepStartMs = frame.tMs;
      this.reachSamples.push(toDisplay(palmCenter(d.landmarks), this.setup.camera.mirrored));
    }
    if (this.stepStartMs === null || frame.tMs - this.stepStartMs < REACH_MS) return;
    const region = calibrateReach(this.reachSamples);
    if (!region.ok) {
      this.failWith(region.error.code, region.error.message, { kind: "reach", hand });
      return;
    }
    this.regions[hand] = region.value;
    if (hand === "left") {
      this.enter({ kind: "reach", hand: "right" });
      return;
    }
    const left = this.regions.left;
    if (left && centreX(left) >= centreX(region.value)) {
      this.failWith("regions-crossed", "Your hands would need to cross. Keep your left hand on the left side and your right hand on the right side.", { kind: "reach", hand: "left" });
      return;
    }
    this.enter({ kind: "pinch", hand: "left", cycle: 0, phase: "open" });
  }

  private feedPinch(c: Extract<CalibrationStep, { kind: "pinch" }>, frame: CalibrationFrame): void {
    const d = this.roleDetection(c.hand, frame);
    if (this.stepStartMs === null) {
      if (!d) return; // Wait for the hand before starting the prompts.
      this.stepStartMs = frame.tMs;
    }
    const elapsed = frame.tMs - this.stepStartMs;
    const phaseIndex = Math.floor(elapsed / PHASE_MS);
    if (phaseIndex >= PINCH_CYCLES * 2) {
      const result = calibratePinch(this.openSamples, this.closedSamples);
      if (!result.ok) {
        this.failWith(result.error.code, result.error.message, { kind: "pinch", hand: c.hand });
        return;
      }
      this.pinches[c.hand] = result.value;
      if (c.hand === "left") this.enter({ kind: "pinch", hand: "right", cycle: 0, phase: "open" });
      else this.enter({ kind: "pace" });
      return;
    }
    const phase = phaseIndex % 2 === 0 ? "open" : "closed";
    this.current = { kind: "pinch", hand: c.hand, cycle: Math.floor(phaseIndex / 2), phase };
    if (!d || elapsed - phaseIndex * PHASE_MS < PHASE_SETTLE_MS) return;
    const ratio = pinchRatio(d.landmarks, frame.imageSize);
    if (!ratio.ok) return;
    (phase === "open" ? this.openSamples : this.closedSamples).push(ratio.value);
  }

  private feedPace(frame: CalibrationFrame): void {
    const pinch = this.pinches.right;
    if (!pinch) return;
    this.paceDetector ??= new PinchDetector(pinch);
    const d = this.roleDetection("right", frame);
    if (this.stepStartMs === null) {
      if (!d) return;
      this.stepStartMs = frame.tMs;
    }
    if (d) {
      const ratio = pinchRatio(d.landmarks, frame.imageSize);
      if (ratio.ok && this.paceDetector.update(ratio.value, frame.tMs) === "closed") this.paceCloses.push(frame.tMs);
    } else {
      this.paceDetector.invalidFrame();
    }
    if (this.paceCloses.length >= PACE_PINCHES || frame.tMs - this.stepStartMs >= PACE_TIMEOUT_MS) {
      const periods = this.paceCloses.slice(1).map((tc, i) => tc - (this.paceCloses[i] as number));
      this.finish(recommendTempo(periods));
    }
  }

  private finish(tempo: number | null): void {
    const { left: rl, right: rr } = this.regions;
    const { left: pl, right: pr } = this.pinches;
    if (!rl || !rr || !pl || !pr) return;
    const hands: Record<HandRole, HandCalibration> = { left: { region: rl, pinch: pl }, right: { region: rr, pinch: pr } };
    this.current = {
      kind: "done",
      profile: {
        profileVersion: PROFILE_VERSION,
        createdAt: this.setup.nowIso(),
        camera: { ...this.setup.camera },
        processing: { ...this.setup.processing },
        handednessCorrection: this.correction,
        hands,
        cursorTauMs: DEFAULT_CURSOR_TAU_MS,
        recommendedTempoBpm: tempo,
      },
    };
  }
}

function capital(h: HandRole): string {
  return h === "left" ? "Left" : "Right";
}

