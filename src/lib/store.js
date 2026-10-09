/* Everything the app keeps, in one object, in this machine's webview storage.
 *
 *   agents     [{ id, name, instructions, tools, look, model, createdAt }]
 *              tools: null = every ability, or a list of tool names
 *              model: null = the default model, or { provider, model }
 *   groups     [{ id, name, members: [agentId], createdAt }] -- group chats
 *   chats      { [agentId | groupId]: message[] } -- one ongoing chat per agent
 *              and per group; a group's agent messages carry `agentId`
 *   notes      { [agentId]: [{ text, at }] } -- notes agents kept before each
 *              had its own MEMORY.md; moved into it once (lib/agentMemory.js)
 *   providers  { [id]: { base?, key?, enabled? } } -- changes to the catalog
 *   custom     [{ id, kind, name, base, key }] -- servers the reader added
 *   defaultModel  { provider, model } | null
 *   connectors    accounts and servers agents can use (lib/connectors/index.js)
 *   search        { provider, keys, searxng, fallback } -- the web_search
 *                 tool's provider (lib/search.js); absent means the free tier
 *   widgets       [widgetId] -- the sidebar's widgets, top to bottom
 *                 (components/widgets)
 *   schedules     [schedule] -- tasks agents were asked to do later, once or
 *                 again and again (lib/schedule.js)
 *   background    false to quit when the window closes even with scheduled
 *                 tasks waiting; otherwise blvrd stays in the menu bar
 *   computers     { [chatId]: { where: "off" | "host" | "sandbox" } } -- each
 *                 chat's computer (lib/computer/connection.js)
 *   browser       { name, app, path, show } | null -- the browser the computer
 *                 uses on this Mac; null, the first Chromium one found
 *   fonts         { app, text, sections, widgets } -- font ids (lib/fonts.js)
 *   appIcon       { mascot, look } -- the Dock's icon (lib/appIcon.js)
 *   customWidgets { [id]: { name, html, data, by, updatedAt } } -- the reader's
 *                 own widgets (lib/widgets.js); each placed one is a live
 *                 section of the Notebook, "custom:<id>"
 *   toldConnectors { [chatId]: { [agentId]: { [group]: name } } } -- the
 *                 connectors each agent had when it last answered in a chat,
 *                 so it hears about new or gone ones in its next request
 *                 (lib/connectors/index.js connectorNote), never in the chat
 *
 * Nothing here leaves the machine. API keys are stored in the same place, in
 * plain text, which is the trade a single-user desktop app makes; the Settings
 * screen says so where a key is entered.
 */

import { CATALOG } from "./catalog.js";
import { EMPTY_CONNECTORS } from "./connectors/index.js";
import { isKept, keepFiles, payloadOf } from "./fileStore.js";

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
  widgets: ["calendar", "music", "agents", "groups", "settings"],
  schedules: [],
  computers: {},
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const data = JSON.parse(raw);
    return { ...EMPTY, ...data, chats: withRefs(data.chats), connectors: { ...EMPTY_CONNECTORS, ...(data.connectors || {}) } };
  } catch {
    return { ...EMPTY };
  }
}

/* A message's files are kept by reference: their contents live in the file
 * database (lib/fileStore.js), and this entry holds only { ref, name, kind }
 * -- so pictures can't fill the webview's small allowance for it. A file's
 * contents stay here until the database confirms it has them. */

// Files saved before they had a ref get one, so they move to the database.
function withRefs(chats = {}) {
  const out = {};
  for (const [id, messages] of Object.entries(chats)) {
    out[id] = (messages || []).map((m, at) =>
      m.files?.length ? { ...m, files: m.files.map((f, i) => (f.ref || !payloadOf(f) ? f : { ...f, ref: `${m.id || `${id}:${at}`}:${i}` })) } : m,
    );
  }
  return out;
}

function stripped(chats = {}) {
  const out = {};
  for (const [id, messages] of Object.entries(chats)) {
    out[id] = (messages || []).map((m) =>
      m.files?.length ? { ...m, files: m.files.map(({ dataUrl, text, ...rest }) => (rest.ref && isKept(rest.ref) ? rest : { ...rest, dataUrl, text })) } : m,
    );
  }
  return out;
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, chats: stripped(state.chats) }));
    return true;
  } catch {
    return false;
  }
}

/** Saves `state`. `onFail` hears about a save that didn't fit or failed. */
export function save(state, onFail) {
  const ok = write(state);
  // New files: once the database has them, write again without them inline.
  keepFiles(state.chats).then((kept) => {
    if (kept && !write(state) && ok) onFail?.();
  });
  if (!ok) onFail?.();
  return ok;
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
