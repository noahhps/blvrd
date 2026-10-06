import { test } from "node:test";
import assert from "node:assert/strict";

import { connectorTools, groupsOf } from "../src/lib/connectors/index.js";
import { bodyOf, decodeBase64Url, rawMessage } from "../src/lib/connectors/google.js";
import { findEntities } from "../src/lib/connectors/homeassistant.js";
import { NeedsSignIn, _internals, listTools, callTool, toolNameFor } from "../src/lib/connectors/mcp.js";
import { resourceMetadataFrom } from "../src/lib/oauth.js";
import { runTurn } from "../src/lib/run.js";
import { toolsFor } from "../src/lib/tools.js";

const json = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
const sseResponse = (messages) =>
  new Response(messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

test("an MCP server over HTTP: session, JSON and streamed answers, paginated tools, a call", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const msg = JSON.parse(init.body);
    seen.push({ method: msg.method, session: init.headers["Mcp-Session-Id"], auth: init.headers.Authorization });
    if (msg.method === "initialize") return json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } } }, { "Mcp-Session-Id": "s-1" });
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "tools/list" && !msg.params?.cursor)
      return sseResponse([{ jsonrpc: "2.0", method: "notifications/progress" }, { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "search", description: "Find pages", inputSchema: { $schema: "x", type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } }], nextCursor: "2" } }]);
    if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "create-page", description: "Make a page" }] } });
    if (msg.method === "tools/call") return json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `found ${msg.params.arguments.q}` }] } });
    throw new Error("unexpected " + msg.method);
  });
  const server = { id: "n1", name: "Notion", url: "https://mcp.example/mcp", auth: "bearer", token: "tok", transport: "http" };
  const store = { get: () => server, patch: () => {} };
  const tools = await listTools(server, store);
  assert.deepEqual(tools.map((x) => [x.name, x.readOnly]), [["search", true], ["create-page", false]]);
  assert.equal(await callTool(server, store, "search", { q: "roadmap" }), "found roadmap");
  assert.deepEqual(seen.map((s) => s.method), ["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call"]);
  assert.equal(seen[0].session, undefined);
  assert.ok(seen.slice(1).every((s) => s.session === "s-1"), "later requests carry the session");
  assert.ok(seen.every((s) => s.auth === "Bearer tok"));
});

test("a 401 from an OAuth server asks for sign-in", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"' } }));
  const client = new _internals.HttpClient({ id: "a", name: "Linear", url: "https://x/mcp", auth: "none" }, {});
  await assert.rejects(client.request("initialize", {}), (e) => e instanceof NeedsSignIn && /resource_metadata/.test(e.wwwAuthenticate));
  assert.equal(resourceMetadataFrom('Bearer error="x", resource_metadata="https://x/.well-known/oauth-protected-resource"'), "https://x/.well-known/oauth-protected-resource");
});

test("MCP tool names are safe for every provider", () => {
  assert.equal(toolNameFor({ name: "Jira & Confluence" }, "getJiraIssue"), "jira_confluence__getjiraissue");
  assert.ok(toolNameFor({ name: "x".repeat(80) }, "y").length <= 64);
});

test("Gmail bodies are decoded, plain text preferred, HTML as text", () => {
  const enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(decodeBase64Url(enc("héllo ✓")), "héllo ✓");
  const payload = { parts: [{ mimeType: "text/html", body: { data: enc("<p>Hi <b>there</b></p>") } }, { mimeType: "text/plain", body: { data: enc("Hi there") } }] };
  assert.equal(bodyOf(payload), "Hi there");
  assert.equal(bodyOf({ parts: [{ mimeType: "text/html", body: { data: enc("<p>Only html</p>") } }] }), "Only html");
});

test("an outgoing email is a valid RFC 822 message, non-ASCII subject encoded", () => {
  const raw = rawMessage({ to: "a@b.c", subject: "Café plans", body: "Hello" });
  const text = decodeBase64Url(raw);
  assert.match(text, /^To: a@b\.c\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(text, /\r\n\r\nHello$/);
});

test("Home Assistant search matches every word, in id, name or area", () => {
  const states = [
    { entity_id: "light.kitchen_ceiling", state: "on", attributes: { friendly_name: "Kitchen ceiling" } },
    { entity_id: "light.bedroom", state: "off", attributes: { friendly_name: "Bedroom lamp" } },
    { entity_id: "switch.kitchen_kettle", state: "off", attributes: { friendly_name: "Kettle" } },
  ];
  assert.deepEqual(findEntities(states, { query: "kitchen" }).map((s) => s.entity_id), ["light.kitchen_ceiling", "switch.kitchen_kettle"]);
  assert.deepEqual(findEntities(states, { query: "kitchen", domain: "light" }).map((s) => s.entity_id), ["light.kitchen_ceiling"]);
  assert.deepEqual(findEntities(states, { query: "bedroom lamp" }).map((s) => s.entity_id), ["light.bedroom"]);
});

test("connectors become tool groups; an agent can be given a whole group", () => {
  const connectors = {
    homeassistant: { enabled: true, url: "http://ha.local:8123", token: "t" },
    mcp: [{ id: "n1", name: "Notion", enabled: true, tools: [{ name: "search", title: "Search", description: "", inputSchema: { $schema: "x" }, readOnly: true }, { name: "create", title: "Create", description: "", readOnly: false }] }],
  };
  const tools = connectorTools(connectors, { getConnectors: () => connectors, patchConnectors: () => {} });
  assert.deepEqual(tools.map((t) => t.name), ["home_find", "home_state", "home_action", "notion__search", "notion__create"]);
  assert.equal(tools.find((t) => t.name === "notion__search").parameters.$schema, undefined);
  assert.deepEqual(tools.filter((t) => t.confirm).map((t) => t.name), ["home_action", "notion__create"]);
  assert.deepEqual(groupsOf(tools).map((g) => [g.id, g.count, g.acts]), [["home", 3, true], ["mcp:n1", 2, true]]);
  const agent = { tools: ["calculate", "group:mcp:n1"] };
  assert.deepEqual(toolsFor(agent, tools).map((t) => t.name), ["notion__search", "notion__create"]);
});

function ndjsonResponse(objects) {
  return new Response(objects.map((o) => JSON.stringify(o)).join("\n") + "\n", { status: 200 });
}

test("a tool that acts waits for approval: a no is reported, a yes runs it", async (t) => {
  let ran = 0;
  const act = { name: "send_it", label: "Send it", confirm: true, parameters: { type: "object", properties: {} }, summary: () => "Send the thing", run: () => (ran++, "sent") };
  const run = async (answer) => {
    const replies = [
      [{ message: { content: "", tool_calls: [{ function: { name: "send_it", arguments: {} } }] }, done: true }],
      [{ message: { content: "ok" }, done: true }],
    ];
    t.mock.method(globalThis, "fetch", async () => ndjsonResponse(replies.shift()));
    const asked = [];
    const messages = [];
    await runTurn({
      agent: { name: "A", tools: null },
      provider: { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" },
      model: "m",
      history: [{ role: "user", content: "send it" }],
      available: [act],
      approve: async (req) => (asked.push(req.summary), answer),
      emit: (e) => e.type === "message" && messages.push(e.message),
      notebook: { notes: () => [], addNote: () => {} },
    });
    return { asked, tool: messages.find((m) => m.role === "tool") };
  };
  const no = await run(false);
  assert.deepEqual(no.asked, ["Send the thing"]);
  assert.equal(no.tool.declined, true);
  assert.equal(ran, 0);
  const yes = await run(true);
  assert.equal(yes.tool.content, "sent");
  assert.equal(ran, 1);
});
