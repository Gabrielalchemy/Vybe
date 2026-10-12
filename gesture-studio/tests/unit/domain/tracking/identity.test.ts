import { describe, expect, it } from "vitest";
import { IdentityTracker, type Detection } from "../../../../src/domain/tracking/identity";
import { syntheticHand } from "../../../fixtures/hands";

// Unmirrored image coordinates: the owner's anatomical left hand appears on the image's right side.
const det = (cx: number, label: "Left" | "Right", cy = 0.5): Detection => ({ landmarks: syntheticHand({ cx, cy }), label });

describe("IdentityTracker", () => {
  it("assigns by corrected handedness on first sight", () => {
    const t = new IdentityTracker("as-reported");
    const r = t.assign([det(0.7, "Left"), det(0.3, "Right")], 0);
    expect(r.ambiguous).toBe(false);
    expect(r.left?.landmarks[0]!.x).toBeCloseTo(0.7, 1);
    expect(r.right?.landmarks[0]!.x).toBeCloseTo(0.3, 1);
  });

  it("applies the calibrated handedness correction", () => {
    const t = new IdentityTracker("swapped");
    const r = t.assign([det(0.7, "Right"), det(0.3, "Left")], 0);
    expect(r.left?.landmarks[0]!.x).toBeCloseTo(0.7, 1);
  });

  it("is ambiguous when two new detections carry the same label", () => {
    const t = new IdentityTracker("as-reported");
    const r = t.assign([det(0.7, "Left"), det(0.3, "Left")], 0);
    expect(r).toMatchObject({ ambiguous: true, left: null, right: null });
  });

  it("keeps identities by continuity when labels briefly flip on well-separated hands", () => {
    const t = new IdentityTracker("as-reported");
    t.assign([det(0.7, "Left"), det(0.3, "Right")], 0);
    const r = t.assign([det(0.71, "Right"), det(0.29, "Left")], 33);
    expect(r.ambiguous).toBe(false);
    expect(r.left?.landmarks[0]!.x).toBeCloseTo(0.71, 1);
    expect(r.right?.landmarks[0]!.x).toBeCloseTo(0.29, 1);
  });

  it("disarms rather than guesses when crossing hands overlap with conflicting evidence", () => {
    const t = new IdentityTracker("as-reported");
    t.assign([det(0.52, "Left"), det(0.48, "Right")], 0);
    // Palms nearly coincide; continuity says the hands stayed put, labels say they crossed.
    const r = t.assign([det(0.515, "Right"), det(0.485, "Left")], 33);
    expect(r.ambiguous).toBe(true);
  });

  it("follows a single visible hand by continuity and label", () => {
    const t = new IdentityTracker("as-reported");
    t.assign([det(0.7, "Left"), det(0.3, "Right")], 0);
    const r = t.assign([det(0.31, "Right")], 33);
    expect(r).toMatchObject({ ambiguous: false, left: null });
    expect(r.right?.landmarks[0]!.x).toBeCloseTo(0.31, 1);
  });

  it("flags a single detection whose label contradicts a nearby recent track", () => {
    const t = new IdentityTracker("as-reported");
    t.assign([det(0.7, "Left"), det(0.3, "Right")], 0);
    const r = t.assign([det(0.305, "Left")], 33);
    expect(r.ambiguous).toBe(true);
  });

  it("forgets stale tracks so a returning hand is identified afresh by label", () => {
    const t = new IdentityTracker("as-reported");
    t.assign([det(0.3, "Right")], 0);
    const r = t.assign([det(0.32, "Left")], 1000);
    expect(r.ambiguous).toBe(false);
    expect(r.left).not.toBeNull();
  });

  it("ignores extra detections beyond two by reporting ambiguity", () => {
    const t = new IdentityTracker("as-reported");
    const r = t.assign([det(0.2, "Left"), det(0.5, "Right"), det(0.8, "Left")], 0);
    expect(r.ambiguous).toBe(true);
  });
});
