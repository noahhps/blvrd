import { test } from "node:test";
import assert from "node:assert/strict";

import { SHAPES, shapeOf } from "../src/lib/agents.js";
import { PRESETS } from "../src/lib/presets.js";

const ids = new Set(SHAPES.map((s) => s.id));

test("an agent's own character wins", () => {
  assert.equal(shapeOf({ shape: "book" }, "Researcher"), "book");
});

test("a name that says what the agent does picks the character that does it", () => {
  assert.equal(shapeOf(null, "Researcher"), "magnifier");
  assert.equal(shapeOf(null, "Copy editor"), "pencil");
  assert.equal(shapeOf(null, "Week planner"), "calendar");
  assert.equal(shapeOf(null, "Inbox helper"), "envelope");
  assert.equal(shapeOf({ shape: "not-a-shape" }, "Coder"), "laptop");
});

test("any other name gets a character of its own, the same every time", () => {
  const first = shapeOf(null, "Juniper");
  assert.ok(ids.has(first));
  assert.equal(shapeOf(null, "Juniper"), first);
  assert.ok(ids.has(shapeOf(null, "")));
  assert.ok(ids.has(shapeOf(undefined)));
});

test("every preset wears a character that exists", () => {
  for (const preset of PRESETS) assert.ok(ids.has(preset.look.shape), preset.id);
});
