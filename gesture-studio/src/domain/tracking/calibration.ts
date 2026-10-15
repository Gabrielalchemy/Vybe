import { fail, ok, type Result } from "../result";
import type { Point2 } from "./geometry";
import type { FlickThresholds } from "./flickDetector";
import type { PinchThresholds } from "./pinchDetector";
import type { TriggerGesture } from "./triggerDetector";

/** Version 2 added the play gesture (flick or pinch). Version 1 profiles need recalibration. */
export const PROFILE_VERSION = 2;
export const MIN_FLICKS = 5;
export const MIN_MOVES = 5;
export const MIN_PINCH_SAMPLES = 10;
/** Smallest reach region, as a fraction of the camera frame per axis. */
export const MIN_REGION_FRACTION = 0.12;
export const TEMPO_RANGE = { min: 40, max: 120 } as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PinchCalibration extends PinchThresholds {
  closedHigh: number;
  openLow: number;
}

export interface FlickCalibration extends FlickThresholds {
  /** Typical extension with the fingers flicked down. */
  flexLevel: number;
  /** 10th percentile of the open-hand extension. */
  openLow: number;
}

export interface HandCalibration {
  /** Comfortable reach in display coordinates (mirroring already applied). */
  region: Rect;
  /** Present when the profile's gesture is pinch. */
  pinch?: PinchCalibration;
  /** Present when the profile's gesture is flick. */
  flick?: FlickCalibration;
}

export interface CalibrationProfile {
  profileVersion: number;
  /** The play gesture these thresholds were measured for. */
  trigger: TriggerGesture;
  createdAt: string;
  camera: { deviceId: string; label: string; width: number; height: number; mirrored: boolean };
  processing: { longEdgePx: number; modelSha256: string };
  /** Adapter correction if the SDK's handedness labels are opposite to the owner's anatomical hands. */
  handednessCorrection: "as-reported" | "swapped";
  hands: { left: HandCalibration; right: HandCalibration };
  cursorTauMs: number;
  /** Recommended beginner exercise tempo from measured repeatable pinch cycles; null if not measured. */
  recommendedTempoBpm: number | null;
}

export type CalibrationErrorCode =
  | "too-few-samples"
  | "pinch-overlap"
  | "pinch-unreliable"
  | "flick-overlap"
  | "flick-unreliable"
  | "reach-too-small";

export interface CalibrationError {
  code: CalibrationErrorCode;
  message: string;
}

/** Linear-interpolated percentile (p in 0..100). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("No values.");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (rank - lo);
}

function medianAbsoluteDeviation(values: readonly number[]): number {
  const m = percentile(values, 50);
  return percentile(
    values.map((v) => Math.abs(v - m)),
    50,
  );
}

/**
 * Pinch thresholds from open and closed examples (architecture.md §5).
 * Starting rules to validate in trials, not proven constants.
 */
export function calibratePinch(open: readonly number[], closed: readonly number[]): Result<PinchCalibration, CalibrationError> {
  if (open.length < MIN_PINCH_SAMPLES || closed.length < MIN_PINCH_SAMPLES) {
    return fail({ code: "too-few-samples", message: "Not enough open and closed examples were captured. Keep the hand in view and repeat." });
  }
  const closedHigh = percentile(closed, 90);
  const openLow = percentile(open, 10);
  const gap = openLow - closedHigh;
  if (!(gap > 0)) {
    return fail({
      code: "pinch-overlap",
      message: "Open and closed pinches looked too similar. Turn your palm towards the camera and touch thumb to index fingertip firmly.",
    });
  }
  const spread = Math.max(medianAbsoluteDeviation(open), medianAbsoluteDeviation(closed));
  if (gap < 3 * spread) {
    return fail({
      code: "pinch-unreliable",
      message: "Pinches were not consistent enough to tell apart reliably. Improve the lighting or move a little closer, then repeat.",
    });
  }
  return ok({ closedHigh, openLow, press: closedHigh + 0.25 * gap, release: closedHigh + 0.65 * gap });
}

export interface StrokeFeatures {
  /** Largest fall in extension within any 150 ms span. */
  drop: number;
  /** Fastest falling frame pair, extension units per second. */
  rate: number;
  minE: number;
}

/** Features of one stretch of finger-extension samples (a flick, or ordinary movement). */
export function strokeFeatures(samples: readonly { e: number; tMs: number }[]): StrokeFeatures {
  const minE = samples.length ? Math.min(...samples.map((s) => s.e)) : 0;
  let drop = 0;
  let rate = 0;
  for (let i = 1; i < samples.length; i++) {
    const cur = samples[i] as { e: number; tMs: number };
    const prev = samples[i - 1] as { e: number; tMs: number };
    if (cur.tMs > prev.tMs) rate = Math.max(rate, ((prev.e - cur.e) * 1000) / (cur.tMs - prev.tMs));
    let peak = cur.e;
    for (let j = i - 1; j >= 0 && cur.tMs - (samples[j] as { tMs: number }).tMs <= 150; j--) peak = Math.max(peak, (samples[j] as { e: number }).e);
    drop = Math.max(drop, peak - cur.e);
  }
  return { drop, rate, minE };
}

/**
 * Flick thresholds from the owner's open hand, prompted flicks and ordinary
 * between-pad movement. Thresholds sit between movement and flicks; data where
 * the two overlap is rejected rather than accepted.
 */
export function calibrateFlick(
  open: readonly number[],
  flicks: readonly StrokeFeatures[],
  moves: readonly StrokeFeatures[],
): Result<FlickCalibration, CalibrationError> {
  if (open.length < MIN_PINCH_SAMPLES || flicks.length < MIN_FLICKS || moves.length < MIN_MOVES) {
    return fail({ code: "too-few-samples", message: "Not enough flicks or movement were captured. Keep the hand in view and repeat." });
  }
  const overlap = (): Result<never, CalibrationError> =>
    fail({
      code: "flick-overlap",
      message: "Your flicks looked like ordinary hand movement. Flick the fingers down faster and further, and move more slowly between pads.",
    });
  const flickDropLow = percentile(flicks.map((f) => f.drop), 10);
  const moveDropHigh = percentile(moves.map((m) => m.drop), 90);
  const dropGap = flickDropLow - moveDropHigh;
  if (!(dropGap > 0)) return overlap();
  const spread = Math.max(medianAbsoluteDeviation(flicks.map((f) => f.drop)), medianAbsoluteDeviation(moves.map((m) => m.drop)));
  if (dropGap < 3 * spread) {
    return fail({ code: "flick-unreliable", message: "Your flicks varied too much to tell apart reliably. Make each flick the same quick, full movement, then repeat." });
  }
  const flickRateLow = percentile(flicks.map((f) => f.rate), 10);
  const moveRateHigh = percentile(moves.map((m) => m.rate), 90);
  if (!(flickRateLow > moveRateHigh)) return overlap();
  const openLow = percentile(open, 10);
  const flexLevel = percentile(flicks.map((f) => f.minE), 50);
  if (!(flexLevel < openLow)) return overlap();
  return ok({
    openLow,
    flexLevel,
    openLevel: flexLevel + 0.8 * (openLow - flexLevel),
    releaseLevel: flexLevel + 0.5 * (openLow - flexLevel),
    dropMin: moveDropHigh + 0.4 * dropGap,
    rateMin: moveRateHigh + 0.4 * (flickRateLow - moveRateHigh),
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Comfortable reach from palm positions sampled while the owner moves around, ignoring outliers. */
export function calibrateReach(samples: readonly Point2[]): Result<Rect, CalibrationError> {
  if (samples.length < MIN_PINCH_SAMPLES) {
    return fail({ code: "too-few-samples", message: "The hand was not visible long enough. Keep it in view and repeat." });
  }
  const xs = samples.map((p) => p.x);
  const ys = samples.map((p) => p.y);
  const x0 = clamp01(percentile(xs, 5));
  const x1 = clamp01(percentile(xs, 95));
  const y0 = clamp01(percentile(ys, 5));
  const y1 = clamp01(percentile(ys, 95));
  if (x1 - x0 < MIN_REGION_FRACTION || y1 - y0 < MIN_REGION_FRACTION) {
    return fail({ code: "reach-too-small", message: "Move the hand a little further across and up and down, staying comfortable." });
  }
  return ok({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/**
 * Starting exercise tempo from measured close-open cycle periods. Uses the
 * slower end of the owner's repeatable cycles; this is a recommendation only.
 */
export function recommendTempo(cyclePeriodsMs: readonly number[]): number | null {
  if (cyclePeriodsMs.length < 5) return null;
  const slow = percentile(cyclePeriodsMs, 90);
  const bpm = Math.floor(60000 / slow / 5) * 5;
  return Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, bpm));
}

export interface CurrentGeometry {
  /** The play gesture currently chosen in Settings. */
  trigger: TriggerGesture;
  deviceId: string;
  width: number;
  height: number;
  mirrored: boolean;
  longEdgePx: number;
  modelSha256: string;
}

export type IncompatibilityReason = "version" | "trigger" | "camera" | "aspect" | "mirroring" | "processing" | "model";

/** Reasons the saved calibration no longer applies; empty when it does. */
export function checkCompatibility(profile: CalibrationProfile, current: CurrentGeometry): IncompatibilityReason[] {
  const reasons: IncompatibilityReason[] = [];
  if (profile.profileVersion !== PROFILE_VERSION) reasons.push("version");
  if (profile.trigger !== current.trigger) reasons.push("trigger");
  if (profile.camera.deviceId !== current.deviceId) reasons.push("camera");
  const savedAspect = profile.camera.width / profile.camera.height;
  const aspect = current.width / current.height;
  if (Math.abs(savedAspect - aspect) / savedAspect > 0.01) reasons.push("aspect");
  if (profile.camera.mirrored !== current.mirrored) reasons.push("mirroring");
  if (profile.processing.longEdgePx !== current.longEdgePx) reasons.push("processing");
  if (profile.processing.modelSha256 !== current.modelSha256) reasons.push("model");
  return reasons;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validRect(v: unknown): v is Rect {
  return (
    isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h) &&
    v.x >= 0 && v.y >= 0 && v.w >= MIN_REGION_FRACTION && v.h >= MIN_REGION_FRACTION &&
    v.x + v.w <= 1 + 1e-9 && v.y + v.h <= 1 + 1e-9
  );
}

function validFlick(v: unknown): v is FlickCalibration {
  return (
    isObj(v) && isNum(v.openLevel) && isNum(v.releaseLevel) && isNum(v.dropMin) && isNum(v.rateMin) && isNum(v.flexLevel) && isNum(v.openLow) &&
    v.flexLevel < v.releaseLevel && v.releaseLevel < v.openLevel && v.openLevel <= v.openLow && v.dropMin > 0 && v.rateMin > 0
  );
}

function validPinch(v: unknown): v is PinchCalibration {
  return (
    isObj(v) && isNum(v.press) && isNum(v.release) && isNum(v.closedHigh) && isNum(v.openLow) &&
    v.press > 0 && v.release > v.press && v.closedHigh < v.press && v.openLow > v.release
  );
}

export function validateCalibrationProfile(value: unknown): Result<CalibrationProfile> {
  if (!isObj(value)) return fail("Calibration must be an object.");
  if (value.profileVersion !== PROFILE_VERSION) return fail("Calibration was made by a different version of Vybe. Recalibrate.");
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) return fail("Calibration date is invalid.");
  const cam = value.camera;
  if (!isObj(cam) || typeof cam.deviceId !== "string" || typeof cam.label !== "string" || !isNum(cam.width) || !isNum(cam.height) ||
    cam.width <= 0 || cam.height <= 0 || typeof cam.mirrored !== "boolean") {
    return fail("Calibration camera details are invalid.");
  }
  const proc = value.processing;
  if (!isObj(proc) || !isNum(proc.longEdgePx) || proc.longEdgePx <= 0 || typeof proc.modelSha256 !== "string" || !/^[0-9a-f]{64}$/.test(proc.modelSha256)) {
    return fail("Calibration processing details are invalid.");
  }
  if (value.handednessCorrection !== "as-reported" && value.handednessCorrection !== "swapped") return fail("Handedness correction is invalid.");
  if (value.trigger !== "pinch" && value.trigger !== "flick") return fail("Calibration play gesture is invalid.");
  const trigger = value.trigger;
  const hands = value.hands;
  if (!isObj(hands) || !isObj(hands.left) || !isObj(hands.right)) return fail("Calibration hands are missing.");
  for (const side of ["left", "right"] as const) {
    const h = hands[side] as Obj;
    if (!validRect(h.region)) return fail(`The ${side} hand region is invalid.`);
    if (trigger === "pinch" && !validPinch(h.pinch)) return fail(`The ${side} hand pinch thresholds are invalid.`);
    if (trigger === "flick" && !validFlick(h.flick)) return fail(`The ${side} hand flick thresholds are invalid.`);
  }
  const left = (hands.left as Obj).region as Rect;
  const right = (hands.right as Obj).region as Rect;
  if (left.x + left.w / 2 >= right.x + right.w / 2) return fail("The left-hand region must be to the left of the right-hand region.");
  if (!isNum(value.cursorTauMs) || value.cursorTauMs <= 0) return fail("Cursor smoothing is invalid.");
  if (value.recommendedTempoBpm !== null && !(isNum(value.recommendedTempoBpm) && value.recommendedTempoBpm >= TEMPO_RANGE.min && value.recommendedTempoBpm <= TEMPO_RANGE.max)) {
    return fail("Recommended tempo is invalid.");
  }
  return ok(structuredClone(value) as unknown as CalibrationProfile);
}
