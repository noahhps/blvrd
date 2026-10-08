import { test } from "node:test";
import assert from "node:assert/strict";

import { calendarRows, groupsRows, musicRows, rowsText, setupRows } from "../src/lib/liveRows.js";
import { LIVE, notebook, provideLive, ready } from "../src/lib/notebook.js";
import { NOTEBOOK_TOOLS } from "../src/lib/notebookTools.js";

test("calendar rows: the coming week only, soonest first, past ones left out", () => {
  const now = new Date(2026, 9, 8, 12, 0);
  const at = (d, h) => new Date(2026, 9, d, h).toISOString();
  const rows = calendarRows(
    [
      { title: "Later", start: at(10, 9), end: at(10, 10) },
      { title: "Done", start: at(8, 8), end: at(8, 9) },
      { title: "Lunch", start: at(8, 13), end: at(8, 14), location: "Nopa" },
      { title: "Too far", start: at(20, 9), end: at(20, 10) },
    ],
    now,
  );
  assert.deepEqual(rows.map((r) => r.value), ["Lunch · Nopa", "Later"]);
});

test("music, groups and setup rows say what the widgets show", () => {
  assert.deepEqual(musicRows(null), []);
  const m = musicRows({ app: "spotify", state: "playing", title: "Harvest Moon", artist: "Neil Young", album: "Harvest Moon", duration: 303, position: 64 });
  assert.equal(m[0].value, "Harvest Moon — Neil Young");
  assert.equal(m.find((r) => r.key === "Where").value, "1:04 of 5:03");
  assert.deepEqual(groupsRows([{ name: "Trip", members: ["a", "b"] }], (id) => ({ a: "Planner", b: "Researcher" })[id]), [{ key: "Trip", value: "Planner, Researcher" }]);
  const setup = setupRows({ defaultModel: { provider: "ollama", model: "qwen3:14b" }, providers: [{ id: "ollama", name: "Ollama" }], connectors: { apple: { enabled: true } } });
  assert.equal(setup[0].value, "qwen3:14b on Ollama");
  assert.match(setup[1].value, /Apple Calendar & Reminders/);
  assert.equal(rowsText([], "Nothing."), "Nothing.");
});

test("every widget is in the notebook once; agents read it but can't change it", async () => {
  await ready;
  const live = notebook.get().sections.filter((s) => s.type === "live");
  assert.deepEqual(live.map((s) => s.source).sort(), Object.keys(LIVE).sort());

  provideLive("music", async () => musicRows({ app: "music", state: "paused", title: "So What", artist: "Miles Davis" }));
  const tool = (name) => NOTEBOOK_TOOLS.find((t) => t.name === name);
  const ctx = { agentId: "a1", nameOf: () => "A" };
  assert.match(await tool("notebook_contents").run({}, ctx), /Now playing \(kept current by the app; read-only\)/);
  assert.match(await tool("notebook_read").run({ section: "now playing" }, ctx), /Paused: So What — Miles Davis/);
  await assert.rejects(tool("notebook_edit").run({ section: "Calendar", action: "set", key: "x", value: "y" }, ctx), /kept up to date by the app/);

  // Taken out, it stays out (it isn't put back on the next load).
  const calendar = live.find((s) => s.source === "calendar");
  notebook.remove(calendar.id);
  assert.ok(notebook.get().settings.liveAdded.includes("calendar"));
  assert.ok(!notebook.get().sections.some((s) => s.source === "calendar"));
  notebook.addLive("calendar");
});

test("the sidebar: made once from the old order, then dragged into and out of", async () => {
  await ready;
  const { inSidebar } = await import("../src/lib/notebook.js");
  const live = (source) => notebook.get().sections.find((s) => s.type === "live" && s.source === source);
  notebook.connectSidebar(["settings", "agents", "calendar", "groups", "music"]);
  const names = () => notebook.get().settings.sidebar.map((id) => notebook.get().sections.find((s) => s.id === id)?.source || notebook.get().sections.find((s) => s.id === id)?.title);
  assert.deepEqual(names(), ["setup", "agents", "calendar", "groups", "music"]);
  // Only once.
  notebook.connectSidebar(["music"]);
  assert.equal(names()[0], "setup");

  // A section made on the page, dropped in at the second place.
  const gifts = notebook.add("list", "Gift ideas");
  notebook.addToSidebar(gifts.id, 1);
  assert.deepEqual(names().slice(0, 3), ["setup", "Gift ideas", "agents"]);
  // Dropped again elsewhere, it moves rather than doubling.
  notebook.addToSidebar(gifts.id, 4);
  assert.equal(names().filter((n) => n === "Gift ideas").length, 1);

  // The way around the app can't leave; the rest can.
  notebook.removeFromSidebar(live("agents").id);
  assert.ok(inSidebar(live("agents").id));
  notebook.removeFromSidebar(live("music").id);
  assert.ok(!inSidebar(live("music").id));

  // Deleted and undone, a section goes back into its sidebar slot too.
  const before = names();
  const undo = notebook.remove(gifts.id);
  assert.ok(!names().includes("Gift ideas"));
  undo();
  assert.deepEqual(names(), before);
  notebook.remove(gifts.id);
});
