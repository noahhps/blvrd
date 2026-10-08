/* A whole agent turn against a fake Ollama: the model calls a tool the way a
 * small model does (prefixed name, a number as a string), the call is
 * repaired and run, and the model answers from the result. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { runTurn } from "../src/lib/run.js";

function ndjsonResponse(objects) {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const o of objects) controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

test("a repaired tool call runs, and the model answers from its result", async (t) => {
  const requests = [];
  const replies = [
    [{ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "functions.calculate", arguments: { Expression: "1450*24" } } }] }, done: true }],
    [{ message: { role: "assistant", content: "That comes to " } }, { message: { content: "34,800." }, done: true }],
  ];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return ndjsonResponse(replies.shift());
  });

  const events = [];
  let text = "";
  await runTurn({
    agent: { name: "Analyst", instructions: "Compute.", tools: ["calculate"] },
    provider: { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" },
    model: "qwen3",
    history: [{ role: "user", content: "rent for 24 months at 1450?" }],
    emit: (e) => {
      events.push(e);
      if (e.type === "text") text += e.delta;
    },
    notebook: { notes: () => [], addNote: () => {} },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.deepEqual(requests[0].body.tools.map((t) => t.function.name), ["calculate"]);
  assert.match(requests[0].body.messages[0].content, /You are Analyst/);

  const messages = events.filter((e) => e.type === "message").map((e) => e.message);
  assert.equal(messages[0].calls[0].name, "calculate");
  assert.deepEqual(messages[0].calls[0].args, { expression: "1450*24" });
  assert.equal(messages[1].role, "tool");
  assert.match(messages[1].content, /1450\*24 = 34800/);
  assert.match(messages[1].content, /repaired/);
  assert.equal(messages[2].content, "That comes to 34,800.");
  assert.equal(text, "That comes to 34,800.");

  // The second request carried the call and its result back.
  const second = requests[1].body.messages;
  assert.equal(second.at(-1).role, "tool");
  assert.equal(second.at(-1).tool_name, "calculate");
});

test("a tool the agent is not allowed is not offered, and a call to it is refused", async (t) => {
  const replies = [
    [{ message: { content: "", tool_calls: [{ function: { name: "read_page", arguments: { url: "https://example.com" } } }] }, done: true }],
    [{ message: { content: "I can't read pages here." }, done: true }],
  ];
  const fetches = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    fetches.push(url);
    return ndjsonResponse(replies.shift());
  });
  const messages = [];
  await runTurn({
    agent: { name: "Offline", tools: ["current_time"] },
    provider: { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" },
    model: "m",
    history: [{ role: "user", content: "read example.com" }],
    emit: (e) => e.type === "message" && messages.push(e.message),
    notebook: { notes: () => [], addNote: () => {} },
  });
  assert.ok(fetches.every((u) => u.includes("127.0.0.1")), "the page itself was never fetched");
  assert.equal(messages[1].error, true);
  assert.match(messages[1].content, /no tool called "read_page"/);
});

test("a model that will not take tools still answers, with a note", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (body.tools) {
      return new Response(JSON.stringify({ error: "registry.ollama.ai/library/gemma:2b does not support tools" }), { status: 400 });
    }
    return ndjsonResponse([{ message: { content: "Hello." }, done: true }]);
  });
  const messages = [];
  await runTurn({
    agent: { name: "Companion", tools: null },
    provider: { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" },
    model: "gemma:2b",
    history: [{ role: "user", content: "hi" }],
    emit: (e) => e.type === "message" && messages.push(e.message),
    notebook: { notes: () => [], addNote: () => {} },
  });
  assert.equal(calls, 2);
  assert.equal(messages[0].content, "Hello.");
  assert.match(messages[0].note, /does not take tools/);
});

/* Stopping. A tool that never listens for the signal -- a connector's, an
 * AppleScript -- must not hold the turn: Stop ends it at once, and the model
 * is not asked again. */
test("stopping ends the turn even while a tool that ignores the signal is running", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return ndjsonResponse([{ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "slow_lookup", arguments: {} } }] }, done: true }]);
  });
  const controller = new AbortController();
  let started;
  const running = new Promise((r) => (started = r));
  const slow = {
    name: "slow_lookup",
    description: "Looks something up, slowly.",
    parameters: { type: "object", properties: {} },
    // Never settles, and never looks at ctx.signal.
    run: () => {
      started();
      return new Promise(() => {});
    },
  };
  const turn = runTurn({
    agent: { name: "Helper", instructions: "", tools: null },
    provider: { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" },
    model: "qwen3",
    history: [{ role: "user", content: "look it up" }],
    signal: controller.signal,
    emit: () => {},
    notebook: { notes: () => [], addNote: () => {} },
    available: [slow],
  });
  await running;
  controller.abort();
  await assert.rejects(turn, (e) => e.name === "AbortError");
  assert.equal(requests, 1);
});

test("stopping while a confirm-first tool waits for the reader ends the turn", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ndjsonResponse([{ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "send_it", arguments: {} } }] }, done: true }]),
  );
  const controller = new AbortController();
  let ran = false;
  let asked;
  const asking = new Promise((r) => (asked = r));
  const turn = runTurn({
    agent: { name: "Helper", instructions: "", tools: null },
    provider: { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" },
    model: "qwen3",
    history: [{ role: "user", content: "send it" }],
    signal: controller.signal,
    emit: () => {},
    notebook: { notes: () => [], addNote: () => {} },
    available: [{ name: "send_it", description: "Sends.", parameters: { type: "object", properties: {} }, confirm: true, run: () => (ran = true) }],
    // A question nobody answers.
    approve: () => {
      asked();
      return new Promise(() => {});
    },
  });
  await asking;
  controller.abort();
  await assert.rejects(turn, (e) => e.name === "AbortError");
  assert.equal(ran, false);
});
