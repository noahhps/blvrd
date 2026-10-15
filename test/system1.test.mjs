import assert from "node:assert/strict";
import { test } from "node:test";

import { cosine, embed, inputsFor, run } from "../src/lib/system1.js";

const ollama = { id: "o", kind: "ollama", name: "Ollama", base: "http://localhost:11434/" };

// Answer every request with `reply(url, body)`, and keep what was asked.
function serve(reply) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push({ url, body });
    const [status, json] = reply(url, body);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  return { asked, done: () => (globalThis.fetch = real) };
}

test("Ollama is asked at /api/embed, with every text in one input array", async () => {
  const s = serve(() => [200, { embeddings: [[1, 0], [0, 1]], prompt_eval_count: 7, total_duration: 3_000_000 }]);
  try {
    const out = await embed({ provider: ollama, model: "all-minilm", texts: ["a", "b"] });
    assert.equal(s.asked[0].url, "http://localhost:11434/api/embed");
    assert.deepEqual(s.asked[0].body, { model: "all-minilm", input: ["a", "b"], truncate: true });
    assert.deepEqual(out, { vectors: [[1, 0], [0, 1]], tokens: 7, ms: 3 });
  } finally {
    s.done();
  }
});

test("dimensions are only sent when asked for", async () => {
  const s = serve(() => [200, { embeddings: [[1]] }]);
  try {
    await embed({ provider: ollama, model: "nomic-embed-text", texts: ["a"], dimensions: 256 });
    assert.equal(s.asked[0].body.dimensions, 256);
  } finally {
    s.done();
  }
});

test("an OpenAI-compatible server is asked at /embeddings, and its answer put back in order", async () => {
  const s = serve(() => [200, { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4 } }]);
  try {
    const out = await embed({ provider: { kind: "openai", base: "http://x/v1", key: "k" }, model: "m", texts: ["a", "b"] });
    assert.equal(s.asked[0].url, "http://x/v1/embeddings");
    assert.deepEqual(out.vectors, [[1, 0], [0, 1]]);
    assert.equal(out.tokens, 4);
  } finally {
    s.done();
  }
});

test("a chat model is turned away with a reason, and a missing one with the pull command", async () => {
  let s = serve(() => [400, { error: '"qwen3:0.6b" does not support embeddings' }]);
  try {
    await assert.rejects(embed({ provider: ollama, model: "qwen3:0.6b", texts: ["a"] }), /isn't an embedding model/);
  } finally {
    s.done();
  }
  s = serve(() => [404, { error: 'model "nomic-embed-text" not found, try pulling it first' }]);
  try {
    await assert.rejects(embed({ provider: ollama, model: "nomic-embed-text", texts: ["a"] }), /ollama pull nomic-embed-text/);
  } finally {
    s.done();
  }
});

test("nomic's task prefixes are added, and other models get the text as it is", () => {
  const nomic = inputsFor("rank", "what is a cat\n\nA cat is a pet.\nRain is wet.", {}, "nomic-embed-text");
  assert.deepEqual(nomic.texts, ["search_query: what is a cat", "search_document: A cat is a pet.", "search_document: Rain is wet."]);
  const plain = inputsFor("dedupe", "a\nb", {}, "all-minilm");
  assert.deepEqual(plain.texts, ["a", "b"]);
});

test("each task says what it is missing", () => {
  assert.throws(() => inputsFor("classify", "hi", { labels: ["one"] }, "m"), /two labels/);
  assert.throws(() => inputsFor("rank", "just a query", {}, "m"), /blank line/);
  assert.throws(() => inputsFor("match", "only one text", {}, "m"), /two texts/);
  assert.throws(() => inputsFor("dedupe", "one line", {}, "m"), /two lines/);
});

test("classify picks the label nearest the text", async () => {
  const s = serve(() => [200, { embeddings: [[1, 0.1], [0, 1], [1, 0]] }]);
  try {
    const { result, markdown } = await run({ provider: ollama, model: "all-minilm", task: "classify", input: "it crashes", config: { labels: ["praise", "bug report"] } });
    assert.equal(result.best.label, "bug report");
    assert.match(markdown, /\*\*bug report\*\*/);
  } finally {
    s.done();
  }
});

test("dedupe keeps only the pairs above the threshold", async () => {
  const s = serve(() => [200, { embeddings: [[1, 0], [0.99, 0.05], [0, 1]] }]);
  try {
    const { result } = await run({ provider: ollama, model: "all-minilm", task: "dedupe", input: "a\nA\nz", config: { threshold: 0.9 } });
    assert.equal(result.pairs.length, 1);
    assert.deepEqual([result.pairs[0].a, result.pairs[0].b], ["a", "A"]);
  } finally {
    s.done();
  }
});

test("cosine similarity", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 0]), 0);
});
