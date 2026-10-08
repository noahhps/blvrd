import { useSyncExternalStore } from "react";

/* The Notebook: one living document between the user and every agent.
 *
 * The user makes its sections; agents read them and keep them up to date as
 * they learn about the user -- each agent is told it is *its* notebook about
 * the user, and finds out someone else writes in it only when it opens a
 * section another hand has changed since it last looked. Any section can be
 * dragged into the sidebar as a widget (components/widgets/NotebookWidget.jsx).
 *
 *   section  { id, title, type, data, version, edited: { by, at }, seen,
 *              createdAt }
 *     at     { x, y } -- where it sits on the page, which goes on down and
 *            sideways (lib/placement.js); none yet: laid out once, then kept
 *     type   "facts" { rows: [{ key, value }] } -- labelled values
 *            "list"  { items: [{ id, text, done }] } -- things to keep or do
 *            "note"  { text } -- free writing
 *            "text"  { text } -- words written straight onto the page
 *     by     "user" or an agent's id
 *     seen   { [agentId]: version } -- the version each agent last read
 *     live   { source } -- kept by the app, not written: what a sidebar
 *            widget shows (LIVE below), read by agents like any section
 *   settings { approve, liveAdded, sidebar } -- agents' edits wait for the
 *            user's yes; which live sections have been put in once already;
 *            the sidebar: the sections dragged into it, in its own order
 *
 * The notebook is the scratchpad where widgets are made; the sidebar is
 * where the ones wanted day to day go -- dragged there from the page.
 *
 * Kept in this machine's webview database (IndexedDB); nothing leaves it. */

export const TYPES = {
  facts: { label: "Facts", hint: "Labelled values — birthday, coffee order, shirt size", empty: () => ({ rows: [] }) },
  list: { label: "List", hint: "Things to keep or do — gift ideas, places to try", empty: () => ({ items: [] }) },
  note: { label: "Note", hint: "Free writing — how they like to work, what matters to them", empty: () => ({ text: "" }) },
  // Words written straight onto the page, wherever there was room: no title
  // of its own (it goes by its first line).
  text: { label: "Text", hint: "Words anywhere on the page", empty: () => ({ text: "" }) },
};

/** What a free text is called: its first line, shortened. */
export const textTitle = (text) => {
  const line = String(text || "").trim().split("\n")[0].trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || "Text";
};

/* The sidebar's widgets, as sections the app keeps current. Each is put in
 * the notebook once; deleted, it stays out until added back ("/"). Their rows
 * come from `provideLive` (App.jsx), built by lib/liveRows.js. */
export const LIVE = {
  calendar: { title: "Calendar", hint: "The next week of events, from your calendars", empty: "Nothing in the next week." },
  music: { title: "Now playing", hint: "What Music or Spotify is playing", empty: "Nothing is playing." },
  agents: { title: "Agents", hint: "Your agents and what each does", empty: "No agents yet.", fixed: true },
  groups: { title: "Groups", hint: "Your group chats and who's in them", empty: "No groups yet.", fixed: true },
  setup: { title: "Setup", hint: "Your default model and what's connected", empty: "", fixed: true },
};
// `fixed`: always in the sidebar and the notebook -- the way to chats,
// groups, settings and the Notebook itself.
export const isFixed = (section) => section?.type === "live" && Boolean(LIVE[section.source]?.fixed);

const providers = new Map(); // source -> () => rows | Promise<rows>

/** Where a live section's rows come from: `rows()` -> [{ key, value }]. */
export const provideLive = (source, rows) => providers.set(source, rows);

/** A live section's rows now ([] if the app can't say). */
export async function liveRows(source) {
  try {
    return (await providers.get(source)?.()) || [];
  } catch {
    return [];
  }
}

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/* -- edits ----------------------------------------------------------------------
 * The same edits for the user's hand and an agent's tool, checked the same
 * way. `apply` returns the section's new data, or throws with what was wrong
 * (which the agent reads). */

export const ACTIONS = {
  facts: ["set", "remove"],
  list: ["add", "check", "uncheck", "remove"],
  note: ["replace", "append"],
  text: ["replace", "append"],
};

export function apply(section, edit) {
  if (section.type === "live") throw new Error(`“${section.title}” is kept up to date by the app: you can read it, not change it`);
  const { action } = edit;
  const allowed = ACTIONS[section.type] || [];
  if (!allowed.includes(action)) throw new Error(`“${section.title}” is a ${TYPES[section.type].label.toLowerCase()} section: use ${allowed.join(", ")}`);
  const need = (field) => {
    const v = String(edit[field] ?? "").trim();
    if (!v) throw new Error(`${action} needs ${field}`);
    return v;
  };
  if (section.type === "facts") {
    const rows = section.data.rows;
    const key = need("key");
    if (action === "remove") {
      if (!rows.some((r) => same(r.key, key))) throw new Error(`there is no “${key}” in “${section.title}”`);
      return { rows: rows.filter((r) => !same(r.key, key)) };
    }
    const value = need("value");
    return rows.some((r) => same(r.key, key))
      ? { rows: rows.map((r) => (same(r.key, key) ? { ...r, value } : r)) }
      : { rows: [...rows, { key, value }] };
  }
  if (section.type === "list") {
    const items = section.data.items;
    const text = need("item");
    if (action === "add") {
      if (items.some((i) => same(i.text, text))) throw new Error(`“${text}” is already in “${section.title}”`);
      return { items: [...items, { id: newId("i"), text, done: false }] };
    }
    if (!items.some((i) => same(i.text, text))) throw new Error(`there is no “${text}” in “${section.title}”`);
    if (action === "remove") return { items: items.filter((i) => !same(i.text, text)) };
    return { items: items.map((i) => (same(i.text, text) ? { ...i, done: action === "check" } : i)) };
  }
  const text = action === "replace" ? String(edit.text ?? "") : need("text");
  return { text: action === "replace" ? text.trim() : [section.data.text, text].filter(Boolean).join("\n\n") };
}

/* -- how an agent reads it ------------------------------------------------------ */

/** A section as text, for a model. */
export function asText(section) {
  if (section.type === "facts")
    return section.data.rows.length ? section.data.rows.map((r) => `- ${r.key}: ${r.value}`).join("\n") : "(nothing yet)";
  if (section.type === "list")
    return section.data.items.length ? section.data.items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n") : "(nothing yet)";
  return section.data.text.trim() || "(nothing yet)";
}

/** The section `name` names (by title, or id), or null. */
export const find = (sections, name) => sections.find((s) => s.id === name || same(s.title, name)) || null;

/** Who last changed a section, as the agent `agentId` should hear it -- or
 *  null if it was that agent, or nothing changed since it last looked. */
export function changedBy(section, agentId, nameOf) {
  if ((section.seen?.[agentId] || 0) >= section.version || !section.edited || section.edited.by === agentId) return null;
  return section.edited.by === "user" ? "the user" : `${nameOf(section.edited.by)} (another assistant)`;
}

/* -- the store ------------------------------------------------------------------ */

const NAME = "blvrd-notebook";
let state = { sections: [], settings: { approve: false, liveAdded: [] }, loaded: false };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

let opening = null;
function db() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return opening;
}
const kv = (mode, fn) =>
  db().then(
    (d) =>
      d &&
      new Promise((resolve) => {
        const tx = d.transaction("kv", mode);
        const out = fn(tx.objectStore("kv"));
        tx.oncomplete = () => resolve(out?.result ?? true);
        tx.onerror = tx.onabort = () => resolve(null);
      }),
  );

/** Resolves once what was kept is in. */
export const ready = kv("readonly", (s) => s.get("notebook")).then((saved) => {
  if (saved?.sections) state = { ...state, sections: saved.sections, settings: { ...state.settings, ...saved.settings } };
  state = { ...state, loaded: true };
  // The widgets, at the top of the page, the first time each is known.
  const added = state.settings.liveAdded || [];
  const fresh = Object.keys(LIVE).filter((source) => !added.includes(source));
  if (fresh.length) {
    const made = fresh.map(liveSection);
    const sidebar = state.settings.sidebar ? [...state.settings.sidebar, ...made.map((s) => s.id)] : state.settings.sidebar;
    commit({ sections: [...made, ...state.sections], settings: { ...state.settings, liveAdded: [...added, ...fresh], sidebar } });
  } else emit();
});

function liveSection(source) {
  return { id: newId("live"), title: LIVE[source].title, type: "live", source, data: {}, version: 1, edited: null, seen: {}, createdAt: Date.now() };
}

function commit(next) {
  state = { ...state, ...next };
  emit();
  kv("readwrite", (s) => s.put({ sections: state.sections, settings: state.settings }, "notebook"));
}

const setSection = (id, fn) => commit({ sections: state.sections.map((s) => (s.id === id ? fn(s) : s)) });

export const notebook = {
  get: () => state,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** A new section, at `index` (the end if left out), holding `data` if
   *  given, sitting at `at` on the page if given. */
  add(type, title, index = state.sections.length, data = null, at = null) {
    const content = data || TYPES[type].empty();
    const named = type === "text" ? textTitle(content.text) : title || TYPES[type].label;
    const section = { id: newId("sec"), title: named, type, data: content, version: 1, edited: { by: "user", at: Date.now() }, seen: {}, createdAt: Date.now(), ...(at ? { at } : {}) };
    commit({ sections: [...state.sections.slice(0, index), section, ...state.sections.slice(index)] });
    return section;
  },
  /** Where a section sits on the page. */
  place: (id, at) => setSection(id, (s) => ({ ...s, at })),
  /** Several placed at once ({ [id]: { x, y } }): ones that had no place yet. */
  placeMany: (where) => commit({ sections: state.sections.map((s) => (where[s.id] ? { ...s, at: where[s.id] } : s)) }),
  remove(id) {
    const at = state.sections.findIndex((s) => s.id === id);
    const gone = state.sections[at];
    if (isFixed(gone)) return () => {};
    // A sidebar not made yet (connectSidebar) is left unmade.
    const sidebar = state.settings.sidebar;
    const slot = sidebar ? sidebar.indexOf(id) : -1;
    commit({ sections: state.sections.filter((s) => s.id !== id), settings: { ...state.settings, sidebar: sidebar && sidebar.filter((x) => x !== id) } });
    // Put back where it was -- in the sidebar too, if it was there.
    return () => {
      if (!gone) return;
      const now = state.settings.sidebar;
      commit({
        sections: [...state.sections.slice(0, at), gone, ...state.sections.slice(at)],
        settings: { ...state.settings, sidebar: !now || slot === -1 ? now : [...now.slice(0, slot), id, ...now.slice(slot)] },
      });
    };
  },
  rename: (id, title) => setSection(id, (s) => ({ ...s, title })),
  /** A section into the sidebar at `at` (the end if left out); one already
   *  there moves. */
  addToSidebar(id, at = Infinity) {
    const rest = (state.settings.sidebar || []).filter((x) => x !== id);
    const i = Math.max(0, Math.min(at, rest.length));
    commit({ settings: { ...state.settings, sidebar: [...rest.slice(0, i), id, ...rest.slice(i)] } });
  },
  /** Out of the sidebar (it stays in the notebook) -- not a fixed one. */
  removeFromSidebar(id) {
    if (isFixed(state.sections.find((s) => s.id === id))) return;
    commit({ settings: { ...state.settings, sidebar: (state.settings.sidebar || []).filter((x) => x !== id) } });
  },
  showInSidebar: (id, shown) => (shown ? notebook.addToSidebar(id) : notebook.removeFromSidebar(id)),
  /** The sidebar in a new order (dragged there). */
  setSidebar: (ids) => commit({ settings: { ...state.settings, sidebar: ids } }),
  /** Once: the sidebar is made from what it showed before -- each widget's
   *  section, in the order it had (`order`: the old widget ids), then any
   *  section that had been put in it. */
  connectSidebar(order = []) {
    if (state.settings.sidebar) return;
    const rank = (s) => {
      const i = order.indexOf(s.source === "setup" ? "settings" : s.source);
      return i === -1 ? order.length : i;
    };
    const live = state.sections.filter((s) => s.type === "live").sort((a, b) => rank(a) - rank(b));
    const mine = state.sections.filter((s) => s.type !== "live" && (s.widget || order.includes(`nb:${s.id}`)));
    commit({ settings: { ...state.settings, sidebar: [...live, ...mine].map((s) => s.id) } });
  },
  /** Sections in the order of `ids` (as dragged on the Notebook screen). */
  order: (ids) => {
    const byId = new Map(state.sections.map((s) => [s.id, s]));
    commit({ sections: [...ids.map((id) => byId.get(id)).filter(Boolean), ...state.sections.filter((s) => !ids.includes(s.id))] });
  },
  /** The user's hand: the data as it now stands. */
  write: (id, data) =>
    setSection(id, (s) => ({ ...s, data, ...(s.type === "text" ? { title: textTitle(data.text) } : {}), version: s.version + 1, edited: { by: "user", at: Date.now() } })),
  /** An agent's edit (checked by `apply`); the agent has now seen it. */
  edit(id, agentId, change) {
    const section = state.sections.find((s) => s.id === id);
    const data = apply(section, change);
    const version = section.version + 1;
    setSection(id, (s) => ({ ...s, data, ...(s.type === "text" ? { title: textTitle(data.text) } : {}), version, edited: { by: agentId, at: Date.now() }, seen: { ...s.seen, [agentId]: version } }));
  },
  markSeen: (id, agentId) => setSection(id, (s) => ({ ...s, seen: { ...s.seen, [agentId]: s.version } })),
  setApprove: (approve) => commit({ settings: { ...state.settings, approve } }),
  /** A live section put back (or in), at `index`. */
  addLive(source, index = 0) {
    const section = liveSection(source);
    commit({ sections: [...state.sections.slice(0, index), section, ...state.sections.slice(index)] });
    return section;
  },
};

/** Whether a section is in the sidebar. */
export const inSidebar = (id) => (state.settings.sidebar || []).includes(id);

/** The notebook, kept current in a component. */
export const useNotebook = () => useSyncExternalStore(notebook.subscribe, notebook.get);
