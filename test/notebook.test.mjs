import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, notebook, ready, textTitle } from "../src/lib/notebook.js";

const facts = { title: "About", type: "facts", data: { rows: [{ id: "r1", key: "Birthday", value: "14 March" }] } };
const list = { title: "Gift ideas", type: "list", data: { items: [{ id: "a", text: "Film camera", done: false }] } };
const note = { title: "Work", type: "note", data: { text: "Mornings are for deep work." } };

notebook.setSaveDelay(null); // these tests save by hand
const sectionNow = (id) => notebook.get().sections.find((s) => s.id === id);
const headNow = (id) => notebook.head().sections.find((s) => s.id === id);

test("facts: set adds or replaces by label (any case), keeping the row's id; remove drops it", () => {
  const set = apply(facts, { action: "set", key: "birthday", value: "15 March" }).rows;
  assert.deepEqual(set, [{ id: "r1", key: "Birthday", value: "15 March" }]);
  const added = apply(facts, { action: "set", key: "Shirt", value: "M" }).rows;
  assert.equal(added.length, 2);
  assert.match(added[1].id, /^r_/);
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

test("note: append adds a paragraph, replace swaps the text, revise changes words found exactly once", () => {
  assert.equal(apply(note, { action: "append", text: "No meetings Fridays." }).text, "Mornings are for deep work.\n\nNo meetings Fridays.");
  assert.equal(apply(note, { action: "replace", text: "  New.  " }).text, "New.");
  assert.equal(apply(note, { action: "revise", old: "deep work", new: "writing" }).text, "Mornings are for writing.");
  assert.throws(() => apply(note, { action: "revise", old: "evenings", new: "x" }), /isn't in/);
  assert.throws(() => apply({ ...note, data: { text: "a a" } }, { action: "revise", old: "a", new: "b" }), /2 times/);
});

test("an action that doesn't fit the section says which do", () => {
  assert.throws(() => apply(note, { action: "add", item: "x" }), /use replace, append, revise/);
});

test("the user's edits wait in a draft: on the page at once, a version only when saved", async () => {
  await ready;
  const start = notebook.get().head;
  const s = notebook.add("list", "Places to try");
  notebook.write(s.id, { items: [{ id: "i1", text: "Nopa", done: false }] });
  notebook.rename(s.id, "Places");
  assert.equal(sectionNow(s.id).title, "Places");
  assert.equal(headNow(s.id), undefined, "agents don't see the draft");
  assert.equal(notebook.get().pending, true);
  assert.equal(notebook.get().head, start);

  const saved = notebook.save("First");
  assert.equal(saved.v, start + 1, "three edits, one version");
  assert.equal(saved.label, "First");
  assert.equal(headNow(s.id).title, "Places");
  assert.equal(headNow(s.id).data.items[0].text, "Nopa");
  assert.equal(notebook.get().pending, false);
  assert.equal(notebook.save(), null, "nothing to save, no version");
  notebook.remove(s.id);
  notebook.save();
});

test("saved a little after the user's hand leaves the notebook, not while it's there", async () => {
  await ready;
  const s = notebook.add("note", "Draft");
  notebook.save();
  notebook.setSaveDelay(20);
  notebook.hold(true);
  notebook.write(s.id, { text: "typing" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(notebook.get().pending, true, "held: not saved");
  notebook.hold(false);
  await new Promise((r) => setTimeout(r, 10));
  notebook.hold(true); // back within the delay: still not saved
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(notebook.get().pending, true);
  notebook.hold(false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(notebook.get().pending, false);
  assert.equal(headNow(s.id).data.text, "typing");
  notebook.setSaveDelay(null);
  notebook.remove(s.id);
  notebook.save();
});

test("undo and redo: an unsaved step leaves the draft; a saved one is reversed by a new version", async () => {
  await ready;
  const s = notebook.add("facts", "About me", undefined, { rows: [{ key: "Coffee", value: "Flat white" }] });
  notebook.save();
  const id = headNow(s.id).data.rows[0].id;

  notebook.write(s.id, { rows: [{ id, key: "Coffee", value: "Cortado" }] });
  const v = notebook.get().head;
  notebook.undo();
  assert.equal(sectionNow(s.id).data.rows[0].value, "Flat white");
  assert.equal(notebook.get().pending, false);
  assert.equal(notebook.get().head, v, "no version for an unsaved step");
  notebook.redo();
  assert.equal(sectionNow(s.id).data.rows[0].value, "Cortado");

  const saved = notebook.save();
  notebook.undo();
  assert.equal(notebook.get().head, saved.v + 1);
  assert.equal(notebook.version(saved.v + 1).revertOf, saved.v);
  assert.equal(headNow(s.id).data.rows[0].value, "Flat white");
  notebook.redo();
  assert.equal(headNow(s.id).data.rows[0].value, "Cortado");
  assert.equal(notebook.get().canRedo, false);
});

test("undo leaves alone what an agent changed since", async () => {
  await ready;
  const s = notebook.add("facts", "Sizes", undefined, { rows: [{ key: "Shirt", value: "M" }, { key: "Shoe", value: "42" }] });
  notebook.save();
  const [shirt, shoe] = headNow(s.id).data.rows;
  notebook.write(s.id, { rows: [{ ...shirt, value: "L" }, { ...shoe, value: "43" }] });
  notebook.save();
  notebook.edit(s.id, "a1", { action: "set", key: "Shirt", value: "XL" });
  const { skipped } = notebook.undo();
  assert.equal(skipped.length, 1);
  assert.deepEqual(headNow(s.id).data.rows.map((r) => r.value), ["XL", "42"]);
});

test("an agent saving under the user's draft: the draft stays on top, the clash is marked", async () => {
  await ready;
  const s = notebook.add("facts", "Trip", undefined, { rows: [{ key: "Where", value: "Lisbon" }, { key: "When", value: "May" }] });
  notebook.save();
  const [where] = headNow(s.id).data.rows;
  notebook.write(s.id, { rows: [{ ...where, value: "Porto" }, headNow(s.id).data.rows[1]] });
  notebook.edit(s.id, "a1", { action: "set", key: "Where", value: "Madrid" });
  notebook.edit(s.id, "a1", { action: "set", key: "Budget", value: "€800" });
  assert.deepEqual(sectionNow(s.id).data.rows.map((r) => r.value), ["Porto", "May", "€800"]);
  assert.equal(notebook.get().conflicts.length, 1);
  const [clash] = notebook.get().conflicts;
  assert.equal(clash.by, "a1");
  notebook.settle(clash.target, "theirs");
  assert.equal(sectionNow(s.id).data.rows[0].value, "Madrid");
  assert.equal(notebook.get().conflicts.length, 0);
});

test("history: any version can be reverted, and the notebook seen as it was", async () => {
  await ready;
  const s = notebook.add("list", "Books");
  notebook.save();
  const made = notebook.get().head;
  notebook.edit(s.id, "a1", { action: "add", item: "Middlemarch" });
  notebook.edit(s.id, "a2", { action: "add", item: "Stoner" });
  const added = made + 1;
  assert.deepEqual(notebook.asOf(made).find((x) => x.id === s.id).data.items, []);
  assert.equal(notebook.history()[0].v, notebook.get().head);
  notebook.revert(added);
  assert.deepEqual(headNow(s.id).data.items.map((i) => i.text), ["Stoner"]);
  notebook.undo(); // the revert itself is a step of the user's
  assert.deepEqual(headNow(s.id).data.items.map((i) => i.text), ["Middlemarch", "Stoner"]);
  notebook.restore(s.id, made);
  assert.deepEqual(headNow(s.id).data.items, []);
});

test("free text on the page goes by its first line, and agents can add to it", async () => {
  await ready;
  assert.equal(textTitle("  Plan for Saturday\nbrunch then hike"), "Plan for Saturday");
  assert.equal(textTitle(""), "Text");
  const made = notebook.add("text", null, undefined, { text: "Things I keep forgetting" });
  assert.equal(made.title, "Things I keep forgetting");
  notebook.save();
  notebook.edit(made.id, "a1", { action: "replace", text: "Remember the bins on Tuesday" });
  assert.equal(sectionNow(made.id).title, "Remember the bins on Tuesday");
  notebook.remove(made.id);
  notebook.save();
});
