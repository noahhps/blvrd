import assert from "node:assert/strict";
import { test } from "node:test";

import { FACTIONS } from "../src/lib/callsigns.js";
import { cellsFor, halftone, haloDiamonds } from "../src/lib/dotmatrix.js";
import { UNNAMED, emblemOf } from "../src/lib/emblems/index.js";
import { SEKIGUCHI } from "../src/lib/emblems/sekiguchi.js";
import { UESC } from "../src/lib/emblems/uesc.js";

// A square of `tone` in the middle of an n x n grid.
function block(n, tone) {
  const cells = new Float32Array(n * n);
  for (let j = 4; j < n - 4; j++) for (let i = 4; i < n - 4; i++) cells[j * n + i] = tone;
  return cells;
}
const count = (d) => (d.match(/M/g) || []).length;

test("a cell every 1.5px, 20 to 64 of them", () => {
  assert.equal(cellsFor(42), 28);
  assert.equal(cellsFor(96), 64);
  assert.equal(cellsFor(14), 20);
  assert.equal(cellsFor(200), 64);
});

test("uesc: solid parts print as runs, the body with dots knocked out", () => {
  const solid = halftone(block(16, 1), 16, "uesc");
  assert.equal(count(solid.ink), 8); // one run per row
  assert.equal(solid.holes, "");
  const body = halftone(block(16, 0.72), 16, "uesc");
  assert.equal(count(body.ink), 8);
  assert.ok(count(body.holes) > 0);
});

test("uesc: strays only around the mass and on the streaks, the same each time", () => {
  const one = halftone(block(20, 1), 20, "uesc", 3);
  assert.equal(halftone(block(20, 1), 20, "uesc", 3).noise, one.noise);
  assert.equal(halftone(new Float32Array(400), 20, "uesc", 3).ink, "");
});

test("sekiguchi: an outline of pixels, the body in a checker, nothing knocked out", () => {
  const n = 16;
  const body = halftone(block(n, 0.72), n, "sekiguchi");
  assert.equal(count(halftone(block(n, 1), n, "sekiguchi").ink), 64);
  assert.ok(count(body.ink) > 28 && count(body.ink) < 64); // the 28 round the edge, half the rest
  assert.equal(body.holes + body.noise, "");
});

test("the halo: seven diamonds round its centre, never under a cell and a half", () => {
  const ring = haloDiamonds({ x: 50, y: 30, r: 14 }, 28);
  assert.equal(ring.length, 7);
  for (const d of ring) {
    assert.ok(Math.abs(Math.hypot(d.cx - 14, d.cy - 8.4) - 3.92) < 0.02);
    assert.ok(d.s >= 1.5);
  }
});

test("an emblem by callsign, its tag aside; the unnamed one for a stranger", () => {
  assert.equal(emblemOf("dark", "KEPLER"), null);
  assert.equal(emblemOf("hazard", ""), null);
  assert.equal(emblemOf("hazard", "NOBODY"), UNNAMED);
  assert.equal(emblemOf("hazard", "TIZONA-42"), UESC.TIZONA || UNNAMED);
});

test("every UESC and Sekiguchi callsign has a well-formed emblem of its own", () => {
  for (const [look, set] of [["hazard", UESC], ["sekiguchi", SEKIGUCHI]]) {
    for (const name of [...FACTIONS[look].roles, ...FACTIONS[look].spares]) {
      const e = set[name];
      assert.ok(e, `${look} ${name} has no emblem`);
      assert.ok(e.subject && e.parts.length > 0, `${name}: subject and parts`);
      for (const p of e.parts) {
        assert.match(p.d, /^\s*[Mm]/, `${name}: a path starts with a move`);
        assert.ok(p.tone >= 0 && p.tone <= 1, `${name}: tone ${p.tone}`);
      }
      const { x, y, r } = e.halo;
      assert.ok(x - r >= 0 && x + r <= 100 && y - r >= 0 && y + r <= 100, `${name}: halo inside the square`);
    }
  }
});
