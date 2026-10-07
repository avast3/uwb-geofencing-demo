// Ground-truth motion for a simulated mobile plant (semi-truck): straight
// runs up/down/left/right with short pauses, always keeping the truck body
// inside the site. Pure functions with no React or DOM so the behaviour is
// easy to test; App/usePlantSimulation own the timing loop.
//
// Only `import type` here: Node's test runner strips types but can't
// resolve the app's other modules' extensionless imports.

import type { PlantHeading } from "../types";

export type Direction = "up" | "down" | "left" | "right";

export interface SiteBounds {
  width: number;
  height: number;
}

export interface PlantMotion {
  x: number;
  y: number;
  direction: Direction;
  /** Metres left in the current straight run; 0 = choose a new one. */
  remainingM: number;
  /** Seconds left in the current pause. */
  pauseS: number;
}

// Must match BODY_LENGTH_M / BODY_WIDTH_M in backend/app/plants.py.
export const BODY_LENGTH_M = 1.6;
export const BODY_WIDTH_M = 0.7;
export const PLANT_SPEED_MPS = 1.0;
const SEGMENT_MIN_M = 1;
const SEGMENT_MAX_M = 3;
const MIN_USEFUL_RUN_M = 0.2;
const PAUSE_MIN_S = 0.5;
const PAUSE_MAX_S = 1.5;

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

export function headingFor(direction: Direction): PlantHeading {
  return direction === "left" || direction === "right" ? "horizontal" : "vertical";
}

function halfExtents(heading: PlantHeading): { hx: number; hy: number } {
  return heading === "horizontal"
    ? { hx: BODY_LENGTH_M / 2, hy: BODY_WIDTH_M / 2 }
    : { hx: BODY_WIDTH_M / 2, hy: BODY_LENGTH_M / 2 };
}

function clampValue(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function clampPlacement(
  x: number,
  y: number,
  heading: PlantHeading,
  bounds: SiteBounds
): { x: number; y: number } {
  const { hx, hy } = halfExtents(heading);
  return { x: clampValue(x, hx, bounds.width - hx), y: clampValue(y, hy, bounds.height - hy) };
}

export function initialMotion(x: number, y: number): PlantMotion {
  return { x, y, direction: "right", remainingM: 0, pauseS: 0 };
}

// How far the truck could drive in `direction` from (x, y), or -1 if it
// can't even turn to face that way without its body leaving the site.
function maxRun(x: number, y: number, direction: Direction, bounds: SiteBounds): number {
  const { hx, hy } = halfExtents(headingFor(direction));
  const eps = 1e-9;
  if (x - hx < -eps || x + hx > bounds.width + eps || y - hy < -eps || y + hy > bounds.height + eps) return -1;
  switch (direction) {
    case "up":
      return bounds.height - hy - y;
    case "down":
      return y - hy;
    case "left":
      return x - hx;
    case "right":
      return bounds.width - hx - x;
  }
}

export function stepPlant(
  m: PlantMotion,
  dtS: number,
  bounds: SiteBounds,
  random: () => number = Math.random
): PlantMotion {
  if (m.pauseS > 0) {
    return { ...m, pauseS: Math.max(0, m.pauseS - dtS) };
  }

  let next = m;
  if (next.remainingM <= 0) {
    const options = DIRECTIONS.map((d) => ({ d, run: maxRun(next.x, next.y, d, bounds) })).filter(
      (o) => o.run >= MIN_USEFUL_RUN_M
    );
    if (options.length === 0) {
      return { ...next, pauseS: PAUSE_MIN_S };
    }
    const choice = options[Math.floor(random() * options.length) % options.length];
    const wanted = SEGMENT_MIN_M + random() * (SEGMENT_MAX_M - SEGMENT_MIN_M);
    next = { ...next, direction: choice.d, remainingM: Math.min(wanted, choice.run) };
  }

  const d = Math.min(next.remainingM, PLANT_SPEED_MPS * dtS);
  const dx = next.direction === "right" ? d : next.direction === "left" ? -d : 0;
  const dy = next.direction === "up" ? d : next.direction === "down" ? -d : 0;
  const remainingM = next.remainingM - d <= 1e-9 ? 0 : next.remainingM - d;
  const pauseS = remainingM === 0 ? PAUSE_MIN_S + random() * (PAUSE_MAX_S - PAUSE_MIN_S) : 0;
  return { ...next, x: next.x + dx, y: next.y + dy, remainingM, pauseS };
}
