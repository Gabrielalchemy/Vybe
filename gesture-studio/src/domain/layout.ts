/**
 * Pure lane geometry. The same LayoutDefinition renders the visible targets and
 * performs pointer/hand hit testing, so what the user sees is what is pressed.
 * Coordinates are normalized lane-local: x and y in [0, 1), y grows downward.
 */

export type TargetKind = "melody-note" | "chord-pad" | "rest";

export interface LayoutTarget {
  id: string;
  kind: TargetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Melody: pitch class 0..11. Chord: slot index 0..7. Rest: -1. */
  index: number;
}

export interface LayoutDefinition {
  lane: "melody" | "chord";
  targets: readonly LayoutTarget[];
  /** Minimum on-screen size of non-rest targets, CSS pixels (DESIGN_SYSTEM.md §2). */
  minTargetPx: { width: number; height: number };
}

export interface Point {
  x: number;
  y: number;
}

export interface SizePx {
  width: number;
  height: number;
}

// Vertical bands shared by both lanes.
const UPPER_ROW = { y: 0, h: 0.38 };
const LOWER_ROW = { y: 0.4, h: 0.38 };
// The silent gap 0.78..0.84 separates playable targets from the rest strip.
const REST_STRIP = { y: 0.84, h: 0.16 };

const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;
/** Accidental pitch class centred on each natural boundary k/7. */
const ACCIDENTALS: readonly [boundary: number, pitchClass: number][] = [
  [1, 1],
  [2, 3],
  [4, 6],
  [5, 8],
  [6, 10],
];
const ACCIDENTAL_WIDTH = 0.12;
const CHORD_GUTTER = 0.02;

const restTarget = (): LayoutTarget => ({ id: "rest", kind: "rest", x: 0, ...REST_STRIP, w: 1, index: -1 });

function buildMelodyLayout(): LayoutDefinition {
  const naturals = NATURAL_PITCH_CLASSES.map((pc, col) => ({
    id: `melody-pc-${pc}`,
    kind: "melody-note" as const,
    x: col / 7,
    w: 1 / 7,
    ...LOWER_ROW,
    index: pc,
  }));
  const accidentals = ACCIDENTALS.map(([boundary, pc]) => ({
    id: `melody-pc-${pc}`,
    kind: "melody-note" as const,
    x: boundary / 7 - ACCIDENTAL_WIDTH / 2,
    w: ACCIDENTAL_WIDTH,
    ...UPPER_ROW,
    index: pc,
  }));
  return {
    lane: "melody",
    targets: Object.freeze([...naturals, ...accidentals, restTarget()]),
    minTargetPx: { width: 64, height: 76 },
  };
}

function buildChordLayout(): LayoutDefinition {
  const w = (1 - 3 * CHORD_GUTTER) / 4;
  const pads = Array.from({ length: 8 }, (_, slot) => {
    const col = slot % 4;
    const row = slot < 4 ? UPPER_ROW : LOWER_ROW;
    return { id: `chord-slot-${slot}`, kind: "chord-pad" as const, x: col * (w + CHORD_GUTTER), w, ...row, index: slot };
  });
  return {
    lane: "chord",
    targets: Object.freeze([...pads, restTarget()]),
    minTargetPx: { width: 88, height: 96 },
  };
}

export const MELODY_LAYOUT: LayoutDefinition = buildMelodyLayout();
export const CHORD_LAYOUT: LayoutDefinition = buildChordLayout();

const contains = (t: LayoutTarget, p: Point, mx = 0, my = 0) =>
  p.x >= t.x - mx && p.x < t.x + t.w + mx && p.y >= t.y - my && p.y < t.y + t.h + my;

export function hitTest(layout: LayoutDefinition, p: Point): LayoutTarget | null {
  return layout.targets.find((t) => contains(t, p)) ?? null;
}

/**
 * Hover with boundary hysteresis: the current target is retained while the
 * cursor stays within a margin of 5% of the target's smaller pixel dimension.
 * The returned target is the one a press would latch.
 */
export function hoverTarget(layout: LayoutDefinition, p: Point, currentId: string | null, lanePx: SizePx): LayoutTarget | null {
  const current = currentId === null ? undefined : layout.targets.find((t) => t.id === currentId);
  if (current) {
    const marginPx = 0.05 * Math.min(current.w * lanePx.width, current.h * lanePx.height);
    if (contains(current, p, marginPx / lanePx.width, marginPx / lanePx.height)) return current;
  }
  return hitTest(layout, p);
}

/** Returns a description of the first undersized target, or null when the lane is large enough. */
export function minimumTargetSizeProblem(layout: LayoutDefinition, lanePx: SizePx): string | null {
  const { width, height } = layout.minTargetPx;
  for (const t of layout.targets) {
    if (t.kind === "rest") continue;
    if (t.w * lanePx.width < width || t.h * lanePx.height < height) {
      return `Targets need at least ${width} × ${height} px; this window gives ${Math.floor(t.w * lanePx.width)} × ${Math.floor(t.h * lanePx.height)} px.`;
    }
  }
  return null;
}
