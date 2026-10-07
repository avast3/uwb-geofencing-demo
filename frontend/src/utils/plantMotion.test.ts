import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_LENGTH_M,
  BODY_WIDTH_M,
  clampPlacement,
  headingFor,
  initialMotion,
  stepPlant,
} from "./plantMotion.ts";
import type { PlantMotion, SiteBounds } from "./plantMotion.ts";

const SITE: SiteBounds = { width: 8, height: 6 };

// Small deterministic PRNG so tests are repeatable.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bodyInside(m: PlantMotion): boolean {
  const vertical = headingFor(m.direction) === "vertical";
  const hx = (vertical ? BODY_WIDTH_M : BODY_LENGTH_M) / 2;
  const hy = (vertical ? BODY_LENGTH_M : BODY_WIDTH_M) / 2;
  const eps = 1e-9;
  return m.x - hx >= -eps && m.x + hx <= SITE.width + eps && m.y - hy >= -eps && m.y + hy <= SITE.height + eps;
}

test("headingFor maps directions to headings", () => {
  assert.equal(headingFor("left"), "horizontal");
  assert.equal(headingFor("right"), "horizontal");
  assert.equal(headingFor("up"), "vertical");
  assert.equal(headingFor("down"), "vertical");
});

function assertPoint(actual: { x: number; y: number }, x: number, y: number) {
  assert.ok(Math.abs(actual.x - x) < 1e-9 && Math.abs(actual.y - y) < 1e-9, JSON.stringify(actual));
}

test("clampPlacement nudges a corner click so the body is inside", () => {
  assertPoint(clampPlacement(0, 0, "horizontal", SITE), 0.8, 0.35);
  assertPoint(clampPlacement(8, 6, "vertical", SITE), 7.65, 5.2);
  assertPoint(clampPlacement(4, 3, "horizontal", SITE), 4, 3);
});

test("only moves in straight lines along one axis per step", () => {
  const random = seeded(1);
  let m = initialMotion(4, 3);
  for (let i = 0; i < 2000; i++) {
    const next = stepPlant(m, 0.05, SITE, random);
    const movedX = Math.abs(next.x - m.x) > 1e-12;
    const movedY = Math.abs(next.y - m.y) > 1e-12;
    assert.ok(!(movedX && movedY), `diagonal move at step ${i}`);
    m = next;
  }
});

test("never leaves the site, across many seeds and long runs", () => {
  for (let seed = 0; seed < 25; seed++) {
    const random = seeded(seed);
    const start = clampPlacement(seed % 8, seed % 6, "horizontal", SITE);
    let m = initialMotion(start.x, start.y);
    for (let i = 0; i < 3000; i++) {
      m = stepPlant(m, 0.05, SITE, random);
      assert.ok(bodyInside(m), `seed ${seed} step ${i} outside: ${JSON.stringify(m)}`);
    }
  }
});

test("skips turns that don't fit: horizontal truck near the top never turns vertical in place", () => {
  // Body half-length when vertical is 0.8 m; at y = 5.6 a vertical body would poke out the top.
  const start: PlantMotion = { x: 4, y: 5.6, direction: "right", remainingM: 0, pauseS: 0 };
  for (let seed = 0; seed < 50; seed++) {
    const next = stepPlant(start, 0.05, SITE, seeded(seed));
    assert.equal(headingFor(next.direction), "horizontal");
  }
});

test("moves at 1 m/s and pauses after finishing a segment", () => {
  const random = seeded(7);
  let m = stepPlant(initialMotion(4, 3), 0.0001, SITE, random); // picks a segment
  const segment = m.remainingM;
  assert.ok(segment >= 0.2 && segment <= 3);
  m = stepPlant(m, 0.5, SITE, random);
  assert.ok(Math.abs(segment - m.remainingM - 0.5) < 1e-9);
  m = stepPlant(m, 10, SITE, random); // finishes the segment
  assert.equal(m.remainingM, 0);
  assert.ok(m.pauseS >= 0.5 && m.pauseS <= 1.5);
  const paused = stepPlant(m, 0.1, SITE, random);
  assert.equal(paused.x, m.x);
  assert.equal(paused.y, m.y);
});
