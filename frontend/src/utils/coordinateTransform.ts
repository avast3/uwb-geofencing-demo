// Converts between real-world site metres (origin bottom-left, y-up,
// matching the engineering drawing convention used throughout the spec)
// and SVG pixel coordinates (origin top-left, y-down).
//
// The site is a fixed 8m x 6m rectangle. A margin around it leaves room
// for axis labels and metre tick marks.

export const SITE_WIDTH_M = 8;
export const SITE_HEIGHT_M = 6;

export const PX_PER_METRE = 80;
export const MARGIN_PX = 56;

export const SITE_WIDTH_PX = SITE_WIDTH_M * PX_PER_METRE;
export const SITE_HEIGHT_PX = SITE_HEIGHT_M * PX_PER_METRE;

export const SVG_WIDTH = SITE_WIDTH_PX + MARGIN_PX * 2;
export const SVG_HEIGHT = SITE_HEIGHT_PX + MARGIN_PX * 2;

export interface PixelPoint {
  x: number;
  y: number;
}

export interface MetrePoint {
  x: number;
  y: number;
}

export function metresToPixels(xM: number, yM: number): PixelPoint {
  return {
    x: MARGIN_PX + xM * PX_PER_METRE,
    y: MARGIN_PX + (SITE_HEIGHT_M - yM) * PX_PER_METRE,
  };
}

export function pixelsToMetres(xPx: number, yPx: number): MetrePoint {
  return {
    x: (xPx - MARGIN_PX) / PX_PER_METRE,
    y: SITE_HEIGHT_M - (yPx - MARGIN_PX) / PX_PER_METRE,
  };
}

export function metresLengthToPixels(lengthM: number): number {
  return lengthM * PX_PER_METRE;
}

export function pixelsLengthToMetres(lengthPx: number): number {
  return lengthPx / PX_PER_METRE;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampToSite(point: MetrePoint): MetrePoint {
  return {
    x: clamp(point.x, 0, SITE_WIDTH_M),
    y: clamp(point.y, 0, SITE_HEIGHT_M),
  };
}

// Smallest zone dimension (metres) allowed, so an accidental click
// doesn't create a degenerate zero-size zone.
export const MIN_ZONE_SIZE_M = 0.2;
