import { test } from "node:test";
import assert from "node:assert/strict";

import { GAP, GRID, WIDGET, freeSpot, packRows, snap } from "../src/lib/placement.js";

// Two widgets' worth of cells, and one widget.
const calendar = { x: 0, y: 0, w: WIDGET, h: 192 };
const size = { w: WIDGET, h: 96 };

test("the table: small cells close together, widgets a whole number of them wide", () => {
  assert.equal(GRID, 24);
  assert.equal(WIDGET % GRID, 0);
  assert.equal(snap(35), 24);
  assert.equal(snap(37), 48);
  assert.equal(snap(-30), 0);
});

test("an open spot is used as dropped, on the cell under it", () => {
  assert.deepEqual(freeSpot({ x: 410, y: 30 }, size, [calendar]), { x: 408, y: 24 });
});

test("a drop on top of something goes to the nearest open cell beside it", () => {
  // Over the calendar's right side: the next free column.
  assert.deepEqual(freeSpot({ x: 250, y: 10 }, size, [calendar]), { x: WIDGET + GAP, y: 0 });
  // Over its lower part: the rows just below it.
  assert.deepEqual(freeSpot({ x: 20, y: 150 }, size, [calendar]), { x: 24, y: 192 + GAP });
});

test("nothing it settles in overlaps what's there, with a cell kept between", () => {
  const others = [calendar, { x: WIDGET + GAP, y: 0, w: WIDGET, h: 192 }, { x: 0, y: 216, w: WIDGET, h: 120 }];
  for (const want of [{ x: 100, y: 100 }, { x: 330, y: 50 }, { x: 10, y: 230 }]) {
    const p = freeSpot(want, size, others);
    assert.equal(p.x % GRID, 0);
    assert.equal(p.y % GRID, 0);
    for (const o of others) {
      const apart = p.x >= o.x + o.w + GAP || o.x >= p.x + size.w + GAP || p.y >= o.y + o.h + GAP || o.y >= p.y + size.h + GAP;
      assert.ok(apart, `${JSON.stringify(p)} overlaps ${JSON.stringify(o)}`);
    }
  }
});

test("first layout: rows of same-width widgets, wrapping at the width, a cell between", () => {
  const spots = packRows([{ w: WIDGET, h: 200 }, { w: WIDGET, h: 80 }, { w: WIDGET, h: 120 }], 700, 0);
  assert.deepEqual(spots, [
    { x: 0, y: 0 },
    { x: WIDGET + GAP, y: 0 },
    { x: 0, y: snap(200 + GAP) },
  ]);
});

import { pushDown } from "../src/lib/placement.js";

test("a widget that grew pushes down only what it runs into", () => {
  const moved = pushDown([
    { id: "list", x: 0, y: 0, w: WIDGET, h: 300 }, // grew from 100 to 300
    { id: "below", x: 0, y: 144, w: WIDGET, h: 96 }, // in its column: pushed
    { id: "under", x: 0, y: 264, w: WIDGET, h: 48 }, // below that: pushed on in turn
    { id: "beside", x: WIDGET + GAP, y: 144, w: WIDGET, h: 96 }, // other column: stays
  ]);
  assert.deepEqual(moved, { below: { x: 0, y: 336 }, under: { x: 0, y: 456 } });
  assert.deepEqual(pushDown([{ id: "a", x: 0, y: 0, w: 10, h: 10 }, { id: "b", x: 0, y: 48, w: 10, h: 10 }]), {});
});

test("first layout keeps columns even when something narrow comes first", () => {
  const spots = packRows([{ w: 160, h: 30 }, { w: WIDGET, h: 100 }, { w: WIDGET, h: 100 }], 2000, 0);
  assert.deepEqual(spots.map((p) => p.x), [0, WIDGET + GAP, 2 * (WIDGET + GAP)]);
});
