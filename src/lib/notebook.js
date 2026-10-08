import { useSyncExternalStore } from "react";

import { applyOps, bare, diffData, diffSections, invertAll, newEntryId, stale, targetOf, withRowIds } from "./versions.js";

/* The Notebook: one living document between the user and every agent -- and
 * their shared memory.
 *
 * The user makes its sections; agents read them and keep them up to date as
 * they learn about the user. Any section can be dragged into the sidebar as a
 * widget (components/widgets/NotebookWidget.jsx).
 *
 * It is kept in versions (docs/notebook-sync.md). Every saved change -- one
 * save of the user's, or one agent's tool call -- makes the next version
 * (`head`), recorded as operations (lib/versions.js) in a log. Agents read
 * the head and catch up from the version they last saw (lib/notebookSync.js).
 * The user's edits show at once but wait in a draft until saved: by hand
 * (⌘S), or a few seconds after their hand leaves the notebook (`hold`).
 * Every edit of theirs can be undone and redone; a saved one is undone by a
 * new version that reverses it, since an agent may already have read it.
 *
 *   section  { id, title, type, data, createdAt, v, ev, edited: { by, at } }
 *     type   "facts" { rows: [{ id, key, value }] } -- labelled values
 *            "list"  { items: [{ id, text, done }] } -- things to keep or do
 *            "note"  { text } -- free writing
 *            "text"  { text } -- words written straight onto the page
 *            "live"  { source } -- kept by the app, not written: what a
 *            sidebar widget shows (LIVE below), read by agents like any section
 *     v      the version that last changed it; ev { [entryId]: v } the same
 *            for each row and item
 *     by     "user" or an agent's id
 *   version  { v, by, at, chat, label, revertOf, ops }
 *   layout   { [sectionId]: { x, y } } -- where each sits on the page, which
 *            goes on down and sideways (lib/placement.js). Not memory: not
 *            versioned, and never in a draft. Read back as `section.at`.
 *   settings { approve, liveAdded, sidebar, saveDelay } -- agents' edits wait
 *            for the user's yes; which live sections have been put in once
 *            already; the sidebar's sections, in its order; how long after the
 *            user's hand leaves the notebook their draft is saved (ms; null:
 *            only when they save)
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

export const DEFAULT_SAVE_DELAY = 3000;
export const KEEP_VERSIONS = 1000; // at least this many, and every one from
export const KEEP_DAYS = 90; // the last this many days
export const UNDO_STEPS = 200;

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
  note: ["replace", "append", "revise"],
  text: ["replace", "append", "revise"],
};

/** How many times `part` occurs in `text`. */
const occurrences = (text, part) => (part ? text.split(part).length - 1 : 0);

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
      : { rows: [...rows, { id: newEntryId("r"), key, value }] };
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
  const current = String(section.data.text ?? "");
  if (action === "revise") {
    const old = String(edit.old ?? "");
    if (!old.trim()) throw new Error("revise needs old: the words to change, exactly as they are");
    const found = occurrences(current, old);
    if (found !== 1) throw new Error(found ? `“${old}” is in “${section.title}” ${found} times: give more of the words around it` : `“${old}” isn't in “${section.title}” (it may have changed): read it and try again`);
    return { text: current.replace(old, String(edit.new ?? "")).trim() };
  }
  const text = action === "replace" ? String(edit.text ?? "") : need("text");
  return { text: action === "replace" ? text.trim() : [current, text].filter(Boolean).join("\n\n") };
}

/* -- how an agent reads it ------------------------------------------------------ */

/** A section as text, for a model. */
export function asText(section) {
  if (section.type === "facts")
    return section.data.rows.length ? section.data.rows.map((r) => `- ${r.key}: ${r.value}`).join("\n") : "(nothing yet)";
  if (section.type === "list")
    return section.data.items.length ? section.data.items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n") : "(nothing yet)";
  return String(section.data.text ?? "").trim() || "(nothing yet)";
}

/** The section `name` names (by title, or id), or null. */
export const find = (sections, name) => sections.find((s) => s.id === name || same(s.title, name)) || null;

/* -- storage ---------------------------------------------------------------------
 * One database: "kv" holds the notebook as saved (and the user's draft),
 * "versions" the log, "cursors" where each agent last caught up
 * (lib/notebookSync.js). With no IndexedDB (the tests) it all lives in memory. */

const NAME = "blvrd-notebook";
// The quickview (lib/quick.js) is the same page in a second window. It loads
// this module too but never shows or changes the notebook, so it only reads:
// two windows writing one notebook would each make "the next" version.
const reader = typeof location !== "undefined" && location.hash === "#quick";
let opening = null;
function db() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("versions")) d.createObjectStore("versions", { keyPath: "v" });
      if (!d.objectStoreNames.contains("cursors")) d.createObjectStore("cursors");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return opening;
}
const run = (store, mode, fn) =>
  reader && mode !== "readonly" ? Promise.resolve(null) : db().then(
    (d) =>
      d &&
      new Promise((resolve) => {
        const tx = d.transaction(store, mode);
        const out = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(out?.result ?? true);
        tx.onerror = tx.onabort = () => resolve(null);
      }),
  );

/* -- the store ------------------------------------------------------------------ */

let committed = []; // the sections at `head`: what agents read
let layout = {};
let settings = { approve: false, liveAdded: [], saveDelay: DEFAULT_SAVE_DELAY };
let head = 1;
let log = []; // versions, oldest first
let draft = []; // [{ op, step }]: the user's unsaved operations
let undoStack = []; // [{ step, ops, saved: v | null }]
let redoStack = [];
let conflicts = []; // [{ target, sec, id, by }]: changed by an agent under the user's draft
const cursors = new Map(); // `${agentId}|${chatId}` -> { v, anchor }

let state = { sections: [], settings, loaded: false, head, pending: false, dirty: [], conflicts, canUndo: false, canRedo: false };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

const draftOps = () => draft.map((d) => d.op);
const placed = (sections) => sections.map((s) => (layout[s.id] ? { ...s, at: layout[s.id] } : s));

/* What the page shows: the head with the user's draft on it, each section
 * where it sits. Recomputed after every change, and announced. */
function refresh() {
  state = {
    sections: placed(applyOps(committed, draftOps())),
    settings,
    loaded: state.loaded,
    head,
    pending: draft.length > 0,
    dirty: [...new Set(draft.map((d) => d.op.sec))],
    conflicts,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
  emit();
}

function persist() {
  run("kv", "readwrite", (s) => {
    s.put({ sections: committed, settings, head, layout }, "notebook");
    return s.put(draft, "draft");
  });
}

const changed = () => {
  refresh();
  persist();
};

/* A version: `ops` applied to the head, recorded, and the head moved on. The
 * sections and entries it touched remember it, and who. With an agent's
 * version, the user's draft is carried across onto it (`rebase`). */
function commit(ops, by, meta = {}) {
  if (!ops.length) return null;
  const v = head + 1;
  const at = Date.now();
  const touched = new Map(); // sec -> [entry ids]
  for (const op of ops) {
    if (op.kind === "remove") continue;
    const ids = touched.get(op.sec) || [];
    if (op.kind === "entry") ids.push(op.id);
    touched.set(op.sec, ids);
  }
  committed = applyOps(committed, ops).map((s) => {
    if (!touched.has(s.id)) return s;
    const ev = { ...(s.ev || {}) };
    for (const id of touched.get(s.id)) ev[id] = v;
    return { ...s, v, ev, edited: { by, at } };
  });
  const record = { v, by, at, chat: meta.chat || null, label: meta.label || null, revertOf: meta.revertOf ?? null, ops };
  log.push(record);
  head = v;
  run("versions", "readwrite", (s) => s.put(record));
  trim();
  if (by !== "user") rebase(record);
  changed();
  return record;
}

/* Old versions go once there are more than KEEP_VERSIONS and they're older
 * than KEEP_DAYS. An agent whose last look is older than the log reaches
 * just reads the whole notebook again. */
function trim() {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const extra = log.length - KEEP_VERSIONS;
  if (extra <= 0) return;
  const gone = log.slice(0, extra).filter((r) => r.at < cutoff);
  if (!gone.length) return;
  log = log.slice(gone.length);
  run("versions", "readwrite", (s) => {
    for (const r of gone) s.delete(r.v);
  });
}

/* An agent saved while the user had a draft: the draft stays on top (it's
 * their page), and anything both changed is marked so they can choose. */
function rebase(record) {
  if (!draft.length) return;
  const mine = new Set(draft.map((d) => targetOf(d.op)));
  for (const op of record.ops) {
    const target = targetOf(op);
    if (mine.has(target) && !conflicts.some((c) => c.target === target)) conflicts = [...conflicts, { target, sec: op.sec, id: op.id || null, by: record.by }];
  }
}

/* -- the user's side: draft, save, undo ----------------------------------------- */

let step = 0;
let timer = null;
let held = false;

/* The user's edit: on the page at once, in the draft until saved. */
function userOps(ops) {
  if (!ops.length) return;
  step += 1;
  for (const op of ops) draft.push({ op, step });
  undoStack = [...undoStack, { step, ops, saved: null }].slice(-UNDO_STEPS);
  redoStack = [];
  changed();
  later();
}

/* Saved a little after the user's hand leaves the notebook -- not while it's
 * there (`hold`), and not at all if they'd rather save themselves. */
function later() {
  clearTimeout(timer);
  timer = null;
  const delay = settings.saveDelay;
  if (reader || held || delay == null || !draft.length) return;
  timer = setTimeout(() => notebook.save(), delay);
}

/* Operations that would overwrite something changed since they were made are
 * left out; the rest run. */
function fresh(ops) {
  let sections = committed;
  const ok = [];
  const skipped = [];
  for (const op of ops) {
    if (stale(sections, op)) {
      skipped.push(op);
      continue;
    }
    ok.push(op);
    sections = applyOps(sections, [op]);
  }
  return { ok, skipped };
}

const sectionOf = (id) => state.sections.find((s) => s.id === id);

export const notebook = {
  get: () => state,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /* -- what agents read ---------------------------------------------------------- */

  /** The sections at the head -- saved, without the user's draft. */
  head: () => ({ sections: committed, head }),
  /** The versions after `v`, oldest first; null if the log no longer reaches
   *  back that far. */
  since(v) {
    if (v >= head) return [];
    const first = log[0]?.v;
    if (first == null || first > v + 1) return null;
    return log.filter((r) => r.v > v);
  },
  /** One version, or null. */
  version: (v) => log.find((r) => r.v === v) || null,
  /** Every version still kept, newest first. */
  history: () => [...log].reverse(),
  /** The notebook as it was at version `v` (sections), or null if the log no
   *  longer reaches back that far. Built backwards from the head. */
  asOf(v) {
    if (v >= head) return committed;
    const later = notebook.since(v);
    if (!later) return null;
    return later.reduceRight((sections, r) => applyOps(sections, invertAll(r.ops)), committed);
  },

  /** An agent's change, saved at once as one version. `ops` from
   *  lib/versions.js; `chat` where the agent was answering. */
  agentCommit: (ops, agentId, chat = null) => commit(ops, agentId, { chat }),
  /** An agent's single edit (checked by `apply`), saved as one version. */
  edit(id, agentId, change, chat = null) {
    const section = committed.find((s) => s.id === id);
    const data = apply(section, change);
    return commit(diffData(id, section.type, section.data, data), agentId, { chat });
  },

  /** Where an agent last caught up, in one conversation (lib/notebookSync.js). */
  cursor: (agentId, chatId) => cursors.get(`${agentId}|${chatId}`) || null,
  setCursor(agentId, chatId, cursor) {
    const key = `${agentId}|${chatId}`;
    if (cursor) cursors.set(key, cursor);
    else cursors.delete(key);
    run("cursors", "readwrite", (s) => (cursor ? s.put(cursor, key) : s.delete(key)));
  },
  /** An agent's cursors go with it (or with a chat). */
  forgetCursors(match) {
    for (const key of [...cursors.keys()]) if (match(key)) notebook.setCursor(...key.split("|"), null);
  },

  /* -- the user's hand ------------------------------------------------------------ */

  /** A new section, at `index` (the end if left out), holding `data` if
   *  given, sitting at `at` on the page if given. */
  add(type, title, index = state.sections.length, data = null, at = null) {
    const content = data || TYPES[type].empty();
    const named = type === "text" ? textTitle(content.text) : title || TYPES[type].label;
    const section = {
      id: newId("sec"),
      title: named,
      type,
      data: type === "facts" ? { rows: withRowIds(content.rows) } : content,
      createdAt: Date.now(),
    };
    if (at) layout = { ...layout, [section.id]: at };
    userOps([{ kind: "create", sec: section.id, index, after: section }]);
    return sectionOf(section.id);
  },
  /** The user's hand: the section's data as it now stands. */
  write(id, data) {
    const section = sectionOf(id);
    if (!section) return;
    const next = section.type === "facts" ? { ...data, rows: withRowIds(data.rows, section.data.rows) } : data;
    userOps(diffData(id, section.type, section.data, next));
  },
  rename(id, title) {
    const section = sectionOf(id);
    if (section && section.title !== title) userOps([{ kind: "rename", sec: id, before: section.title, after: title }]);
  },
  /** A section out of the notebook. Returns how to put it back. A live one
   *  isn't memory: it just goes, and comes back where it was. */
  remove(id) {
    const index = state.sections.findIndex((s) => s.id === id);
    const gone = state.sections[index];
    if (!gone || isFixed(gone)) return () => {};
    // A sidebar not made yet (connectSidebar) is left unmade.
    const sidebar = settings.sidebar;
    const slot = sidebar ? sidebar.indexOf(id) : -1;
    if (sidebar) settings = { ...settings, sidebar: sidebar.filter((x) => x !== id) };
    if (gone.type === "live") {
      committed = committed.filter((s) => s.id !== id);
      changed();
    } else {
      userOps([{ kind: "remove", sec: id, index, before: bare(gone) }]);
    }
    // Put back where it was -- in the sidebar too, if it was there.
    return () => {
      const now = settings.sidebar;
      if (now && slot !== -1) settings = { ...settings, sidebar: [...now.slice(0, slot), id, ...now.slice(slot)] };
      if (gone.type === "live") {
        const { at: _, ...section } = gone;
        committed = [...committed.slice(0, index), section, ...committed.slice(index)];
        changed();
      } else {
        userOps([{ kind: "create", sec: id, index, after: bare(gone) }]);
      }
    };
  },

  /** The draft saved as one version (`label` names it). Returns the version,
   *  or null if there was nothing to save. */
  save(label = null) {
    clearTimeout(timer);
    timer = null;
    if (!draft.length) return null;
    const view = applyOps(committed, draftOps());
    const steps = new Set(draft.map((d) => d.step));
    draft = [];
    conflicts = [];
    const record = commit(diffSections(committed, view), "user", { label });
    const v = record ? record.v : head;
    undoStack = undoStack.map((u) => (u.saved == null && steps.has(u.step) ? { ...u, saved: v } : u));
    changed();
    return record;
  },
  /** While the user's hand is in the notebook nothing is saved for them;
   *  once it leaves, their draft is saved after `settings.saveDelay`. */
  hold(on) {
    held = Boolean(on);
    if (held) {
      clearTimeout(timer);
      timer = null;
    } else later();
  },
  /** A clash with an agent's change, settled: keep the user's (their draft
   *  wins when saved), or take the agent's (the draft lets go of it). */
  settle(target, keep) {
    if (keep === "theirs") draft = draft.filter((d) => targetOf(d.op) !== target);
    conflicts = conflicts.filter((c) => c.target !== target);
    changed();
  },

  /** The user's last step undone. An unsaved one just leaves the draft; a
   *  saved one is reversed by a new version -- except what's been changed
   *  since, which is left alone and returned as `skipped`. */
  undo() {
    const last = undoStack[undoStack.length - 1];
    if (!last) return null;
    undoStack = undoStack.slice(0, -1);
    if (last.saved == null) {
      draft = draft.filter((d) => d.step !== last.step);
      redoStack = [...redoStack, last];
      changed();
      return { skipped: [] };
    }
    notebook.save();
    const { ok, skipped } = fresh(invertAll(last.ops));
    const record = commit(ok, "user", { revertOf: last.saved });
    redoStack = [...redoStack, { ...last, undone: ok, undoneIn: record?.v ?? null }];
    changed();
    return { skipped, version: record };
  },
  /** The last undone step done again. */
  redo() {
    const last = redoStack[redoStack.length - 1];
    if (!last) return null;
    redoStack = redoStack.slice(0, -1);
    if (last.saved == null) {
      for (const op of last.ops) draft.push({ op, step: last.step });
      undoStack = [...undoStack, last];
      changed();
      later();
      return { skipped: [] };
    }
    notebook.save();
    const { ok, skipped } = fresh(invertAll(last.undone || []));
    const record = commit(ok, "user", { revertOf: last.undoneIn });
    undoStack = [...undoStack, { step: last.step, ops: ok, saved: record?.v ?? head }];
    changed();
    return { skipped, version: record };
  },
  /** Any version -- the user's or an agent's -- reversed by a new one, with
   *  whatever has changed since left alone (`skipped`). It can be undone. */
  revert(v) {
    const record = notebook.version(v);
    if (!record) return null;
    notebook.save();
    const { ok, skipped } = fresh(invertAll(record.ops));
    const done = commit(ok, "user", { revertOf: v });
    if (done) {
      step += 1;
      undoStack = [...undoStack, { step, ops: ok, saved: done.v }].slice(-UNDO_STEPS);
      redoStack = [];
      changed();
    }
    return { skipped, version: done };
  },
  /** One section set back to how it was at version `v`, as a new version. */
  restore(id, v) {
    const then = notebook.asOf(v)?.find((s) => s.id === id);
    const now = committed.find((s) => s.id === id);
    notebook.save();
    const ops = then && now ? diffSections([now], [then]) : then ? [{ kind: "create", sec: id, index: committed.length, after: bare(then) }] : now ? [{ kind: "remove", sec: id, index: committed.indexOf(now), before: bare(now) }] : [];
    const done = commit(ops, "user", { label: `Restored from v${v}` });
    if (done) {
      step += 1;
      undoStack = [...undoStack, { step, ops, saved: done.v }].slice(-UNDO_STEPS);
      redoStack = [];
      changed();
    }
    return done;
  },

  /* -- the page and the sidebar: not memory, never versioned ---------------------- */

  /** Where a section sits on the page. */
  place(id, at) {
    layout = { ...layout, [id]: at };
    changed();
  },
  /** Several placed at once ({ [id]: { x, y } }). */
  placeMany(where) {
    layout = { ...layout, ...where };
    changed();
  },
  /** A section into the sidebar at `at` (the end if left out); one already
   *  there moves. */
  addToSidebar(id, at = Infinity) {
    const rest = (settings.sidebar || []).filter((x) => x !== id);
    const i = Math.max(0, Math.min(at, rest.length));
    settings = { ...settings, sidebar: [...rest.slice(0, i), id, ...rest.slice(i)] };
    changed();
  },
  /** Out of the sidebar (it stays in the notebook) -- not a fixed one. */
  removeFromSidebar(id) {
    if (isFixed(committed.find((s) => s.id === id))) return;
    settings = { ...settings, sidebar: (settings.sidebar || []).filter((x) => x !== id) };
    changed();
  },
  showInSidebar: (id, shown) => (shown ? notebook.addToSidebar(id) : notebook.removeFromSidebar(id)),
  /** The sidebar in a new order (dragged there). */
  setSidebar(ids) {
    settings = { ...settings, sidebar: ids };
    changed();
  },
  /** Once: the sidebar is made from what it showed before -- each widget's
   *  section, in the order it had (`order`: the old widget ids), then any
   *  section that had been put in it. */
  connectSidebar(order = []) {
    if (settings.sidebar) return;
    const rank = (s) => {
      const i = order.indexOf(s.source === "setup" ? "settings" : s.source);
      return i === -1 ? order.length : i;
    };
    const live = committed.filter((s) => s.type === "live").sort((a, b) => rank(a) - rank(b));
    const mine = committed.filter((s) => s.type !== "live" && (s.widget || order.includes(`nb:${s.id}`)));
    settings = { ...settings, sidebar: [...live, ...mine].map((s) => s.id) };
    changed();
  },
  setApprove(approve) {
    settings = { ...settings, approve };
    changed();
  },
  setSaveDelay(saveDelay) {
    settings = { ...settings, saveDelay };
    changed();
    later();
  },
  /** A live section put back (or in), at `index`. */
  addLive(source, index = 0) {
    const section = liveSection(source);
    committed = [...committed.slice(0, index), section, ...committed.slice(index)];
    changed();
    return sectionOf(section.id);
  },
};

function liveSection(source) {
  return { id: newId("live"), title: LIVE[source].title, type: "live", source, data: {}, v: 0, ev: {}, edited: null, createdAt: Date.now() };
}

/* What was kept, brought up to now: rows get ids, places move to `layout`,
 * the old per-agent `seen` and per-section `version` go. */
function upgrade(sections) {
  return sections.map((s) => {
    const { at, seen: _s, version: _v, widget: _w, ...rest } = s;
    if (at && !layout[s.id]) layout = { ...layout, [s.id]: at };
    return {
      ...rest,
      v: rest.v ?? 0,
      ev: rest.ev || {},
      data: rest.type === "facts" ? { ...rest.data, rows: withRowIds(rest.data.rows || []) } : rest.data,
    };
  });
}

/** Resolves once what was kept is in. */
export const ready = Promise.all([
  run("kv", "readonly", (s) => s.get("notebook")),
  run("kv", "readonly", (s) => s.get("draft")),
  run("versions", "readonly", (s) => s.getAll()),
  run("cursors", "readonly", (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      cursors.set(c.key, c.value);
      c.continue();
    };
    return null;
  }),
]).then(([saved, savedDraft, versions]) => {
  if (saved?.sections) {
    layout = saved.layout || {};
    // The widget flag on a section meant "in the sidebar" before the sidebar
    // was its own list; connectSidebar reads it once.
    const widgets = saved.sections.filter((s) => s.widget).map((s) => s.id);
    committed = upgrade(saved.sections).map((s) => (widgets.includes(s.id) ? { ...s, widget: true } : s));
    settings = { ...settings, ...saved.settings };
    head = saved.head ?? 1;
  }
  if (Array.isArray(versions)) log = versions.sort((a, b) => a.v - b.v);
  if (Array.isArray(savedDraft) && savedDraft.length) {
    draft = savedDraft;
    step = Math.max(...draft.map((d) => d.step));
    // Unsaved when the app last closed: one step to undo, saved soon.
    undoStack = [{ step, ops: draftOps(), saved: null }];
  }
  state = { ...state, loaded: true };
  // The widgets, at the top of the page, the first time each is known.
  const added = settings.liveAdded || [];
  const fresh = Object.keys(LIVE).filter((source) => !added.includes(source));
  if (fresh.length) {
    const made = fresh.map(liveSection);
    committed = [...made, ...committed];
    settings = { ...settings, liveAdded: [...added, ...fresh], sidebar: settings.sidebar ? [...settings.sidebar, ...made.map((s) => s.id)] : settings.sidebar };
    changed();
  } else refresh();
  later();
});

/** Whether a section is in the sidebar. */
export const inSidebar = (id) => (settings.sidebar || []).includes(id);

/** The notebook, kept current in a component. */
export const useNotebook = () => useSyncExternalStore(notebook.subscribe, notebook.get);
