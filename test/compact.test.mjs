/* Folding up a long chat (lib/compact.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ADAPTERS } from "../src/lib/providers.js";
import { canCompact, canFold, compact, cutFor, sinceSummary, sizeOf, summaryContext, tooLong, transcriptOf, withSummary } from "../src/lib/compact.js";

const long = "x".repeat(4000); // about 1000 tokens
const chat = [
  { id: "1", role: "user", content: long },
  { id: "2", role: "assistant", content: long, calls: [{ id: "a", name: "recall", args: {} }] },
  { id: "3", role: "tool", callId: "a", name: "recall", content: long },
  { id: "4", role: "assistant", content: "ok" },
  { id: "5", role: "user", content: long },
  { id: "6", role: "assistant", content: long },
  { id: "7", role: "user", content: "short" },
  { id: "8", role: "assistant", content: "short" },
];

test("a cut falls before one of the reader's messages, keeping about what was asked", () => {
  assert.equal(cutFor(chat, 0), 6); // just the last exchange
  assert.equal(cutFor(chat, 2500), 4); // the last two
  assert.equal(cutFor(chat, 100000), 4); // never the very start: there'd be nothing to fold
  assert.equal(cutFor(chat.slice(0, 4), 0), null); // one message from the reader: nothing to fold
});

test("too long is measured from the last summary on", () => {
  assert.ok(sizeOf(chat) > 5000);
  assert.ok(tooLong(chat, null, 5000));
  const folded = withSummary(chat, "7", { id: "s", role: "summary", content: "Earlier: things." });
  assert.ok(!tooLong(folded, { role: "user", content: "hi" }, 5000));
  assert.deepEqual(sinceSummary(folded).rest.map((m) => m.id), ["7", "8"]);
  assert.match(summaryContext(folded), /Earlier: things\./);
  assert.equal(summaryContext(chat), "");
});

test("compacting summarizes the older part, with the last summary, using the given model", async (t) => {
  const seen = [];
  t.mock.method(ADAPTERS.anthropic, "turn", async ({ messages, tools }) => {
    seen.push({ text: messages[0].content, tools });
    return { text: "  The user asked about recall.  ", calls: [] };
  });
  const provider = { id: "anthropic", kind: "anthropic", name: "Anthropic" };
  const folded = withSummary(chat, "5", { id: "s", role: "summary", content: "Before that: hello.", covers: 4 });
  const done = await compact({ messages: folded, keep: 0, provider, model: "m", nameOf: () => "Helper" });

  assert.equal(done.before, "7");
  assert.deepEqual(done.summary, { role: "summary", content: "The user asked about recall.", covers: 6 });
  assert.match(seen[0].text, /Before that: hello\./);
  assert.match(seen[0].text, /\[Helper\]: x+/);
  assert.doesNotMatch(seen[0].text, /recall result/); // the tool call is before the last summary
  assert.deepEqual(seen[0].tools, []);
});

test("whether a chat can be folded agrees with where it would be cut", () => {
  const cases = [[], chat.slice(0, 1), chat.slice(0, 4), chat.slice(0, 5), chat, withSummary(chat, "7", { id: "s", role: "summary", content: "x" })];
  for (const messages of cases) assert.equal(canFold(messages), cutFor(sinceSummary(messages).rest, 0) !== null);
});

test("a file and one question can be compacted by hand: all of it, the summary at the end", async (t) => {
  const seen = [];
  t.mock.method(ADAPTERS.anthropic, "turn", async ({ messages, system }) => {
    seen.push({ text: messages[0].content, system });
    return { text: "Q3 report: revenue up 14%; code word PELICAN-42.", calls: [] };
  });
  const provider = { id: "anthropic", kind: "anthropic", name: "Anthropic" };
  const one = [
    { id: "1", role: "user", content: "What's the code word?", files: [{ ref: "r", name: "Q3 report.pdf", kind: "text", text: "Revenue grew 14 percent.\nThe launch code word is PELICAN-42." }] },
    { id: "2", role: "assistant", content: "PELICAN-42" },
  ];
  assert.equal(canFold(one), false); // nothing to fold before a turn
  assert.equal(canCompact(one), true); // but by hand, all of it
  assert.equal(await compact({ messages: one, keep: 0, provider, model: "m", nameOf: () => "Helper" }), null);

  const done = await compact({ messages: one, keep: 0, provider, model: "m", nameOf: () => "Helper", all: true });
  assert.equal(done.before, null);
  assert.equal(done.summary.covers, 2);
  // The file's words reach the summarizer, which is told to keep them.
  assert.match(seen[0].text, /\[Attached file Q3 report\.pdf\]:\nRevenue grew 14 percent\./);
  assert.match(seen[0].system, /Where files were attached/);

  const after = withSummary(one, done.before, { id: "s", ...done.summary });
  assert.equal(after.at(-1).role, "summary");
  assert.deepEqual(sinceSummary(after).rest, []);
  assert.equal(canCompact(after), false);
  assert.match(summaryContext(after), /PELICAN-42/);
});

test("a long attached file is cut to what the summarizer has room for", () => {
  const messages = [{ id: "1", role: "user", content: "read this", files: [{ name: "big.txt", kind: "text", text: "y".repeat(50000) }, { name: "pic.jpg", kind: "image", dataUrl: "data:," }] }];
  const text = transcriptOf(messages, () => "Helper", { fileChars: 1000 });
  assert.match(text, /\(attached: big\.txt, pic\.jpg\)/);
  assert.match(text, /\[Attached file big\.txt, its first 1000 characters\]:\ny{1000}$/);
  assert.doesNotMatch(transcriptOf(messages, () => "Helper"), /y{10}/); // no room given: names only
});
