import { test } from "node:test";
import assert from "node:assert/strict";

import { FORMATIONS, formation } from "../src/lib/formations.js";

test("every formation places every dot, inside the box, for 2 to 12 dots", () => {
  for (let n = 2; n <= 12; n++) {
    FORMATIONS.forEach((f, i) => {
      const points = formation(i, n);
      assert.equal(points.length, n, `${f.id} with ${n}`);
      for (const [x, y] of points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${f.id} with ${n}: not a number`);
        assert.ok(Math.abs(x) <= 1.001 && Math.abs(y) <= 1.001, `${f.id} with ${n}: (${x}, ${y}) outside`);
      }
    });
  }
});

test("the ring starts at the top and formations wrap", () => {
  const [first] = formation(0, 4);
  assert.ok(Math.abs(first[0]) < 1e-9 && Math.abs(first[1] + 1) < 1e-9);
  assert.deepEqual(formation(FORMATIONS.length, 5), formation(0, 5));
  assert.deepEqual(formation(-1, 5), formation(FORMATIONS.length - 1, 5));
});

test("no two dots of a formation sit on top of each other", () => {
  for (let n = 2; n <= 12; n++) {
    FORMATIONS.forEach((f, i) => {
      const points = formation(i, n);
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) {
          const d = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
          assert.ok(d > 0.05, `${f.id} with ${n}: dots ${a} and ${b} overlap`);
        }
    });
  }
});
