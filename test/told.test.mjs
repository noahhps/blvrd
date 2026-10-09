/* Telling an agent about connectors connected or disconnected since its last
 * turn (lib/connectors/index.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { connectorNote, connectorsOf } from "../src/lib/connectors/index.js";

const tool = (name, group, groupLabel) => ({ name, group, groupLabel });

test("only connectors count, each once, by name", () => {
  const tools = [
    tool("notion__search", "mcp:n", "Notion"),
    tool("notion__fetch", "mcp:n", "Notion"),
    tool("gmail_search", "google", "Google Workspace"),
    tool("computer", "computer", "The computer"),
    tool("schedule", "schedule", "Tasks"),
    { name: "web_search" },
  ];
  assert.deepEqual(connectorsOf(tools), { "mcp:n": "Notion", google: "Google Workspace" });
});

test("never told: nothing to say yet; unchanged: nothing either", () => {
  assert.equal(connectorNote(undefined, { "mcp:n": "Notion" }), "");
  assert.equal(connectorNote({ "mcp:n": "Notion" }, { "mcp:n": "Notion" }), "");
});

test("what's new and what's gone, in one line", () => {
  assert.equal(
    connectorNote({}, { "mcp:n": "Notion" }),
    "(Connectors: The user has just connected Notion: its tools are now among yours, so use it when it helps with what they ask.)",
  );
  const note = connectorNote({ google: "Google Workspace" }, { "mcp:n": "Notion", "mcp:l": "Linear", home: "Home Assistant" });
  assert.match(note, /connected Notion, Linear and Home Assistant: their tools/);
  assert.match(note, /Google Workspace was disconnected: its tools are gone\./);
});
