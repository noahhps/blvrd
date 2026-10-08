import { test } from "node:test";
import assert from "node:assert/strict";

import { _reset, formatResults, mcpText, parseExa, search } from "../src/lib/search.js";
import { clip } from "../src/lib/tools.js";

/* A fake network: `routes` maps a URL prefix to (url, init) -> Response. */
function network(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    const route = Object.keys(routes).find((prefix) => String(url).startsWith(prefix));
    if (!route) throw new TypeError(`Failed to fetch ${url}`);
    return routes[route](String(url), init);
  };
  return calls;
}

const reply = (body, status = 200, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

const EXA_TEXT = "Title: One\nURL: https://one.example\nPublished: 2026\nHighlights:\nfirst line\nsecond line\n---\nTitle: Two\nURL: https://two.example\nHighlights:\nmore";
const exaSse = () => reply(`event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: EXA_TEXT }] } })}\n\n`, 200, "text/event-stream");

test("Exa's text blocks become results", () => {
  assert.deepEqual(parseExa(EXA_TEXT), [
    { title: "One", url: "https://one.example", snippet: "first line second line" },
    { title: "Two", url: "https://two.example", snippet: "more" },
  ]);
});

test("an MCP answer is read from SSE or plain JSON, and a tool error is thrown", () => {
  assert.equal(mcpText('event: message\ndata: {"result":{"content":[{"type":"text","text":"hi"}]}}\n', "X"), "hi");
  assert.equal(mcpText('{"result":{"content":[{"type":"text","text":"hi"}]}}', "X"), "hi");
  assert.throws(() => mcpText('{"result":{"isError":true,"content":[{"type":"text","text":"rate limit"}]}}', "Exa"), /Exa: rate limit/);
});

test("the free tier moves on to the next service when one is busy", async () => {
  _reset(); // the ring starts at Exa
  const calls = network({
    "https://mcp.exa.ai": () => reply("Too Many Requests", 429),
    "https://search.parallel.ai": () =>
      reply({ result: { content: [{ type: "text", text: JSON.stringify({ results: [{ url: "https://p.example", title: "P", excerpts: ["a", "b"] }] }) }] } }),
  });
  const found = await search("the weather", { limit: 3 });
  assert.equal(found.via, "Parallel");
  assert.deepEqual(found.results, [{ title: "P", url: "https://p.example", snippet: "a b" }]);
  assert.equal(calls.length, 2);
});

test("the next search starts at the next service, and a repeat comes from the cache", async () => {
  _reset();
  const calls = network({ "https://mcp.exa.ai": exaSse, "https://search.parallel.ai": () => reply("down", 503) });
  await search("first", {});
  assert.equal(calls.length, 1); // Exa
  await search("second", {}); // starts at Parallel; only Exa answers, so it comes round to it last
  assert.equal(calls.at(-1), "https://mcp.exa.ai/mcp");
  const before = calls.length;
  const again = await search("  FIRST ", { limit: 1 });
  assert.equal(calls.length, before);
  assert.equal(again.results.length, 1);
});

test("when every free service fails, the error says so", async () => {
  _reset();
  network({});
  await assert.rejects(search("anything", {}), /every free search service failed/);
});

test("a chosen provider with a key is asked first, and the free tier stands in when it fails", async () => {
  _reset();
  network({
    "https://api.search.brave.com": (url, init) => {
      assert.equal(init.headers["X-Subscription-Token"], "k");
      return reply({ web: { results: [{ title: "B", url: "https://b.example", description: "brave" }] } });
    },
    "https://mcp.exa.ai": exaSse,
  });
  const settings = { provider: "brave", keys: { brave: "k" }, searxng: "", fallback: true };
  assert.equal((await search("q1", { settings })).via, "Brave Search");

  network({ "https://api.search.brave.com": () => reply({ error: "bad key" }, 401), "https://mcp.exa.ai": exaSse });
  const found = await search("q2", { settings });
  assert.equal(found.via, "Exa");
  assert.match(found.note, /Brave Search failed/);

  await assert.rejects(search("q3", { settings: { ...settings, fallback: false } }), /401/);
});

test("results are formatted for the model", () => {
  const text = formatResults("cats", { results: [{ title: "Cats", url: "https://c.example", snippet: "meow" }], via: "Exa" });
  assert.match(text, /^Results for "cats" \(from Exa\):/);
  assert.match(text, /1\. Cats\n {3}https:\/\/c\.example\n {3}meow/);
  assert.match(formatResults("x", { results: [], via: "Exa" }), /No results/);
});

test("a long page keeps its start and its end", () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
  const text = lines.join("\n");
  const out = clip(text, 1000);
  assert.ok(out.length < 1200);
  assert.ok(out.startsWith("line 0\n"));
  assert.ok(out.endsWith("line 1999"));
  assert.match(out, /characters from the middle of the page left out, of \d+/);
  assert.equal(clip("short", 1000), "short");
});
