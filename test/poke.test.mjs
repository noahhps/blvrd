import { test } from "node:test";
import assert from "node:assert/strict";

import { EGG_ODDS, PESTERED, pokeReaction } from "../src/lib/poke.js";

test("one poke in ten thousand is a backflip", () => {
  assert.equal(EGG_ODDS, 1 / 10000);
  assert.equal(pokeReaction({ roll: 0 }), "backflip");
  assert.equal(pokeReaction({ roll: EGG_ODDS - 1e-9 }), "backflip");
  assert.notEqual(pokeReaction({ roll: EGG_ODDS }), "backflip");
});

test("the egg wins even when it's being pestered", () => {
  assert.equal(pokeReaction({ roll: 0, recent: PESTERED + 3 }), "backflip");
});

test("poked too often in a row, it huffs", () => {
  assert.equal(pokeReaction({ roll: 0.5, recent: PESTERED }), "huff");
  assert.notEqual(pokeReaction({ roll: 0.5, recent: PESTERED - 1 }), "huff");
});

test("an ordinary poke is never the same reaction twice running", () => {
  for (const last of ["boop", "hop", "giggle"]) {
    for (const pick of [0, 0.3, 0.6, 0.999999, 1]) {
      const kind = pokeReaction({ roll: 0.5, pick, last });
      assert.ok(["boop", "hop", "giggle"].includes(kind));
      assert.notEqual(kind, last);
    }
  }
});
