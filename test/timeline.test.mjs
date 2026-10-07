/* Text and tool calls kept in the order the model made them: run.js stores
 * the order, timeline.js lays the chat out by it. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ADAPTERS } from "../src/lib/providers.js";
import { runTurn } from "../src/lib/run.js";
import { timeline } from "../src/lib/timeline.js";

test("an answer's text and calls are stored in the order the model made them", async (t) => {
  const rounds = [
    {
      text: "Checking the time.\n\nNow the sum.",
      calls: [{ id: "a", name: "current_time", args: {} }, { id: "b", name: "calculate", args: { expression: "2+2" } }],
      parts: [{ type: "text", text: "Checking the time." }, { type: "call", id: "a" }, { type: "text", text: "Now the sum." }, { type: "call", id: "b" }],
      stop: "end",
    },
    { text: "Done.", calls: [], parts: [{ type: "text", text: "Done." }], stop: "end" },
  ];
  t.mock.method(ADAPTERS.anthropic, "turn", async ({ onCall }) => {
    const round = rounds.shift();
    for (const c of round.calls) onCall?.(c.name);
    return round;
  });
  const events = [];
  await runTurn({
    agent: { name: "Helper", instructions: "", tools: ["current_time", "calculate"] },
    provider: { id: "anthropic", kind: "anthropic", name: "Anthropic", base: "https://api.anthropic.com" },
    model: "claude-opus-5-5",
    history: [{ role: "user", content: "time and 2+2?" }],
    emit: (e) => events.push(e),
    notebook: { notes: () => [], addNote: () => {} },
  });

  assert.deepEqual(events.filter((e) => e.type === "call").map((e) => e.name), ["current_time", "calculate"]);
  const messages = events.filter((e) => e.type === "message").map((e) => e.message);
  assert.deepEqual(messages[0].parts.map((p) => p.type + ":" + (p.text || p.id)), ["text:Checking the time.", "call:a", "text:Now the sum.", "call:b"]);

  const shown = timeline(messages).map(({ message: m }) => (m.role === "tool" ? `tool:${m.name}` : `${m.role}:${m.content}`));
  assert.deepEqual(shown, ["assistant:Checking the time.", "tool:current_time", "assistant:Now the sum.", "tool:calculate", "assistant:Done."]);
});

test("a chat saved before parts reads as it did", () => {
  const messages = [
    { id: "1", role: "user", content: "hi" },
    { id: "2", role: "assistant", content: "Looking.", calls: [{ id: "a", name: "recall" }] },
    { id: "3", role: "tool", callId: "a", name: "recall", content: "nothing" },
    { id: "4", role: "assistant", content: "Nothing saved." },
  ];
  assert.deepEqual(timeline(messages).map((e) => e.message.id), ["1", "2", "3", "4"]);
});

test("a call cut short by a stop says so where it was made; one still running waits", () => {
  const messages = [
    { id: "2", role: "assistant", content: "A then B", calls: [{ id: "a", name: "recall" }], parts: [{ type: "text", text: "A" }, { type: "call", id: "a" }, { type: "text", text: "B" }] },
  ];
  assert.deepEqual(timeline(messages).map((e) => (e.message.unfinished ? "unfinished" : e.message.content)), ["A", "unfinished", "B"]);
  assert.deepEqual(timeline(messages, true).map((e) => e.message.content), ["A", "B"]);
});

test("calls made back to back read as one chain; text between splits them", () => {
  const messages = [
    { id: "2", role: "assistant", content: "Looking.\n\nAnd more.", calls: [{ id: "a", name: "recall" }, { id: "b", name: "calculate" }, { id: "c", name: "recall" }],
      parts: [{ type: "text", text: "Looking." }, { type: "call", id: "a" }, { type: "call", id: "b" }, { type: "text", text: "And more." }, { type: "call", id: "c" }] },
    { id: "3", role: "tool", callId: "a", name: "recall", content: "x" },
    { id: "4", role: "tool", callId: "b", name: "calculate", content: "4" },
    { id: "5", role: "tool", callId: "c", name: "recall", content: "y" },
  ];
  const shown = timeline(messages).map(({ key, message: m }) =>
    m.role === "chain" ? `${key}:chain:${m.steps.map((s) => s.name).join("+")}` : m.role === "tool" ? `tool:${m.name}` : m.content);
  assert.deepEqual(shown, ["Looking.", "3:chain:recall+calculate", "And more.", "tool:recall"]);
});

test("in a group, one agent's calls don't chain onto another's", () => {
  const messages = [
    { id: "3", role: "tool", callId: "a", name: "recall", agentId: "x", content: "" },
    { id: "4", role: "tool", callId: "b", name: "recall", agentId: "y", content: "" },
  ];
  assert.deepEqual(timeline(messages).map((e) => e.message.role), ["tool", "tool"]);
});
