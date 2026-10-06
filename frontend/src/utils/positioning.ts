// Reconstructs an estimated worker position from simulated UWB ranges
// (utils/ranging.ts). This is the second link in the chain: the geofence
// (a later stage) will compare THIS estimate against user-drawn zones,
// never the ground-truth position directly.

import type { AnchorInfo } from "../types";
import type { MetrePoint } from "./coordinateTransform";
import type { AnchorRange } from "./ranging";

// 2D trilateration is mathematically impossible with fewer than 3
// independent range measurements — one circle intersects another in up
// to two points, and a third range is what picks the real one.
export const MIN_ANCHORS_FOR_POSITION = 3;

interface RangedPoint {
  x: number;
  y: number;
  r: number;
}

/**
 * Linear least-squares trilateration.
 *
 * Each anchor's range gives a circle equation:
 *   (x - xi)^2 + (y - yi)^2 = ri^2
 *
 * which expands to a term that's quadratic in the unknowns (x, y).
 * Subtracting one reference anchor's equation from every other anchor's
 * equation cancels that quadratic term, leaving a linear equation in
 * (x, y) per anchor pair:
 *
 *   2(xr - xi) x + 2(yr - yi) y = ri^2 - rr^2 + (xr^2+yr^2) - (xi^2+yi^2)
 *
 * With exactly 3 anchors this is 2 linear equations in 2 unknowns —
 * exactly determined. With 4 anchors it's 3 equations in 2 unknowns —
 * overdetermined, so we solve it in the least-squares sense via the
 * normal equations (A^T A) p = A^T b, which also damps range noise
 * slightly (averaging over more measurements). Both cases reduce to the
 * same 2x2 solve below.
 *
 * Returns null when there aren't enough ranges to position at all, or
 * when the active anchors are collinear (no unique intersection).
 */
export function estimatePosition(anchors: AnchorInfo[], ranges: AnchorRange[]): MetrePoint | null {
  const points: RangedPoint[] = [];
  for (const range of ranges) {
    const anchor = anchors.find((a) => a.id === range.anchorId);
    if (anchor) points.push({ x: anchor.xM, y: anchor.yM, r: range.distance });
  }

  if (points.length < MIN_ANCHORS_FOR_POSITION) {
    return null;
  }

  // Any anchor works as the reference; the last one is as good as any.
  const ref = points[points.length - 1];
  const others = points.slice(0, -1);

  let ata00 = 0;
  let ata01 = 0;
  let ata11 = 0;
  let atb0 = 0;
  let atb1 = 0;

  for (const p of others) {
    const a0 = 2 * (ref.x - p.x);
    const a1 = 2 * (ref.y - p.y);
    const b = p.r * p.r - ref.r * ref.r + (ref.x * ref.x + ref.y * ref.y) - (p.x * p.x + p.y * p.y);

    ata00 += a0 * a0;
    ata01 += a0 * a1;
    ata11 += a1 * a1;
    atb0 += a0 * b;
    atb1 += a1 * b;
  }

  // Solve the 2x2 normal-equations system via Cramer's rule.
  const det = ata00 * ata11 - ata01 * ata01;
  if (Math.abs(det) < 1e-9) {
    return null; // anchors (nearly) collinear: no unique solution
  }

  return {
    x: (atb0 * ata11 - atb1 * ata01) / det,
    y: (ata00 * atb1 - ata01 * atb0) / det,
  };
}
