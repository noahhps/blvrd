import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, changedBy, notebook } from "../src/lib/notebook.js";
import { NOTEBOOK_TOOLS, notebookBrief } from "../src/lib/notebookTools.js";

const facts = { title: "About", type: "facts", data: { rows: [{ key: "Birthday", value: "14 March" }] } };
const list = { title: "Gift ideas", type: "list", data: { items: [{ id: "a", text: "Film camera", done: false }] } };
const note = { title: "Work", type: "note", data: { text: "Mornings are for deep work." } };

test("facts: set adds or replaces by label (any case), remove drops it", () => {
  assert.deepEqual(apply(facts, { action: "set", key: "birthday", value: "15 March" }).rows, [{ key: "Birthday", value: "15 March" }]);
  assert.equal(apply(facts, { action: "set", key: "Shirt", value: "M" }).rows.length, 2);
  assert.deepEqual(apply(facts, { action: "remove", key: "BIRTHDAY" }).rows, []);
  assert.throws(() => apply(facts, { action: "remove", key: "Shoe" }), /no “Shoe”/);
  assert.throws(() => apply(facts, { action: "set", key: "Shirt" }), /needs value/);
});

test("list: add, check, uncheck, remove; no duplicates", () => {
  assert.equal(apply(list, { action: "add", item: "Vinyl" }).items.length, 2);
  assert.throws(() => apply(list, { action: "add", item: "film camera" }), /already/);
  assert.equal(apply(list, { action: "check", item: "Film camera" }).items[0].done, true);
  assert.deepEqual(apply(list, { action: "remove", item: "Film camera" }).items, []);
});

test("note: append adds a paragraph, replace swaps the text", () => {
  assert.equal(apply(note, { action: "append", text: "No meetings Fridays." }).text, "Mornings are for deep work.\n\nNo meetings Fridays.");
  assert.equal(apply(note, { action: "replace", text: "  New.  " }).text, "New.");
});

test("an action that doesn't fit the section says which do", () => {
  assert.throws(() => apply(note, { action: "add", item: "x" }), /use replace, append/);
});

test("an agent hears who changed a section only after someone else did", () => {
  const nameOf = (id) => ({ planner: "Planner" })[id];
  const s = { version: 3, edited: { by: "planner", at: 1 }, seen: { researcher: 2 } };
  assert.equal(changedBy(s, "researcher", nameOf), "Planner (another assistant)");
  assert.equal(changedBy({ ...s, seen: { researcher: 3 } }, "researcher", nameOf), null);
  assert.equal(changedBy(s, "planner", nameOf), null);
  assert.equal(changedBy({ ...s, edited: { by: "user" } }, "researcher", nameOf), "the user");
});

test("through the tools: read, edit, and finding out about another writer", async () => {
  const tool = (name) => NOTEBOOK_TOOLS.find((t) => t.name === name);
  const nameOf = (id) => ({ planner: "Planner", researcher: "Researcher" })[id];
  const asResearcher = { agentId: "researcher", nameOf };
  const asPlanner = { agentId: "planner", nameOf };
  const section = notebook.add("list", "Places to try");

  // The researcher reads it; the user made it, which it is told the first time.
  assert.match(await tool("notebook_read").run({ section: "places to try" }, asResearcher), /the user changed it/);
  assert.doesNotMatch(await tool("notebook_read").run({ section: "Places to try" }, asResearcher), /changed it/);

  // The planner adds to it; the researcher, reading again, learns of the planner.
  await tool("notebook_edit").run({ section: "Places to try", action: "add", item: "Nopa" }, asPlanner);
  const read = await tool("notebook_read").run({ section: "Places to try" }, asResearcher);
  assert.match(read, /Planner \(another assistant\) changed it/);
  assert.match(read, /\[ \] Nopa/);

  // Its own edit isn't news to it.
  const own = await tool("notebook_edit").run({ section: "Places to try", action: "check", item: "Nopa" }, asResearcher);
  assert.doesNotMatch(own, /changed it/);
  assert.match(own, /\[x\] Nopa/);

  // Approval follows the switch, read at the moment of the call.
  assert.equal(tool("notebook_edit").confirm, false);
  notebook.setApprove(true);
  assert.equal(tool("notebook_edit").confirm, true);
  notebook.setApprove(false);

  await assert.rejects(tool("notebook_read").run({ section: "Nowhere" }, asResearcher), /no section “Nowhere” -- the sections are .*“Places to try”/);
  assert.match(notebookBrief(), /Places to try \(list\)/);
  notebook.remove(section.id);
});

test("free text on the page goes by its first line, and agents can add to it", async () => {
  const { textTitle } = await import("../src/lib/notebook.js");
  assert.equal(textTitle("  Plan for Saturday\nbrunch then hike"), "Plan for Saturday");
  assert.equal(textTitle(""), "Text");
  const made = notebook.add("text", null, undefined, { text: "Things I keep forgetting" });
  assert.equal(made.title, "Things I keep forgetting");
  notebook.edit(made.id, "a1", { action: "replace", text: "Remember the bins on Tuesday" });
  assert.equal(notebook.get().sections.find((s) => s.id === made.id).title, "Remember the bins on Tuesday");
  notebook.remove(made.id);
});
