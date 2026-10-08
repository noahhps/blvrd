import { test } from "node:test";
import assert from "node:assert/strict";

import { MEMORY_LIMIT, MEMORY_TOOLS, editMemory, memoryBrief, memoryNow, migrateNotes, readMemory, redoMemory, removeMemory, template, undoMemory, writeMemory } from "../src/lib/agentMemory.js";
import { systemFor } from "../src/lib/run.js";

const tool = MEMORY_TOOLS.find((t) => t.name === "my_memory");

test("append goes under its heading (made if missing), or at the end", () => {
  const start = template("Planner");
  const one = editMemory(start, { action: "append", heading: "Learned", text: "Prefers footnotes" });
  assert.match(one, /## Learned\n- Prefers footnotes\n?$/);
  const two = editMemory(one, { action: "append", heading: "in progress", text: "Lisbon trip: hotel still open" });
  assert.match(two, /## In progress\n- Lisbon trip: hotel still open\n\n## Learned/);
  const three = editMemory(two, { action: "append", heading: "Habits", text: "- Short answers" });
  assert.match(three, /## Habits\n- Short answers\n$/);
});

test("revise changes words found exactly once; remove takes out the one line that has them", () => {
  const text = "# M\n\n- Likes tea\n- Likes long walks\n";
  assert.equal(editMemory(text, { action: "revise", old: "tea", new: "coffee" }), "# M\n\n- Likes coffee\n- Likes long walks\n");
  assert.throws(() => editMemory(text, { action: "revise", old: "Likes", new: "x" }), /2 times/);
  assert.equal(editMemory(text, { action: "remove", text: "walks" }), "# M\n\n- Likes tea\n");
  assert.throws(() => editMemory(text, { action: "remove", text: "Likes" }), /2 lines/);
  assert.throws(() => editMemory(text, { action: "shout" }), /append, revise, remove or read/);
});

test("the agent's tool reads and writes its own file, and every save can be undone", async () => {
  const ctx = { agentId: "agt_1", agentName: "Planner" };
  assert.equal(await readMemory("agt_1", "Planner"), template("Planner"));
  assert.match(await tool.run({ action: "append", heading: "Learned", text: "Wants citations as footnotes" }, ctx), /Saved\. Your memory is \d+ characters\./);
  assert.match(await tool.run({ action: "read", query: "footnotes" }, ctx), /^- Wants citations as footnotes$/);
  await tool.run({ action: "revise", old: "footnotes", new: "links" }, ctx);
  assert.match(memoryNow("agt_1"), /citations as links/);

  await undoMemory("agt_1");
  assert.match(memoryNow("agt_1"), /citations as footnotes/);
  await redoMemory("agt_1");
  assert.match(memoryNow("agt_1"), /citations as links/);

  // Deleted with its agent, and back with the undo.
  const back = await removeMemory("agt_1");
  assert.equal(await readMemory("agt_1", "Planner"), template("Planner"));
  await back();
  assert.match(await readMemory("agt_1", "Planner"), /citations as links/);
});

test("old notes move into MEMORY.md under Learned", async () => {
  await migrateNotes("agt_2", "Friend", [{ text: "Has a dog called Biscuit", at: Date.UTC(2026, 3, 2) }, { text: "Vegetarian" }]);
  const text = await readMemory("agt_2", "Friend");
  assert.match(text, /## Learned\n- Has a dog called Biscuit \(2026-04-02\)\n- Vegetarian/);
});

test("the memory goes into the system prompt after the instructions, with a nudge when it's too long", async () => {
  const agent = { name: "Planner", instructions: "Plan trips." };
  await writeMemory("agt_3", "# Planner's memory\n- Window seats");
  const system = systemFor(agent, [], "", memoryNow("agt_3"));
  assert.ok(system.indexOf("Plan trips.") < system.indexOf("Your own memory (MEMORY.md)"));
  assert.match(system, /- Window seats/);
  assert.match(memoryBrief("x".repeat(MEMORY_LIMIT + 1)), /over its \d+: tidy it/);
  assert.equal(memoryBrief(""), "");
});
