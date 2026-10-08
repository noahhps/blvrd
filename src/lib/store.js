/* Everything the app keeps, in one object, in this machine's webview storage.
 *
 *   agents     [{ id, name, instructions, tools, look, model, createdAt }]
 *              tools: null = every ability, or a list of tool names
 *              model: null = the default model, or { provider, model }
 *   groups     [{ id, name, members: [agentId], createdAt }] -- group chats
 *   chats      { [agentId | groupId]: message[] } -- one ongoing chat per agent
 *              and per group; a group's agent messages carry `agentId`
 *   notes      { [agentId]: [{ text, at }] } -- each agent's notebook
 *   providers  { [id]: { base?, key?, enabled? } } -- changes to the catalog
 *   custom     [{ id, kind, name, base, key }] -- servers the reader added
 *   defaultModel  { provider, model } | null
 *   connectors    accounts and servers agents can use (lib/connectors/index.js)
 *   search        { provider, keys, searxng, fallback } -- the web_search
 *                 tool's provider (lib/search.js); absent means the free tier
 *   widgets       [widgetId] -- the sidebar's widgets, top to bottom
 *                 (components/widgets)
 *
 * Nothing here leaves the machine. API keys are stored in the same place, in
 * plain text, which is the trade a single-user desktop app makes; the Settings
 * screen says so where a key is entered.
 */

import { CATALOG } from "./catalog.js";
import { EMPTY_CONNECTORS } from "./connectors/index.js";

const KEY = "blvrd.v1";

export const EMPTY = {
  version: 1,
  agents: [],
  groups: [],
  chats: {},
  notes: {},
  providers: {},
  custom: [],
  defaultModel: null,
  connectors: EMPTY_CONNECTORS,
  widgets: ["calendar"],
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const data = JSON.parse(raw);
    return { ...EMPTY, ...data, connectors: { ...EMPTY_CONNECTORS, ...(data.connectors || {}) } };
  } catch {
    return { ...EMPTY };
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Every provider, catalog entries with the reader's changes on top, then
 *  the ones they added. `enabled` defaults to on for local servers (they cost
 *  nothing and leak nothing) and off for hosted ones until a key is entered. */
export function providersOf(state) {
  const fromCatalog = CATALOG.map((entry) => {
    const saved = state.providers[entry.id] || {};
    const local = !entry.keys;
    return {
      ...entry,
      base: saved.base || entry.base,
      key: saved.key || "",
      enabled: saved.enabled ?? (local ? true : Boolean(saved.key)),
      custom: false,
    };
  });
  const custom = (state.custom || []).map((p) => ({ ...p, enabled: p.enabled ?? true, custom: true }));
  return [...fromCatalog, ...custom];
}
