import { describe, expect, it } from "vitest";
import {
  CHORD_LAYOUT,
  MELODY_LAYOUT,
  hitTest,
  hoverTarget,
  minimumTargetSizeProblem,
} from "../../../src/domain/layout";

const LOWER_ROW_Y = 0.6;
const UPPER_ROW_Y = 0.2;

describe("melody layout", () => {
  it("places seven naturals in equal columns on the lower row", () => {
    const ids = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((c) => hitTest(MELODY_LAYOUT, { x: c / 7, y: LOWER_ROW_Y })?.id);
    expect(ids).toEqual(["melody-pc-0", "melody-pc-2", "melody-pc-4", "melody-pc-5", "melody-pc-7", "melody-pc-9", "melody-pc-11"]);
  });

  it("centres accidentals on the natural boundaries in the upper row", () => {
    const ids = [1, 2, 4, 5, 6].map((b) => hitTest(MELODY_LAYOUT, { x: b / 7, y: UPPER_ROW_Y })?.id);
    expect(ids).toEqual(["melody-pc-1", "melody-pc-3", "melody-pc-6", "melody-pc-8", "melody-pc-10"]);
  });

  it("leaves the E/F and B/C upper-row positions untargetable", () => {
    expect(hitTest(MELODY_LAYOUT, { x: 3 / 7, y: UPPER_ROW_Y })).toBeNull();
    expect(hitTest(MELODY_LAYOUT, { x: 0.999, y: UPPER_ROW_Y })).toBeNull();
    expect(hitTest(MELODY_LAYOUT, { x: 0.001, y: UPPER_ROW_Y })).toBeNull();
  });

  it("has a rest strip at the bottom separated from the notes by a silent gap", () => {
    const rest = MELODY_LAYOUT.targets.find((t) => t.kind === "rest");
    const lowestNote = Math.max(...MELODY_LAYOUT.targets.filter((t) => t.kind !== "rest").map((t) => t.y + t.h));
    expect(rest).toBeDefined();
    expect(rest!.y).toBeGreaterThan(lowestNote);
    expect(hitTest(MELODY_LAYOUT, { x: 0.5, y: (lowestNote + rest!.y) / 2 })).toBeNull();
    expect(hitTest(MELODY_LAYOUT, { x: 0.5, y: 0.97 })?.kind).toBe("rest");
  });

  it("returns null outside the lane", () => {
    expect(hitTest(MELODY_LAYOUT, { x: -0.01, y: 0.5 })).toBeNull();
    expect(hitTest(MELODY_LAYOUT, { x: 0.5, y: 1.01 })).toBeNull();
  });
});

describe("chord layout", () => {
  it("has eight pads in two rows of four, in reading order", () => {
    const pads = CHORD_LAYOUT.targets.filter((t) => t.kind === "chord-pad");
    expect(pads).toHaveLength(8);
    const centre = (i: number) => {
      const t = pads[i]!;
      return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    };
    for (let i = 0; i < 8; i++) {
      expect(hitTest(CHORD_LAYOUT, centre(i))?.id).toBe(`chord-slot-${i}`);
    }
    expect(centre(0).y).toBeLessThan(centre(4).y);
    expect(centre(0).x).toBeLessThan(centre(1).x);
  });

  it("keeps gutters between pads untargetable", () => {
    const [a, b] = [CHORD_LAYOUT.targets[0]!, CHORD_LAYOUT.targets[1]!];
    const gutterX = (a.x + a.w + b.x) / 2;
    expect(hitTest(CHORD_LAYOUT, { x: gutterX, y: a.y + a.h / 2 })).toBeNull();
  });
});

describe("hoverTarget hysteresis", () => {
  const lanePx = { width: 700, height: 400 };
  const d = MELODY_LAYOUT.targets.find((t) => t.id === "melody-pc-0")!;
  const e = MELODY_LAYOUT.targets.find((t) => t.id === "melody-pc-2")!;
  const smallerPx = Math.min(d.w * lanePx.width, d.h * lanePx.height);
  const marginX = (0.05 * smallerPx) / lanePx.width;

  it("keeps the current target just past its boundary", () => {
    const p = { x: d.x + d.w + marginX * 0.5, y: LOWER_ROW_Y };
    expect(hitTest(MELODY_LAYOUT, p)?.id).toBe(e.id);
    expect(hoverTarget(MELODY_LAYOUT, p, d.id, lanePx)?.id).toBe(d.id);
  });

  it("switches once the cursor is clearly inside another target", () => {
    const p = { x: d.x + d.w + marginX * 1.5, y: LOWER_ROW_Y };
    expect(hoverTarget(MELODY_LAYOUT, p, d.id, lanePx)?.id).toBe(e.id);
  });

  it("does not stick to a target from a gap far outside the margin", () => {
    expect(hoverTarget(MELODY_LAYOUT, { x: 3 / 7, y: UPPER_ROW_Y }, "melody-pc-4", lanePx)).toBeNull();
  });
});

describe("minimumTargetSizeProblem", () => {
  it("accepts the 1024x640 two-hand layout sizes from the design system", () => {
    expect(minimumTargetSizeProblem(MELODY_LAYOUT, { width: 571, height: 320 })).toBeNull();
    expect(minimumTargetSizeProblem(CHORD_LAYOUT, { width: 381, height: 320 })).toBeNull();
  });

  it("reports when a lane is too small instead of compressing targets", () => {
    expect(minimumTargetSizeProblem(MELODY_LAYOUT, { width: 400, height: 320 })).toMatch(/64/);
    expect(minimumTargetSizeProblem(CHORD_LAYOUT, { width: 300, height: 320 })).toMatch(/88/);
  });
});
