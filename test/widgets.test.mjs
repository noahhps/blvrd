/* The reader's own widgets (lib/widgets.js) and agents' tools for them
 * (lib/widgetTools.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { STARTERS, nameFromHtml, problemWith, sourceOf, widgetDoc, widgetIdOf } from "../src/lib/widgets.js";
import { widgetTools } from "../src/lib/widgetTools.js";

const boot = { data: { n: 1 }, theme: "dark", font: "Inter" };

test("a fragment is wrapped in a page with the look and the bridge first", () => {
  const doc = widgetDoc("<p>hi</p>", boot);
  assert.match(doc, /^<!doctype html><html><head><meta charset="utf-8">/);
  assert.ok(doc.indexOf("window.blvrd") < doc.indexOf("<p>hi</p>"));
  assert.match(doc, /data-boot="\{&quot;data&quot;:\{&quot;n&quot;:1\}/);
});

test("a whole page keeps its own head, with ours put first in it", () => {
  const doc = widgetDoc('<!doctype html><html lang="en"><head><title>T</title></head><body>x</body></html>', boot);
  assert.match(doc, /<head><meta charset="utf-8">.*<title>T<\/title>/s);
  assert.equal((doc.match(/<head/g) || []).length, 1);
});

test("names, sources and what can't be a widget", () => {
  assert.equal(nameFromHtml("<title> Habit grid </title><p>x</p>"), "Habit grid");
  assert.equal(nameFromHtml("<p>x</p>", "tracker"), "tracker");
  assert.equal(widgetIdOf(sourceOf("w1")), "w1");
  assert.equal(widgetIdOf("calendar"), null);
  assert.match(problemWith("  "), /empty/);
  assert.match(problemWith("x".repeat(300_001)), /too big/);
  assert.equal(problemWith("<p>ok</p>"), null);
  for (const s of STARTERS) assert.equal(problemWith(s.html), null, s.id);
});

test("an agent makes a widget, changes one by name, and reads one's code", async () => {
  const kept = [{ id: "w1", name: "Counter", html: "<p>0</p>", data: { n: 3 } }];
  const made = [];
  const [make, read] = widgetTools({ list: () => kept, make: (w, o) => made.push([w, o]) });
  assert.equal(make.confirm, true);

  await make.run({ name: "Clock", html: "<p>12:00</p>" }, { agentName: "Helper" });
  assert.deepEqual(made.at(-1), [{ id: null, name: "Clock", html: "<p>12:00</p>", by: "Helper" }, { sidebar: true }]);

  await make.run({ name: "Counter", html: "<p>1</p>", replaces: "counter", sidebar: false }, {});
  assert.equal(made.at(-1)[0].id, "w1");
  await assert.rejects(make.run({ name: "X", html: "<p/>", replaces: "Nope" }, {}), /no widget called “Nope”/);
  await assert.rejects(make.run({ name: "X", html: " " }, {}), /empty/);

  assert.equal(await read.run({}), "- Counter");
  assert.match(await read.run({ name: "COUNTER" }), /Saved data: \{"n":3\}[\s\S]*Code:\n<p>0<\/p>/);
});
