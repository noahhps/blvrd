/* Whether each kind of server's models can use tools, and how (lib/probe.js,
 * lib/profile.js) -- against fakes of the ways real ones behave: one that
 * calls natively, one whose chat template never shows the model a tool's
 * result, a vLLM started without a tool parser, and a model too small. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { probe } from "../src/lib/probe.js";
import { discover, getProfile, resetProfiles } from "../src/lib/profile.js";

const OLLAMA = { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" };
const VLLM = { id: "vllm", kind: "openai", name: "vLLM", base: "http://127.0.0.1:8000/v1" };

function ndjson(objects) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const o of objects) c.enqueue(enc.encode(JSON.stringify(o) + "\n")); c.close(); } }), { status: 200 });
}
function sse(events) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(`data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/* A model that does what it's asked, in whichever form it was given its
 * tools: a native call when the request carries tools, a written one when
 * they're in its instructions. `seesResults: false` -- a template that drops
 * `tool` messages: it never learns what a tool said unless it comes as a
 * user message. */
function model({ seesResults = true } = {}) {
  return (messages, native) => {
    const last = messages.at(-1);
    const text = String(last?.content || "");
    const all = messages.map((m) => (m.role === "tool" && !seesResults ? "" : String(m.content || ""))).join("\n");
    const code = /The code is (\d{4})/.exec(all)?.[1];
    const word = /with the word "(\w+)"/.exec(all)?.[1];
    const call = (w) => (native ? { call: { name: "probe_echo", args: { word: w } } } : { text: `<tool_call>{"name": "probe_echo", "arguments": {"word": "${w}"}}` });
    if (last.role === "user" && /again/.test(text) && !/<tool_result/.test(text)) return call(code || "unknown");
    if (last.role === "user" && /Call the probe_echo/.test(text)) return call(word);
    // After a result: say the code, if it could see it.
    return { text: code ? `The code is ${code}.` : "Done." };
  };
}

function fakeOllama(t, behave, { context = 32768, caps = ["completion", "tools"], bodies = [] } = {}) {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/api/show")) return json({ model_info: { "llama.context_length": context }, capabilities: caps, parameters: "" });
    const body = JSON.parse(init.body);
    bodies.push(body);
    const out = behave(body.messages, Boolean(body.tools));
    const message = out.call ? { role: "assistant", content: "", tool_calls: [{ function: { name: out.call.name, arguments: out.call.args } }] } : { role: "assistant", content: out.text };
    return ndjson([{ message, done: true, done_reason: "stop" }]);
  });
}

test("a model that calls tools the server's own way is native", async (t) => {
  resetProfiles();
  const bodies = [];
  fakeOllama(t, model(), { bodies });
  const profile = await probe(OLLAMA, "qwen3");
  assert.equal(profile.tools, "native");
  assert.deepEqual(profile.steps.map((s) => [s.step, s.ok]), [["call", true], ["result", true], ["chain", true]]);
  assert.equal(profile.window, 32768);
  assert.equal(bodies[0].options.num_ctx, 32768, "Ollama is told the context to load the model with");
});

test("a template that never shows tool results fails natively, and passes with tools in the prompt", async (t) => {
  resetProfiles();
  const bodies = [];
  fakeOllama(t, model({ seesResults: false }), { bodies });
  const profile = await probe(OLLAMA, "tinyllama");
  assert.equal(profile.tools, "prompted");
  const native = profile.steps.filter((s) => s.mode === "native");
  assert.deepEqual(native.map((s) => [s.step, s.ok]), [["call", true], ["result", false]]);
  assert.match(native[1].detail, /template may not show it tool results/);
  // Prompted: the tools in the system prompt, results as a user message.
  const prompted = bodies.find((b) => !b.tools && b.messages.some((m) => /<tool_result name="probe_echo">/.test(m.content || "")));
  assert.ok(prompted, "a result went back as a user message");
  assert.match(prompted.messages[0].content, /- probe_echo\(word\) -- Echo a word back, with a code\./);
  assert.deepEqual(prompted.options.stop, ["</tool_call>"]);
});

test("a vLLM started without a tool parser is prompted, learned from its refusal", async (t) => {
  resetProfiles();
  const behave = model();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (!init?.body) return json({ data: [{ id: "qwen", max_model_len: 16384 }] }); // /models, /props
    const body = JSON.parse(init.body);
    if (body.tools) return json({ object: "error", message: '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set' }, 400);
    const out = behave(body.messages, false);
    return sse([{ choices: [{ delta: { content: out.text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"]);
  });
  const profile = await probe(VLLM, "qwen");
  assert.equal(profile.tools, "prompted");
  assert.equal(profile.window, 16384, "max_model_len from /models");
  assert.equal(profile.steps[0].detail, "The server turned the tools down.");
});

test("a model with too small a window can't, whatever it does", async (t) => {
  resetProfiles();
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/api/show")) return json({ model_info: { "llama.context_length": 131072 }, capabilities: ["completion"], parameters: "num_ctx 2048" });
    throw new Error("not asked");
  });
  const profile = await probe(OLLAMA, "phi");
  assert.equal(profile.tools, "none");
  assert.equal(profile.window, 2048, "the Modelfile's num_ctx over the trained length");
  assert.match(profile.probeNote, /2048 tokens; the computer needs at least 6144/);
});

test("what OpenAI-compatible hosts say about a model is read from wherever they say it", async (t) => {
  resetProfiles();
  const lists = {
    "https://openrouter.ai/api/v1/models": { data: [{ id: "meta/llama", context_length: 131072, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["temperature"] }] },
    "https://api.groq.com/openai/v1/models": { data: [{ id: "llama-3.3", context_window: 128000 }] },
    "https://api.mistral.ai/v1/models": { data: [{ id: "mistral-small", max_context_length: 32768, capabilities: { function_calling: true, vision: false } }] },
    "https://api.together.xyz/v1/models": [{ id: "Qwen/Qwen3", context_length: 40960 }],
  };
  t.mock.method(globalThis, "fetch", async (url) => (lists[url] ? json(lists[url]) : json({}, 404)));
  const or = await discover({ id: "openrouter", kind: "openai", base: "https://openrouter.ai/api/v1" }, "meta/llama");
  assert.deepEqual([or.window, or.vision, or.tools], [131072, true, "prompted"], "no tools among its parameters");
  assert.equal((await discover({ id: "groq", kind: "openai", base: "https://api.groq.com/openai/v1" }, "llama-3.3")).window, 128000);
  const mistral = await discover({ id: "mistral", kind: "openai", base: "https://api.mistral.ai/v1" }, "mistral-small");
  assert.deepEqual([mistral.window, mistral.ids, mistral.tools], [32768, "alnum9", null]);
  assert.equal((await discover({ id: "together", kind: "openai", base: "https://api.together.xyz/v1" }, "Qwen/Qwen3")).window, 40960);
  // A host that says nothing leaves it unknown, not guessed.
  assert.equal((await discover({ id: "openai", kind: "openai", base: "https://api.openai.com/v1" }, "gpt-5")).window, null);
  assert.equal(getProfile({ id: "openai", kind: "openai", base: "https://api.openai.com/v1" }, "gpt-5").windowFrom, null);
});
