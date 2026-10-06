/* Every connector's tools, from what the reader has connected.
 *
 *   connectors.google         { clientId, clientSecret, services, tokens, email }
 *   connectors.apple          { enabled, calendar, reminders }
 *   connectors.homeassistant  { url, token, ask, enabled }
 *   connectors.mcp            [{ id, name, transport, url, auth, token, command,
 *                                args, env, enabled, tools, oauth }]
 *   connectors.allow          { [toolName]: true } -- "always allow" answers
 *
 * Each tool carries a `group` (google, apple, home, mcp:<id>) so an agent can
 * be given a whole connector at once, and `confirm` when it acts rather than
 * looks -- those wait for the reader's yes in the chat (lib/run.js). */

import { appleTools } from "./apple.js";
import { googleTools } from "./google.js";
import { homeAssistantTools } from "./homeassistant.js";
import { callTool, toolNameFor } from "./mcp.js";

export const EMPTY_CONNECTORS = {
  google: null,
  apple: null,
  homeassistant: null,
  mcp: [],
  allow: {},
};

/* A JSON schema from an MCP server, made acceptable to every provider:
   no $schema, always an object with properties. */
function cleanSchema(schema) {
  const { $schema, ...rest } = schema || {};
  return { type: "object", properties: {}, ...rest };
}

/** A store for one MCP server's saved state, for the MCP client. */
export function mcpStore(getConnectors, patchConnectors) {
  return {
    get: (id) => getConnectors().mcp.find((s) => s.id === id),
    patch: (id, fn) =>
      patchConnectors((c) => ({ mcp: c.mcp.map((s) => (s.id === id ? { ...s, ...fn(s) } : s)) })),
  };
}

export function connectorTools(connectors, { getConnectors, patchConnectors }) {
  const c = { ...EMPTY_CONNECTORS, ...connectors };
  const tag = (group, groupLabel) => (tool) => ({ ...tool, group, groupLabel });
  const tools = [];

  if (c.google?.tokens?.access_token) {
    const save = (tokens) => patchConnectors((cc) => ({ google: { ...cc.google, tokens } }));
    tools.push(...googleTools(c.google, save).map(tag("google", "Google Workspace")));
  }
  if (c.apple?.enabled) tools.push(...appleTools(c.apple).map(tag("apple", "Apple Calendar & Reminders")));
  if (c.homeassistant?.enabled && c.homeassistant.url && c.homeassistant.token) {
    tools.push(...homeAssistantTools(c.homeassistant).map(tag("home", "Home Assistant")));
  }

  const store = mcpStore(getConnectors, patchConnectors);
  for (const server of c.mcp || []) {
    if (!server.enabled || !server.tools?.length) continue;
    const group = `mcp:${server.id}`;
    for (const t of server.tools) {
      tools.push({
        name: toolNameFor(server, t.name),
        label: t.title,
        description: `${server.name}: ${t.description}`.slice(0, 1024),
        parameters: cleanSchema(t.inputSchema),
        // Only a tool the server marks read-only runs without asking.
        confirm: !t.readOnly,
        summary: (args) => `${server.name} → ${t.title}${Object.keys(args || {}).length ? ` (${JSON.stringify(args).slice(0, 160)})` : ""}`,
        run: (args) => callTool(store.get(server.id) || server, store, t.name, args),
        group,
        groupLabel: server.name,
      });
    }
  }
  return tools;
}

/** The connector groups among `tools`, for the agent editor. */
export function groupsOf(tools) {
  const groups = new Map();
  for (const t of tools) {
    if (!t.group) continue;
    const g = groups.get(t.group) || { id: t.group, label: t.groupLabel, count: 0, acts: false };
    g.count += 1;
    g.acts ||= Boolean(t.confirm);
    groups.set(t.group, g);
  }
  return [...groups.values()];
}
