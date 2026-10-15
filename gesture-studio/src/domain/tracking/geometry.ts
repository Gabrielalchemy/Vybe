import { fail, ok, type Result } from "../result";

/** MediaPipe normalized landmark: x, y in [0, 1] of the unmirrored input image. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export const LANDMARK = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  ringMcp: 13,
  pinkyMcp: 17,
} as const;

const PALM_POINTS = [LANDMARK.wrist, LANDMARK.indexMcp, LANDMARK.middleMcp, LANDMARK.ringMcp, LANDMARK.pinkyMcp] as const;

/** Below this palm span (pixels) the hand is too small or degenerate to measure a pinch. */
export const MIN_PALM_SPAN_PX = 4;

export function isValidLandmarkSet(landmarks: readonly Landmark[]): boolean {
  return landmarks.length === 21 && landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Mean of the wrist and the four MCP joints; steadier than a fingertip during a pinch. */
export function palmCenter(landmarks: readonly Landmark[]): Point2 {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    const p = landmarks[i];
    if (!p) throw new RangeError("Hand needs 21 landmarks.");
    x += p.x;
    y += p.y;
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

function distancePx(a: Landmark, b: Landmark, size: ImageSize): number {
  return Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height);
}

/**
 * Thumb-tip to index-tip distance divided by the index-MCP to pinky-MCP span,
 * both measured in pixels so the camera aspect ratio does not bias the ratio.
 */
export function pinchRatio(landmarks: readonly Landmark[], size: ImageSize): Result<number> {
  if (!isValidLandmarkSet(landmarks)) return fail("Hand landmarks are incomplete.");
  const at = (i: number) => landmarks[i] as Landmark;
  const span = distancePx(at(LANDMARK.indexMcp), at(LANDMARK.pinkyMcp), size);
  if (!(span >= MIN_PALM_SPAN_PX)) return fail("Hand is too small or edge-on to measure a pinch.");
  return ok(distancePx(at(LANDMARK.thumbTip), at(LANDMARK.indexTip), size) / span);
}

const FLICK_TIPS = [8, 12, 16] as const;

/**
 * Finger extension: how far the index, middle and ring fingertips reach along
 * the hand's own axis (wrist to middle knuckle), in palm widths. Folding the
 * fingers (a flick) lowers it; moving or resizing the whole hand does not.
 * Measured in pixels so the camera aspect ratio does not bias it.
 */
export function fingerExtension(landmarks: readonly Landmark[], size: ImageSize): Result<number> {
  if (!isValidLandmarkSet(landmarks)) return fail("Hand landmarks are incomplete.");
  const at = (i: number) => landmarks[i] as Landmark;
  const span = distancePx(at(LANDMARK.indexMcp), at(LANDMARK.pinkyMcp), size);
  if (!(span >= MIN_PALM_SPAN_PX)) return fail("Hand is too small or edge-on to measure the fingers.");
  const wrist = at(LANDMARK.wrist);
  const mid = at(LANDMARK.middleMcp);
  const ax = (mid.x - wrist.x) * size.width;
  const ay = (mid.y - wrist.y) * size.height;
  const axisLen = Math.hypot(ax, ay);
  if (!(axisLen >= MIN_PALM_SPAN_PX)) return fail("Hand is too small or edge-on to measure the fingers.");
  let sum = 0;
  for (const i of FLICK_TIPS) {
    const tip = at(i);
    sum += ((tip.x - wrist.x) * size.width * ax + (tip.y - wrist.y) * size.height * ay) / axisLen;
  }
  return ok(sum / FLICK_TIPS.length / span);
}

/** Inference runs on unmirrored frames; display coordinates are transformed exactly once here. */
export function toDisplay(p: Point2, mirrored: boolean): Point2 {
  return mirrored ? { x: 1 - p.x, y: p.y } : { x: p.x, y: p.y };
}
