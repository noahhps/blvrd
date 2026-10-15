import assert from "node:assert/strict";
import { test } from "node:test";

import { contextOf, heatOf, kindOf, paramsOf, readingsOf, shortTokens } from "../src/lib/agentMetrics.js";

test("model size is read from its name", () => {
  assert.equal(paramsOf("qwen2.5:0.5b"), 0.5);
  assert.equal(paramsOf("llama-3.1-70b-instruct"), 70);
  assert.equal(paramsOf("mixtral-8x7b"), 56);
  assert.equal(paramsOf("gpt-4o"), null);
});

test("System 1 models are told apart from LLMs by family", () => {
  assert.equal(kindOf("nomic-embed-text"), "s1");
  assert.equal(kindOf("bge-reranker-v2-m3"), "s1");
  assert.equal(kindOf("whisper-large-v3-turbo"), "s1");
  assert.equal(kindOf("yolov8n"), "s1");
  assert.equal(kindOf("qwen2.5:0.5b"), "llm");
  assert.equal(kindOf("gpt-4o-mini"), "llm");
  assert.equal(kindOf("llama-3-sonar-large-32k-online"), "llm");
  assert.equal(kindOf(null), null);
});

test("heat counts recent tokens, and is at least 70 while answering", () => {
  const now = 1e12;
  const recent = [{ role: "user", content: "x".repeat(48000), at: now - 60000 }];
  const old = [{ role: "user", content: "x".repeat(48000), at: now - 3600000 }];
  assert.equal(heatOf(recent, { kind: "llm", now }), 100);
  assert.equal(heatOf(old, { kind: "llm", now }), 0);
  assert.equal(heatOf(old, { kind: "llm", now, answering: true }), 70);
});

test("context left counts only what follows the last summary", () => {
  const messages = [
    { role: "user", content: "x".repeat(40000) },
    { role: "summary", content: "short" },
    { role: "user", content: "x".repeat(4000) },
  ];
  assert.deepEqual(contextOf(messages, 10000), { used: 1000, limit: 10000, left: 90 });
  assert.equal(contextOf(messages, null), null);
});

test("a System 1 model's context is its window, against the last input", () => {
  const r = readingsOf({ messages: [{ role: "user", content: "x".repeat(1024), at: 1 }], model: "bge-reranker-v2-m3", limit: 32000, now: 2 });
  assert.equal(r.kind, "s1");
  assert.equal(r.task, "rank");
  assert.deepEqual(r.context, { used: 256, limit: 512, left: 50 });
});

test("readings put it together", () => {
  const r = readingsOf({ messages: [{ role: "user", content: "x".repeat(400), at: 1 }], model: "phi4-mini", limit: 1000, now: 2 });
  assert.equal(r.kind, "llm");
  assert.equal(r.tokens, 100);
  assert.equal(r.context.left, 90);
  assert.equal(shortTokens(12400), "12K");
  assert.equal(shortTokens(1200), "1.2K");
});
