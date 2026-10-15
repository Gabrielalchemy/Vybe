import { fail, ok, type Result } from "../result";

/** The subset of MediaTrackCapabilities (Image Capture extension) used here. */
export interface ExposureCapabilities {
  exposureMode?: readonly string[];
  /** In 100 µs units, per the Image Capture specification. */
  exposureTime?: { min?: number; max?: number };
}

export interface ExposureConstraints {
  exposureMode: "manual";
  exposureTime: number;
}

/**
 * Exposure as a fraction of the frame period. A full-period exposure (33.3 ms)
 * held the owner's webcam at 25 fps; the sensor also needs readout time.
 */
export const EXPOSURE_FRACTION_OF_FRAME = 0.8;

/**
 * Manual exposure shorter than one frame period, so the camera cannot drop
 * its frame rate to lengthen exposure in dim light. The image gets darker
 * instead; this is an owner-selected trade-off, not a default.
 */
export function steadyFrameRateConstraints(caps: ExposureCapabilities, fps: number): Result<ExposureConstraints> {
  if (!caps.exposureMode?.includes("manual")) return fail("This camera does not allow manual exposure in the browser.");
  const range = caps.exposureTime;
  if (!range || typeof range.max !== "number") return fail("This camera does not report its exposure range.");
  const cap = Math.floor((10000 / fps) * EXPOSURE_FRACTION_OF_FRAME); // 100 µs units
  const time = Math.max(range.min ?? 1, Math.min(range.max, cap));
  return ok({ exposureMode: "manual", exposureTime: time });
}
