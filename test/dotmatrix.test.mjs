import assert from "node:assert/strict";
import { test } from "node:test";

import { cellsFor, halftone } from "../src/lib/dotmatrix.js";

// A square of `tone` in the middle of an n x n grid.
function block(n, tone) {
  const cells = new Float32Array(n * n);
  for (let j = 4; j < n - 4; j++) for (let i = 4; i < n - 4; i++) cells[j * n + i] = tone;
  return cells;
}
const count = (d) => (d.match(/M/g) || []).length;

test("a cell every 2px, every 2.5px when large, never fewer than 12", () => {
  assert.equal(cellsFor(34), 17);
  assert.equal(cellsFor(96), 38);
  assert.equal(cellsFor(14), 12);
});

test("uesc: solid parts print as runs, the body with dots knocked out", () => {
  const solid = halftone(block(16, 1), 16, "uesc");
  assert.equal(count(solid.ink), 8); // one run per row
  assert.equal(solid.holes, "");
  const body = halftone(block(16, 0.72), 16, "uesc");
  assert.equal(count(body.ink), 8);
  assert.ok(count(body.holes) > 0);
});

test("uesc: strays only around the shell, the same each time", () => {
  const one = halftone(block(20, 1), 20, "uesc", 3);
  assert.equal(halftone(block(20, 1), 20, "uesc", 3).noise, one.noise);
  assert.equal(halftone(new Float32Array(400), 20, "uesc", 3).ink, "");
});

test("sekiguchi: an outline of pixels, the body in a checker, nothing knocked out", () => {
  const n = 16;
  const body = halftone(block(n, 0.72), n, "sekiguchi");
  const solid = halftone(block(n, 1), n, "sekiguchi");
  assert.equal(count(solid.ink), 64);
  assert.ok(count(body.ink) > 28 && count(body.ink) < 64); // the 28 round the edge, half the rest
  assert.equal(body.holes, "");
  assert.equal(body.noise, "");
});
