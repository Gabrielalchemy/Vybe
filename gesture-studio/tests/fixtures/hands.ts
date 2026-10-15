import type { Landmark } from "../../src/domain/tracking/geometry";

/**
 * Synthetic 21-point hand in normalized image coordinates (unmirrored input).
 * `pinch` 0 = fully open (thumb tip far from index tip), 1 = touching.
 * `flex` 0 = fingers extended, 1 = index/middle/ring folded towards the palm.
 * Scale is the index-MCP to pinky-MCP span in normalized x units.
 */
export function syntheticHand(opts: { cx: number; cy: number; pinch?: number; scale?: number; flex?: number }): Landmark[] {
  const { cx, cy, pinch = 0, scale = 0.08, flex = 0 } = opts;
  const pts: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const set = (i: number, dx: number, dy: number) => (pts[i] = { x: cx + dx * scale, y: cy + dy * scale, z: 0 });
  set(0, 0, 1.1); // wrist
  set(5, -0.5, 0); // index MCP
  set(9, -0.15, -0.05);
  set(13, 0.2, -0.03);
  set(17, 0.5, 0.05); // pinky MCP
  // Fingertips above their MCP joints; flexing folds them down towards the knuckles.
  set(8, -0.55, -0.9 + 0.8 * flex);
  set(12, -0.15, -1.0 + 0.85 * flex);
  set(16, 0.2, -0.9 + 0.8 * flex);
  // Thumb tip moves towards the index tip as pinch grows.
  const open = { dx: -1.4, dy: -0.2 };
  const closed = { dx: -0.55, dy: -0.88 };
  set(4, open.dx + (closed.dx - open.dx) * pinch, open.dy + (closed.dy - open.dy) * pinch);
  return pts;
}

/** Synthetic hand whose palm centre lands exactly on (px, py) in unmirrored image coordinates. */
export function handAtPalm(px: number, py: number, pinch = 0, scale = 0.08, flex = 0): Landmark[] {
  const hand = syntheticHand({ cx: 0, cy: 0, pinch, scale, flex });
  const ids = [0, 5, 9, 13, 17];
  const mx = ids.reduce((s, i) => s + hand[i]!.x, 0) / ids.length;
  const my = ids.reduce((s, i) => s + hand[i]!.y, 0) / ids.length;
  return hand.map((p) => ({ x: p.x - mx + px, y: p.y - my + py, z: 0 }));
}
