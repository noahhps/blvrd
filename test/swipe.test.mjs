/* How a swiped row moves and decides (lib/swipe.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { OPEN, REACH, THRESHOLD, resist, settleTo, spring, springFor, unresist } from "../src/lib/swipe.js";

test("letting go opens, compacts or closes by where the swipe was heading", () => {
  assert.equal(settleTo(-40, -900), "open"); // a quick flick left, short of the threshold
  assert.equal(settleTo(-50, 0), "close"); // let go midway
  assert.equal(settleTo(-(THRESHOLD + 10), 0), "open"); // past it, held still: stays out, not deleted
  assert.equal(settleTo(-(THRESHOLD + 30), 700), "close"); // past it, but swiped back right
  assert.equal(settleTo(THRESHOLD + 10, 0), "right");
  assert.equal(settleTo(THRESHOLD + 30, -800), "close");
  assert.equal(settleTo(THRESHOLD + 10, 0, { rightDisabled: true }), "close");
});

test("an open row stays open unless it is moved back past halfway", () => {
  assert.equal(settleTo(-OPEN, 0, { open: true }), "open");
  assert.equal(settleTo(-OPEN + 20, 0, { open: true }), "open");
  assert.equal(settleTo(-OPEN / 2 + 5, 0, { open: true }), "close");
  assert.equal(settleTo(-OPEN + 10, 600, { open: true }), "close"); // flicked back right
  assert.equal(settleTo(40, 0, { open: true }), "close"); // never compacts from open
});

test("the row follows freely, then rubber-bands, giving less the further it goes", () => {
  assert.equal(resist(REACH - 10, 260), REACH - 10);
  const a = resist(REACH + 50, 260) - REACH;
  const b = resist(REACH + 100, 260) - resist(REACH + 50, 260);
  assert.ok(a < 50 && b < a, `${a}, ${b}`);
  assert.equal(resist(-(REACH + 50), 260), -resist(REACH + 50, 260));
});

const run = (x, v, options) => {
  const motion = spring(x, v, options);
  const path = [];
  for (let i = 0; i < 240; i++) {
    const step = motion.advance(1 / 60);
    path.push(step.x);
    if (step.done) return { path, frames: i + 1 };
  }
  return { path, frames: Infinity };
};

test("after a plain drag it settles home without overshooting, in about half a second", () => {
  const { path, frames } = run(90, 0, springFor(0));
  assert.ok(path.every((x) => x >= 0), "never crosses to the other side");
  assert.ok(frames < 45, `${frames} frames`);
});

test("after a flick it carries the finger's speed on, then comes home with a little give", () => {
  const { path, frames } = run(60, 1500, springFor(1500));
  assert.ok(path[0] > 60, "keeps going the way it was thrown before turning");
  assert.ok(Math.min(...path) < 0, "overshoots home a little");
  assert.ok(Math.min(...path) > -15, `but only a little: ${Math.min(...path)}`);
  assert.ok(frames < 90, `${frames} frames`);
});

test("the spring is the same at 60 and 120 frames a second", () => {
  const at = (fps) => {
    const motion = spring(80, 0, springFor(0));
    let x = 80;
    for (let t = 0; t < 0.2; t += 1 / fps) x = motion.advance(1 / fps).x;
    return x;
  };
  assert.ok(Math.abs(at(60) - at(120)) < 1);
});

test("a gesture caught out in the rubber band carries on from where the row shows", () => {
  for (const x of [0, 40, -90, REACH + 20, -(REACH + 60)]) {
    assert.ok(Math.abs(resist(unresist(x, 260), 260) - x) < 1e-6, `${x}`);
  }
});
