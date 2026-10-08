import { test } from "node:test";
import assert from "node:assert/strict";

import { notebook, ready } from "../src/lib/notebook.js";
import { behindNote } from "../src/lib/notebookSync.js";
import { NOTEBOOK_TOOLS, notebookBrief } from "../src/lib/notebookTools.js";

notebook.setSaveDelay(null);
const nameOf = (id) => ({ planner: "Planner", researcher: "Researcher" })[id] || id;
const tool = (name) => NOTEBOOK_TOOLS.find((t) => t.name === name);

/* An agent in one conversation: each call's result goes into the messages it
 * can see, as lib/run.js would put it there. */
function convo(agentId, chatId) {
  const messages = [];
  let n = 0;
  const call = async (name, args = {}) => {
    const callId = `${agentId}-${++n}`;
    const out = await tool(name).run(args, { agentId, chatId, nameOf, callId, messages });
    messages.push({ role: "tool", callId, content: out });
    return out;
  };
  call.messages = messages;
  return call;
}

async function fresh(title, type, data) {
  await ready;
  const s = notebook.add(type, title, undefined, data);
  notebook.save();
  return s;
}

test("the first call in a conversation reads the whole notebook; the next only what changed", async () => {
  const places = await fresh("Places to try", "list", { items: [{ id: "i1", text: "Nopa", done: false }] });
  const planner = convo("planner", "chat-p");
  const first = await planner("notebook_sync");
  assert.match(first, /^Notebook v\d+\. Its sections:/);
  assert.match(first, /Places to try:\n- \[ \] Nopa/);

  assert.match(await planner("notebook_sync"), /nothing has changed since you last looked/);

  // The user adds one, and ticks one off: only that comes back.
  notebook.write(places.id, { items: [{ id: "i1", text: "Nopa", done: true }, { id: "i2", text: "Zuni", done: false }] });
  notebook.save();
  const next = await planner("notebook_sync");
  assert.match(next, /you last saw v\d+\. Since then:/);
  assert.match(next, /Places to try: ticked off “Nopa” \(the user, v\d+\)/);
  assert.match(next, /Places to try: added “Zuni” \(the user, v\d+\)/);
  assert.doesNotMatch(next, /Its sections/);
});

test("an agent isn't told about its own edits, but is told about everyone else's", async () => {
  await fresh("Gift ideas", "list", { items: [] });
  const planner = convo("planner", "chat-1");
  const researcher = convo("researcher", "chat-2");
  await planner("notebook_sync");
  await researcher("notebook_sync");

  const edit = await planner("notebook_edit", { section: "Gift ideas", action: "add", item: "Vinyl" });
  assert.match(edit, /Saved as v\d+: added “Vinyl” to Gift ideas\./);
  assert.match(edit, /“Gift ideas” now reads:\n- \[ \] Vinyl/);
  assert.match(await planner("notebook_sync"), /nothing has changed/);

  const heard = await researcher("notebook_sync");
  assert.match(heard, /Gift ideas: added “Vinyl” \(Planner \(another assistant\), v\d+\)/);
});

test("an edit to something changed since the agent last looked isn't saved; the rest of the call is", async () => {
  const about = await fresh("About", "facts", { rows: [{ key: "Birthday", value: "15 March" }] });
  const planner = convo("planner", "chat-3");
  await planner("notebook_read", { section: "About" });
  const [row] = notebook.head().sections.find((s) => s.id === about.id).data.rows;
  notebook.write(about.id, { rows: [{ ...row, value: "14 March" }] });
  notebook.save();

  const out = await planner("notebook_edit", {
    changes: [
      { section: "About", action: "set", key: "Birthday", value: "16 March" },
      { section: "About", action: "set", key: "Shirt", value: "M" },
    ],
  });
  // Caught up first, so the newer value is right there.
  assert.match(out, /About › Birthday: “15 March” → “14 March” \(the user/);
  assert.match(out, /Saved as v\d+: About › Shirt: “M”\./);
  assert.match(out, /Not saved:\n- About › Birthday — the user changed it to “14 March” at v\d+, after you last looked/);
  assert.deepEqual(notebook.head().sections.find((s) => s.id === about.id).data.rows.map((r) => r.value), ["14 March", "M"]);

  // Now it has seen it, the same edit goes through.
  assert.match(await planner("notebook_edit", { section: "About", action: "set", key: "Birthday", value: "16 March" }), /Saved as v\d+/);
});

test("a whole-note replace over someone else's newer words is refused; append and revise aren't", async () => {
  const work = await fresh("Work", "note", { text: "Mornings are for deep work." });
  const planner = convo("planner", "chat-4");
  await planner("notebook_sync");
  notebook.write(work.id, { text: "Mornings are for deep work.\n\nNo meetings Fridays." });
  notebook.save();
  assert.match(await planner("notebook_edit", { section: "Work", action: "replace", text: "Evenings." }), /Not saved:\n- Work — the user changed it/);
  const revised = await planner("notebook_edit", { section: "Work", action: "revise", old: "deep work", new: "writing" });
  assert.match(revised, /Saved as v\d+: revised Work/);
  assert.match(revised, /Mornings are for writing\.\n\nNo meetings Fridays\./);
});

test("folded out of sight, the cursor no longer holds: the next call reads everything", async () => {
  await fresh("Running", "facts", { rows: [{ key: "5k", value: "24:10" }] });
  const planner = convo("planner", "chat-5");
  await planner("notebook_sync");
  assert.match(await planner("notebook_sync"), /nothing has changed/);
  planner.messages.length = 0; // compacted away
  assert.match(await planner("notebook_sync"), /Its sections:/);
});

test("the note at the end of the user's message says how far behind the agent is", async () => {
  const s = await fresh("Plans", "list", { items: [] });
  const planner = convo("planner", "chat-6");
  assert.match(behindNote("planner", "chat-6", planner.messages, nameOf), /You haven't read it in this conversation/);
  await planner("notebook_sync");
  assert.equal(behindNote("planner", "chat-6", planner.messages, nameOf), "");
  notebook.edit(s.id, "researcher", { action: "add", item: "Hike" });
  assert.match(behindNote("planner", "chat-6", planner.messages, nameOf), /1 change, in Plans\. notebook_sync to catch up/);
});

test("when the user undoes an agent's change, the agent hears it", async () => {
  await fresh("Films", "list", { items: [] });
  const planner = convo("planner", "chat-7");
  await planner("notebook_sync");
  const out = await planner("notebook_edit", { section: "Films", action: "add", item: "Paris, Texas" });
  const v = Number(out.match(/Saved as v(\d+)/)[1]);
  notebook.revert(v);
  assert.match(await planner("notebook_sync"), /The user undid your change from v\d+/);
});

test("the brief stays the same while only the notebook's contents change", async () => {
  const s = await fresh("Brief", "list", { items: [] });
  const before = notebookBrief();
  notebook.edit(s.id, "planner", { action: "add", item: "x" });
  assert.equal(notebookBrief(), before);
  assert.match(before, /Brief \(list\)/);
});
