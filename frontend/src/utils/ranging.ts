// Simulates the UWB radio layer: turns the worker's ground-truth position
// into per-anchor range measurements, the way real UWB hardware would
// report a distance to each anchor it can hear. This is the first link in
// the chain the geofence depends on — multilateration (a later stage)
// reconstructs an estimated position from exactly these numbers, it never
// sees the ground-truth position directly.

import type { AnchorInfo } from "../types";
import type { MetrePoint } from "./coordinateTransform";

// Small by design — the spec calls for "small, around +/-0.05 m", not a
// realistic multipath/NLOS error model. Uniform rather than Gaussian so
// the error is a hard, easily explained bound rather than a distribution
// with unbounded tails.
export const RANGE_NOISE_BOUND_M = 0.05;

export interface AnchorRange {
  anchorId: string;
  /** Straight-line distance from this anchor to the worker, in metres. */
  distance: number;
}

function uniformNoise(boundM: number): number {
  return (Math.random() * 2 - 1) * boundM;
}

/**
 * Computes one simulated range per active anchor.
 *
 * distance = sqrt((workerX - anchorX)^2 + (workerY - anchorY)^2)
 *
 * Inactive anchors (per the anchor on/off fault demo) are omitted
 * entirely, the same way a real anchor that's powered off simply
 * contributes no measurement.
 */
export function computeAnchorRanges(
  workerPosition: MetrePoint,
  anchors: AnchorInfo[],
  activeAnchorIds: ReadonlySet<string>,
  noiseEnabled: boolean
): AnchorRange[] {
  return anchors
    .filter((anchor) => activeAnchorIds.has(anchor.id))
    .map((anchor) => {
      const trueDistance = Math.hypot(workerPosition.x - anchor.xM, workerPosition.y - anchor.yM);
      const distance = noiseEnabled
        ? Math.max(0, trueDistance + uniformNoise(RANGE_NOISE_BOUND_M))
        : trueDistance;
      return { anchorId: anchor.id, distance };
    });
}
