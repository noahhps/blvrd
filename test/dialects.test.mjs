/* The ways servers differ, each answered: how they stream calls, the forms
 * models write calls in, what they refuse and how a turn recovers, a busy
 * server, thinking written into the reply, a call cut off, and a picture a
 * tool returned -- in every wire format. No network: fakes of each. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { callsInText, splitThink } from "../src/lib/heal.js";
import { getProfile, resetProfiles } from "../src/lib/profile.js";
import { asPrompted, toolsBlock } from "../src/lib/prompted.js";
import { _wire, idFor, plainSchema } from "../src/lib/providers.js";
import { runTurn } from "../src/lib/run.js";

const enc = new TextEncoder();
const stream = (lines) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } }), { status: 200 });
const sse = (events) => stream(events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`));
const ndjson = (objects) => stream(objects.map((o) => JSON.stringify(o) + "\n"));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const LLAMACPP = { id: "llamacpp", kind: "openai", name: "llama.cpp", base: "http://127.0.0.1:8080/v1" };
const MISTRAL = { id: "mistral", kind: "openai", name: "Mistral", base: "https://api.mistral.ai/v1", key: "k" };
const OLLAMA = { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" };

const echo = (seen) => ({
  name: "echo",
  description: "Echo text.",
  parameters: { type: "object", properties: { text: { type: "string", description: "What to echo.", default: "hi", minLength: 1 } }, required: ["text"], additionalProperties: false },
  run: ({ text }) => {
    seen.push(text);
    return `echo: ${text}`;
  },
});

async function turn(provider, replies, { tools, seen = [], bodies = [], model = "m" } = {}) {
  const messages = [];
  await runTurn({
    agent: { name: "A", tools: null },
    provider,
    model,
    history: [{ role: "user", content: "go" }],
    available: tools || [echo(seen)],
    notebook: {},
    emit: (e) => e.type === "message" && messages.push(e.message),
  });
  return { messages, seen, bodies };
}

function serve(t, handler) {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body) bodies.push(body);
    return handler(body, bodies.length, url);
  });
  return bodies;
}

const done = (text = "ok") => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"]);

/* -- streaming calls -------------------------------------------------------------- */

test("OpenAI-compatible calls arrive whole, in pieces with an index, in pieces without one, and several at once", async (t) => {
  const shapes = [
    // whole, in one chunk
    [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "echo", arguments: '{"text":"a"}' } }] } }] }],
    // in pieces, with an index
    [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "echo", arguments: '{"te' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'xt":"a"}' } }] } }] }],
    // no index at all (some servers)
    [{ choices: [{ delta: { tool_calls: [{ id: "c1", function: { name: "echo", arguments: '{"text":"a"}' } }] } }] }],
  ];
  for (const shape of shapes) {
    resetProfiles();
    let n = 0;
    serve(t, () => (n++ === 0 ? sse([...shape, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }, "[DONE]"]) : done()));
    const { seen } = await turn(LLAMACPP, null);
    assert.deepEqual(seen, ["a"]);
    t.mock.restoreAll();
  }
  resetProfiles();
  let n = 0;
  serve(t, () =>
    n++ === 0
      ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "echo", arguments: '{"text":"a"}' } }, { index: 1, id: "c2", function: { name: "echo", arguments: '{"text":"b"}' } }] } }] }, "[DONE]"])
      : done(),
  );
  assert.deepEqual((await turn(LLAMACPP, null)).seen, ["a", "b"]);
});

test("a call cut off at the output limit says why, instead of only that it wasn't JSON", async (t) => {
  resetProfiles();
  let n = 0;
  serve(t, () =>
    n++ === 0
      ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "echo", arguments: '{"text":"a very long' } }] } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }, "[DONE]"])
      : done(),
  );
  const { messages } = await turn(LLAMACPP, null);
  assert.match(messages.find((m) => m.role === "tool").content, /cut off at the model's output limit/);

  // Ollama says so as done_reason.
  resetProfiles();
  t.mock.restoreAll();
  n = 0;
  serve(t, () => (n++ === 0 ? ndjson([{ message: { content: "<tool_call>{\"name\": \"echo\", \"arguments\": {\"text\": \"unfinish" }, done: true, done_reason: "length" }]) : ndjson([{ message: { content: "ok" }, done: true }])));
  const ollama = await turn(OLLAMA, null);
  assert.match(ollama.messages.find((m) => m.role === "tool").content, /cut off at the model's output limit/);
});

/* -- calls written as text --------------------------------------------------------------- */

test("calls written into the reply in each model family's form are found", () => {
  const names = ["echo", "read_page"];
  const forms = {
    "<tool_call>{\"name\": \"echo\", \"arguments\": {\"text\": \"a\"}}</tool_call>": "a",
    "<tool_call>{\"name\": \"echo\", \"arguments\": {\"text\": \"open\"}}": "open", // stopped at </tool_call>
    "[TOOL_CALLS][{\"name\": \"echo\", \"arguments\": {\"text\": \"mistral\"}}]": "mistral",
    "[TOOL_CALLS]echo[ARGS]{\"text\": \"mistral-new\"}": "mistral-new",
    "<|python_tag|>{\"name\": \"echo\", \"parameters\": {\"text\": \"llama\"}}<|eom_id|>": "llama",
    "<function=echo>{\"text\": \"llama-fn\"}</function>": "llama-fn",
    "```json\n{\"name\": \"echo\", \"arguments\": {\"text\": \"fenced\"}}\n```": "fenced",
    "{\"name\": \"echo\", \"arguments\": {\"text\": \"bare\"}}": "bare",
  };
  for (const [text, arg] of Object.entries(forms)) {
    const found = callsInText(text, names);
    assert.equal(found.calls.length, 1, text);
    assert.equal(found.calls[0].args.text, arg, text);
  }
  // Not calls: a name that isn't a tool, an object without arguments, prose.
  assert.equal(callsInText('{"name": "Ada"}', names).calls.length, 0);
  assert.equal(callsInText('{"name": "echo"}', names).calls.length, 0);
  assert.equal(callsInText("Use echo to say hi.", names).calls.length, 0);
});

test("a call only thought about inside <think> doesn't run, and the thinking isn't sent back", async (t) => {
  resetProfiles();
  const bodies = serve(t, (body, n) =>
    n === 1 ? done('<think>I could call <tool_call>{"name": "echo", "arguments": {"text": "x"}}</tool_call> but no.</think>The answer is 4.') : done("again"),
  );
  const { messages, seen } = await turn(LLAMACPP, null);
  assert.deepEqual(seen, []);
  assert.equal(messages[0].content, "The answer is 4.");
  assert.match(messages[0].thought, /I could call/);
  assert.equal(bodies.length, 1);
  assert.deepEqual(splitThink("all thinking\n</think>\nanswer"), { text: "answer", thought: "all thinking" });
});

/* -- refusals, and how a turn recovers ----------------------------------------------------- */

test("a schema turned down is sent again plain, and that's remembered", async (t) => {
  resetProfiles();
  const bodies = serve(t, (body, n) => {
    if (n === 1) return json({ error: { message: 'Invalid JSON payload received. Unknown name "additionalProperties" at function_declarations[0].parameters: Cannot find field.' } }, 400);
    return done();
  });
  await turn({ id: "gemini", kind: "openai", name: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "k" }, null, { model: "gemini-x" });
  const params = bodies[1].tools[0].function.parameters;
  assert.deepEqual(params, { type: "object", properties: { text: { type: "string", description: "What to echo." } }, required: ["text"] });
  assert.equal(getProfile({ id: "gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai" }, "gemini-x").plainSchemas, true);
});

test("Mistral's ids: nine letters and digits, the same for a call and its result", async (t) => {
  resetProfiles();
  // A chat that began on Ollama, with the app's own ids, moving to Mistral.
  const history = [
    { role: "user", content: "go" },
    { role: "assistant", content: "", calls: [{ id: "call_k2j3h4g5f6x", name: "echo", args: { text: "a" } }] },
    { role: "tool", callId: "call_k2j3h4g5f6x", name: "echo", content: "echo: a" },
    { role: "user", content: "and again" },
  ];
  const out = _wire.toOpenAI("", history, { ids: getProfile(MISTRAL, "mistral-small").ids });
  const id = out[1].tool_calls[0].id;
  assert.match(id, /^[a-zA-Z0-9]{9}$/);
  assert.equal(out[2].tool_call_id, id);
  assert.equal(idFor("Ab3dE9xYz", "alnum9"), "Ab3dE9xYz", "an id already in that shape is left alone");

  // A server that wasn't known to want them that way says so, and is sent them again.
  const other = { id: "custom", kind: "openai", name: "Mine", base: "https://example.test/v1" };
  const bodies = serve(t, (body, n) => (n === 1 ? json({ message: "Tool call id was call_k2j3h4g5f6x but must be a-z, A-Z, 0-9, with a length of 9." }, 400) : done()));
  await runTurn({ agent: { name: "A", tools: null }, provider: other, model: "m", history, available: [echo([])], notebook: {}, emit: () => {} });
  assert.match(bodies[1].messages[2].tool_calls[0].id, /^[a-zA-Z0-9]{9}$/);
});

test("a server that wants text, not null, beside the calls is sent \"\"", async (t) => {
  resetProfiles();
  const history = [
    { role: "user", content: "go" },
    { role: "assistant", content: "", calls: [{ id: "c1", name: "echo", args: { text: "a" } }] },
    { role: "tool", callId: "c1", name: "echo", content: "echo: a" },
  ];
  const bodies = serve(t, (body, n) => (n === 1 ? json({ error: { message: "messages[1].content: Input should be a valid string, got null" } }, 400) : done()));
  await runTurn({ agent: { name: "A", tools: null }, provider: LLAMACPP, model: "m", history, available: [echo([])], notebook: {}, emit: () => {} });
  // [0] is the system prompt.
  assert.equal(bodies[0].messages[2].content, null);
  assert.equal(bodies[1].messages[2].content, "");
});

test("a busy server is waited for, as long as it asks", async (t) => {
  resetProfiles();
  let n = 0;
  serve(t, () => (n++ === 0 ? json({ error: { message: "Rate limit reached" } }, 429, { "Retry-After": "0" }) : done("after the wait")));
  const { messages } = await turn(LLAMACPP, null);
  assert.equal(messages[0].content, "after the wait");
  assert.equal(n, 2);
});

/* -- prompted mode ------------------------------------------------------------------------- */

test("prompted: the tools in one line each, calls as text, results as the user's turn", () => {
  const seen = [];
  const block = toolsBlock([echo(seen), { name: "now", description: "The time. Use it often.", parameters: { type: "object", properties: {} } }]);
  assert.match(block, /- echo\(text\) -- Echo text\./);
  assert.match(block, /- now\(\) -- The time\./);
  const out = asPrompted([
    { role: "user", content: "go" },
    { role: "assistant", content: "Let me.", calls: [{ id: "c1", name: "echo", args: { text: "a" } }] },
    { role: "tool", callId: "c1", name: "echo", content: "echo: a" },
    // A turn stopped after its results, then the reader again: one user turn.
    { role: "user", content: "and?" },
  ]);
  assert.deepEqual(out.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(out[1].content, 'Let me.\n<tool_call>{"name":"echo","arguments":{"text":"a"}}</tool_call>');
  assert.equal(out[1].calls, undefined);
  assert.equal(out[2].content, '<tool_result name="echo">\necho: a\n</tool_result>\n\nand?');
  assert.deepEqual(plainSchema({ type: "object", properties: { n: { type: ["integer", "null"] }, o: { type: "object" } }, required: ["n", "x"] }), {
    type: "object",
    properties: { n: { type: "integer" }, o: { type: "string" } },
    required: ["n"],
  });
});

/* -- pictures from tools --------------------------------------------------------------------- */

test("a picture a tool returned goes inside its result for Claude, and in a user message after the results elsewhere", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const history = [
    { role: "user", content: "look" },
    { role: "assistant", content: "", calls: [{ id: "c1", name: "look", args: {} }] },
    { role: "tool", callId: "c1", name: "look", content: "A screenshot.", files: [{ kind: "image", name: "screen.png", dataUrl }] },
  ];
  const claude = _wire.toAnthropic(history, "claude-x");
  const result = claude[2].content[0];
  assert.equal(result.type, "tool_result");
  assert.deepEqual(result.content.map((b) => b.type), ["text", "image"]);

  const oa = _wire.toOpenAI("", history);
  assert.deepEqual(oa.map((m) => m.role), ["user", "assistant", "tool", "user"]);
  assert.equal(oa[3].content[1].image_url.url, dataUrl);

  const ol = _wire.toOllama("", history);
  assert.deepEqual(ol.map((m) => m.role), ["user", "assistant", "tool", "user"]);
  assert.deepEqual(ol[3].images, ["iVBORw0KGgo="]);

  // Prompted: with the results.
  assert.equal(asPrompted(history)[2].files[0].dataUrl, dataUrl);
});
