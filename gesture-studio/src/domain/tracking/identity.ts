import type { HandRole } from "../events";
import { palmCenter, type Landmark, type Point2 } from "./geometry";

export interface Detection {
  landmarks: Landmark[];
  /** MediaPipe handedness category name. Not a tracking confidence. */
  label: "Left" | "Right";
}

export interface Assignment {
  left: Detection | null;
  right: Detection | null;
  /** Evidence conflicted or was insufficient: affected lanes must disarm. */
  ambiguous: boolean;
}

/** Tracks older than this no longer provide continuity evidence. */
export const TRACK_MEMORY_MS = 300;
/** Palms closer than this (normalized image units) are treated as overlapping. */
export const OVERLAP_DISTANCE = 0.12;
/** A single detection this close to a recent track is considered that track's hand. */
export const NEAR_TRACK_DISTANCE = 0.15;

const AMBIGUOUS: Assignment = { left: null, right: null, ambiguous: true };
const other = (r: HandRole): HandRole => (r === "left" ? "right" : "left");
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Assigns anatomical roles to detections using palm continuity and the
 * (calibration-corrected) handedness label. Detection array order is never
 * used. When the two kinds of evidence conflict on overlapping hands, the
 * result is ambiguous rather than a guess.
 */
export class IdentityTracker {
  private readonly tracks: Partial<Record<HandRole, { palm: Point2; tMs: number }>> = {};
  private readonly correction: "as-reported" | "swapped";

  constructor(correction: "as-reported" | "swapped") {
    this.correction = correction;
  }

  reset(): void {
    delete this.tracks.left;
    delete this.tracks.right;
  }

  assign(detections: readonly Detection[], tMs: number): Assignment {
    const result = this.decide(detections, tMs);
    if (!result.ambiguous) {
      for (const role of ["left", "right"] as const) {
        const d = result[role];
        if (d) this.tracks[role] = { palm: palmCenter(d.landmarks), tMs };
      }
    }
    return result;
  }

  private labelRole(d: Detection): HandRole {
    const reported: HandRole = d.label === "Left" ? "left" : "right";
    return this.correction === "as-reported" ? reported : other(reported);
  }

  private recent(role: HandRole, tMs: number): Point2 | null {
    const t = this.tracks[role];
    return t && tMs - t.tMs <= TRACK_MEMORY_MS ? t.palm : null;
  }

  private decide(detections: readonly Detection[], tMs: number): Assignment {
    if (detections.length === 0) return { left: null, right: null, ambiguous: false };
    if (detections.length > 2) return AMBIGUOUS;

    if (detections.length === 1) {
      const d = detections[0] as Detection;
      const palm = palmCenter(d.landmarks);
      const byLabel = this.labelRole(d);
      let nearest: HandRole | null = null;
      let best = NEAR_TRACK_DISTANCE;
      for (const role of ["left", "right"] as const) {
        const track = this.recent(role, tMs);
        if (track && dist(track, palm) < best) {
          best = dist(track, palm);
          nearest = role;
        }
      }
      if (nearest !== null && nearest !== byLabel) return AMBIGUOUS;
      return byLabel === "left" ? { left: d, right: null, ambiguous: false } : { left: null, right: d, ambiguous: false };
    }

    const [d0, d1] = detections as [Detection, Detection];
    const p0 = palmCenter(d0.landmarks);
    const p1 = palmCenter(d1.landmarks);
    const overlapping = dist(p0, p1) < OVERLAP_DISTANCE;

    // Label evidence: "straight" means d0 -> left, d1 -> right.
    const l0 = this.labelRole(d0);
    const l1 = this.labelRole(d1);
    const byLabel: "straight" | "swapped" | null = l0 === l1 ? null : l0 === "left" ? "straight" : "swapped";

    // Continuity evidence from recent tracks of both roles.
    let byContinuity: "straight" | "swapped" | null = null;
    const tl = this.recent("left", tMs);
    const tr = this.recent("right", tMs);
    if (tl && tr) {
      const straight = dist(p0, tl) + dist(p1, tr);
      const swapped = dist(p0, tr) + dist(p1, tl);
      if (Math.abs(straight - swapped) > 0.01) byContinuity = straight < swapped ? "straight" : "swapped";
    }

    let choice: "straight" | "swapped";
    if (byLabel && byContinuity) {
      if (byLabel !== byContinuity && overlapping) return AMBIGUOUS;
      choice = byContinuity;
    } else if (byLabel) {
      choice = byLabel;
    } else if (byContinuity && !overlapping) {
      choice = byContinuity;
    } else {
      return AMBIGUOUS;
    }
    return choice === "straight" ? { left: d0, right: d1, ambiguous: false } : { left: d1, right: d0, ambiguous: false };
  }
}
