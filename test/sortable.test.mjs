import { test } from "node:test";
import assert from "node:assert/strict";

import { moveTo, slotFor } from "../src/lib/sortable.js";

test("moveTo takes one out and puts it back at the new place", () => {
  assert.deepEqual(moveTo(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveTo(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveTo(["a", "b"], 1, 1), ["a", "b"]);
});

// Four pieces of uneven height, 16px apart.
const boxes = [
  { top: 0, height: 200 },
  { top: 216, height: 100 },
  { top: 332, height: 60 },
  { top: 408, height: 40 },
];

test("slotFor lands past every middle the piece's centre has crossed", () => {
  assert.equal(slotFor(boxes, 0, 100), 0);
  assert.equal(slotFor(boxes, 0, 265), 0);
  assert.equal(slotFor(boxes, 0, 267), 1);
  assert.equal(slotFor(boxes, 0, 500), 3);
  assert.equal(slotFor(boxes, 3, 361), 2);
  assert.equal(slotFor(boxes, 3, -50), 0);
});
