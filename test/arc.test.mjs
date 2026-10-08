import { test } from "node:test";
import assert from "node:assert/strict";

import { busyMood, newestAnswer } from "../src/lib/useArcMood.js";

test("the Arc's mood while an agent works", () => {
  assert.equal(busyMood({ live: null, approval: null }), null);
  assert.equal(busyMood({ live: { text: "", parts: [] } }), "thinking");
  assert.equal(busyMood({ live: { text: "Hel", parts: [] } }), "speaking");
  assert.equal(busyMood({ live: { text: "", parts: [{ type: "call", name: "clock" }] } }), "thinking");
  assert.equal(busyMood({ live: { text: "Hel" }, approval: { summary: "x" } }), "asking");
});

test("the newest answer is the latest assistant message ending any chat", () => {
  const chats = {
    a: [{ id: "1", role: "user", at: 5 }, { id: "2", role: "assistant", at: 6 }],
    b: [{ id: "3", role: "assistant", at: 9, failure: "No model" }],
    c: [{ id: "4", role: "assistant", at: 20 }, { id: "5", role: "user", at: 21 }],
  };
  assert.equal(newestAnswer(chats).id, "3");
  assert.equal(newestAnswer({}), null);
});
