import { test } from "node:test";
import assert from "node:assert/strict";

import { calculate } from "../src/lib/calc.js";
import { isLocalUrl } from "../src/lib/catalog.js";
import { callsInText, fitArgs, parseArgs, resolveName } from "../src/lib/heal.js";
import { renderMarkdown } from "../src/lib/markdown.js";
import { _wire } from "../src/lib/providers.js";
import { ndjson, sse } from "../src/lib/stream.js";
import { htmlToText } from "../src/lib/tools.js";

async function* pieces(...parts) {
  for (const p of parts) yield p;
}
const collect = async (iter) => {
  const out = [];
  for await (const x of iter) out.push(x);
  return out;
};

test("ndjson survives lines split across chunks", async () => {
  const got = await collect(ndjson(pieces('{"a":', '1}\n{"b"', ":2}\n\n", '{"c":3}')));
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test("sse joins data lines and skips comments", async () => {
  const got = await collect(sse(pieces(": hi\n", "data: one\ndata: two\n\nevent: x\nda", "ta: [DONE]\n\n")));
  assert.deepEqual(got, [
    { event: "message", data: "one\ntwo" },
    { event: "x", data: "[DONE]" },
  ]);
});

test("tool names resolve only when there is one thing meant", () => {
  const names = ["read_page", "recall", "remember", "calculate"];
  assert.equal(resolveName("functions.read_page", names), "read_page");
  assert.equal(resolveName("ReadPage", names), "read_page");
  assert.equal(resolveName("calculte", names), "calculate");
  assert.equal(resolveName("rem", names), null);
  assert.equal(resolveName("send_email", names), null);
});

test("nearly-JSON arguments are parsed", () => {
  assert.deepEqual(parseArgs("{expression: '2+2',}"), { expression: "2+2" });
  assert.deepEqual(parseArgs('```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => parseArgs("not json at all"));
});

test("arguments are fitted to the schema, with notes", () => {
  const schema = {
    type: "object",
    properties: { url: { type: "string" }, limit: { type: "integer" } },
    required: ["url"],
  };
  const fitted = fitArgs({ arguments: { URL: "https://x.y", limit: "7" } }, schema);
  assert.deepEqual(fitted.args, { url: "https://x.y", limit: 7 });
  assert.equal(fitted.notes.length, 3);
  assert.match(fitArgs({}, schema).error, /missing "url"/);
});

test("calls written as text are found, and ordinary JSON is left alone", () => {
  const names = ["calculate"];
  const found = callsInText('Let me work it out.\n<tool_call>{"name": "calculate", "arguments": {"expression": "6*7"}}</tool_call>', names);
  assert.deepEqual(found.calls, [{ name: "calculate", args: { expression: "6*7" } }]);
  assert.equal(found.text, "Let me work it out.");
  const plain = callsInText('Here is JSON:\n```json\n{"name": "Ada"}\n```', names);
  assert.equal(plain.calls.length, 0);
});

test("the calculator", () => {
  assert.equal(calculate("2 + 3 * 4"), 14);
  assert.equal(calculate("(2 + 3) * 4"), 20);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("-3^2"), -9);
  assert.equal(calculate("1,450 * 24"), 34800);
  assert.equal(calculate("200 * 15%"), 30);
  assert.equal(calculate("10 % 3"), 1);
  assert.equal(calculate("sqrt(16) + max(1, 9)"), 13);
  assert.throws(() => calculate("2 +"), /unexpected end/);
  assert.throws(() => calculate("alert(1)"), /unknown name/);
  assert.throws(() => calculate("1/0"), /no finite value/);
});

test("markdown escapes everything a model writes", () => {
  const html = renderMarkdown('<script>alert(1)</script> **bold** [x](javascript:alert(1)) [ok](https://a.b)');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('href="https://a.b"'));
});

test("bold that contains a multiplication sign", () => {
  assert.match(renderMarkdown("By my sums: **1450 * 24 = 34800**."), /<strong>1450 \* 24 = 34800<\/strong>/);
  assert.match(renderMarkdown("a * b * c"), /<p>a \* b \* c<\/p>/);
});

test("markdown blocks", () => {
  const html = renderMarkdown("# T\n\n- a\n- b\n\n```js\nlet x = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.match(html, /<h2>T<\/h2>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<pre data-lang="js"><code>let x = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<td>1<\/td><td>2<\/td>/);
});

test("local and hosted URLs", () => {
  assert.ok(isLocalUrl("http://127.0.0.1:11434"));
  assert.ok(isLocalUrl("http://192.168.1.20:8080/v1"));
  assert.ok(isLocalUrl("http://gpu-box.local:1234/v1"));
  assert.ok(!isLocalUrl("https://api.groq.com/openai/v1"));
  assert.ok(!isLocalUrl("http://172.32.0.1"));
});

test("html to text", () => {
  const text = htmlToText("<html><head><title>T</title><style>x{}</style></head><body><p>A &amp; B</p><script>no()</script><ul><li>one</li></ul></body></html>");
  assert.equal(text, "T\n\nA & B\n- one");
});

const history = [
  { role: "user", content: "what is 6*7" },
  { role: "assistant", content: "", calls: [{ id: "call_1", name: "calculate", args: { expression: "6*7" } }] },
  { role: "tool", callId: "call_1", name: "calculate", content: "6*7 = 42" },
  { role: "assistant", content: "42.", calls: [] },
];

test("history in Ollama's format", () => {
  const wire = _wire.toOllama("sys", history);
  assert.equal(wire[0].role, "system");
  assert.deepEqual(wire[2].tool_calls, [{ function: { name: "calculate", arguments: { expression: "6*7" } } }]);
  assert.deepEqual(wire[3], { role: "tool", tool_name: "calculate", content: "6*7 = 42" });
});

test("history in the OpenAI format", () => {
  const wire = _wire.toOpenAI("", history);
  assert.equal(wire[1].content, null);
  assert.equal(wire[1].tool_calls[0].function.arguments, '{"expression":"6*7"}');
  assert.deepEqual(wire[2], { role: "tool", tool_call_id: "call_1", content: "6*7 = 42" });
});

test("history in Anthropic's format: results grouped, own turns replayed as they came", () => {
  const two = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      calls: [
        { id: "a", name: "current_time", args: {} },
        { id: "b", name: "recall", args: {} },
      ],
      raw: { provider: "anthropic", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "a", name: "current_time", input: {} }, { type: "tool_use", id: "b", name: "recall", input: {} }] },
    },
    { role: "tool", callId: "a", name: "current_time", content: "now" },
    { role: "tool", callId: "b", name: "recall", content: "nothing", error: true },
  ];
  const same = _wire.toAnthropic(two, "claude-opus-5-5");
  assert.equal(same.length, 3);
  assert.equal(same[1].content[0].type, "thinking");
  assert.equal(same[2].content.length, 2);
  assert.equal(same[2].content[1].is_error, true);
  const other = _wire.toAnthropic(two, "claude-sonnet-5-5");
  assert.deepEqual(other[1].content.map((b) => b.type), ["tool_use", "tool_use"]);
});

const withFiles = [
  {
    role: "user",
    content: "what's this?",
    files: [
      { name: "shot.jpg", kind: "image", dataUrl: "data:image/jpeg;base64,QUJD" },
      { name: "notes.md", kind: "text", text: "# hi" },
    ],
  },
];

test("pictures and text files in each wire format", () => {
  const ollama = _wire.toOllama("", withFiles)[0];
  assert.deepEqual(ollama.images, ["QUJD"]);
  assert.match(ollama.content, /what's this\?\n\nAttached file notes\.md:\n```\n# hi\n```/);

  const openai = _wire.toOpenAI("", withFiles)[0];
  assert.equal(openai.content[0].type, "text");
  assert.deepEqual(openai.content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });

  const claude = _wire.toAnthropic(withFiles, "claude-opus-5-5")[0];
  assert.deepEqual(claude.content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  assert.equal(claude.content[1].type, "text");
});

test("thinking fields per protocol", async () => {
  const { thinkingFields } = await import("../src/lib/thinking.js");
  const effort = { mode: "effort", options: ["low", "medium", "high"] };
  assert.deepEqual(thinkingFields("ollama", { mode: "switch" }, false), { think: false });
  assert.deepEqual(thinkingFields("openai", effort, "high"), { reasoning_effort: "high" });
  assert.deepEqual(thinkingFields("anthropic", effort, "low"), { output_config: { effort: "low" } });
  assert.deepEqual(thinkingFields("openai", { mode: "none" }, "high"), {});
});
