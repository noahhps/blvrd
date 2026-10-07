/* What the sidebar says about a conversation (lib/preview.js). Each case
 * here is a break found with the worst-case data (src/dev/fixtures.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { agentCount, lastLine, plainText, previewOf, shortWhen, speakerName } from "../src/lib/preview.js";

test("markup goes from a preview, and nothing that only looks like it", () => {
  assert.equal(
    plainText("In C# use `List<T>` when the size changes; arrays are fixed > see the docs."),
    "In C# use List<T> when the size changes; arrays are fixed > see the docs.",
  );
  assert.equal(plainText("Here's `quarterly_revenue_by_region_v2.csv`: **Q3** grew, see *north_east*."), "Here's quarterly_revenue_by_region_v2.csv: Q3 grew, see north_east.");
  assert.equal(plainText("snake_case_name and 2 * 3 * 4 = 24, 2 > 1"), "snake_case_name and 2 * 3 * 4 = 24, 2 > 1");
  assert.equal(plainText("# Title\n\n> quoted\n\n- one\n- two"), "Title quoted one two");
  assert.equal(plainText("See [the docs](https://example.com) & AT&T <b>"), "See the docs & AT&T <b>");
  assert.equal(plainText("Before\n```js\nconst a = 1;\n```\nafter"), "Before [code] after");
  assert.equal(plainText("**bold**word and ~~gone~~"), "boldword and gone");
});

test("a message's line: failures, tools, files, notes", () => {
  assert.equal(previewOf({ role: "assistant", content: "", failure: "x" }), "Something went wrong");
  assert.equal(previewOf({ role: "tool", name: "calendar_events", content: "No events." }), "Used calendar_events");
  assert.equal(previewOf({ role: "user", content: "", files: [{ name: "a.png" }, { name: "b.md" }] }), "You: a.png, b.md");
  assert.equal(previewOf({ role: "user", content: "hi **there**" }), "You: hi there");
  assert.equal(previewOf({ role: "assistant", content: "", note: "Stopped." }), "Stopped.");
  assert.equal(previewOf({ role: "assistant", content: "" }), "");
  assert.equal(previewOf({ role: "summary", content: "Earlier…" }), "");
});

test("a turn that ended in a tool call and no words shows the tool, not a blank line", () => {
  const chat = [
    { role: "user", content: "What's on Thursday?" },
    { role: "assistant", content: "", calls: [{ id: "c1", name: "calendar_events" }] },
    { role: "tool", callId: "c1", name: "calendar_events", content: "No events." },
    { role: "assistant", content: "" },
  ];
  assert.equal(lastLine(chat).text, "Used calendar_events");
  assert.equal(lastLine(chat).message, chat[2]);
  assert.equal(lastLine([]), null);
  assert.equal(lastLine([{ role: "assistant", content: "" }]), null);
});

test("a long speaker name leaves room for what they said", () => {
  assert.equal(speakerName("Researcher"), "Researcher");
  assert.equal(speakerName("Aleksandra Wiśniewska-Kowalczyk’s Research Assistant"), "Aleksandra");
  // A first word that isn't a word, or that another member shares: cut instead.
  assert.equal(speakerName("C# Code Reviewer and Linter"), "C# Code Revi…");
  assert.equal(speakerName("🧪 Lab Notes and Experiments"), "🧪 Lab Notes…");
  assert.equal(speakerName("Research Assistant for Legal", ["Research Assistant for Sales"]), "Research Ass…");
  // Counted in characters as people see them, so an emoji isn't cut in half.
  assert.equal(speakerName("👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦"), `${"👩‍👩‍👧‍👦".repeat(12)}…`);
});

test("agent counts read right at none, one and many", () => {
  assert.equal(agentCount(0), "No agents left");
  assert.equal(agentCount(1), "1 agent");
  assert.equal(agentCount(7), "7 agents");
});

test("a date from another year says which year", () => {
  const now = new Date(2026, 9, 6, 16, 0).getTime();
  const thisYear = shortWhen(new Date(2026, 9, 3, 9, 0).getTime(), now);
  const lastYear = shortWhen(new Date(2025, 9, 3, 9, 0).getTime(), now);
  assert.ok(!thisYear.includes("2026"), thisYear);
  assert.ok(lastYear.includes("2025"), lastYear);
  assert.notEqual(shortWhen(new Date(2026, 9, 6, 9, 5).getTime(), now), thisYear);
  assert.equal(shortWhen(0, now), "");
});
