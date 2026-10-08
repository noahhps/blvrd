import { useSyncExternalStore } from "react";

import { invoke } from "./desktop.js";
import { inDesktop } from "./http.js";

/* Each agent's own memory: MEMORY.md (docs/notebook-sync.md §4).
 *
 * The Notebook is about the user, shared by everyone; this is the agent's
 * own -- how it works with the user, what it's in the middle of, what it has
 * learned that only matters to it. It is a real Markdown file in the app's
 * data folder (src-tauri/src/memory.rs), which the user reads and edits in
 * the agent's Customize sheet (components/AgentMemory.jsx) or in any editor.
 * In a plain browser (`npm run dev`) the same file lives in IndexedDB.
 *
 * The whole file goes into the agent's system prompt -- it's short, and it's
 * the agent's working memory, not an archive. The agent changes it with one
 * tool, my_memory: append under a heading, revise exact words, remove a line.
 *
 * Each save, the user's or the agent's, goes on that agent's undo stack here
 * (for the life of the window); the desktop app also keeps the last 20 saved
 * files beside it. */

export const MEMORY_LIMIT = 8000; // characters, about 2,000 tokens

export const template = (name) => `# ${name || "My"}'s memory\n\n## How I work with the user\n\n## In progress\n\n## Learned\n`;

/* -- where the file lives ---------------------------------------------------------- */

const NAME = "blvrd-agent-memory";
let opening = null;
function db() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return opening;
}
const files = (mode, fn) =>
  db().then(
    (d) =>
      d &&
      new Promise((resolve) => {
        const tx = d.transaction("files", mode);
        const out = fn(tx.objectStore("files"));
        tx.oncomplete = () => resolve(out?.result ?? true);
        tx.onerror = tx.onabort = () => resolve(null);
      }),
  );
const memoryFiles = new Map(); // with neither the desktop app nor IndexedDB (the tests)

/* The file as kept: { text: string | null, modified, path }. */
const backend = {
  async read(id) {
    if (inDesktop()) return invoke("agent_memory_read", { id }, "An agent's memory file");
    const kept = (await files("readonly", (s) => s.get(id))) ?? memoryFiles.get(id);
    return { text: kept?.text ?? null, modified: kept?.modified || 0, path: null };
  },
  async write(id, text) {
    if (inDesktop()) return invoke("agent_memory_write", { id, text }, "An agent's memory file");
    const modified = Date.now();
    memoryFiles.set(id, { text, modified });
    await files("readwrite", (s) => s.put({ text, modified }, id));
    return modified;
  },
  async remove(id) {
    if (inDesktop()) return invoke("agent_memory_remove", { id }, "An agent's memory file");
    memoryFiles.delete(id);
    await files("readwrite", (s) => s.delete(id));
  },
};

/** The file shown in Finder (desktop app only). */
export const revealMemory = (id) => invoke("agent_memory_reveal", { id }, "Showing the file");

/* -- what's known of each file ----------------------------------------------------- */

// id -> { text, modified, path, by, at, saved: bool, undo: [text], redo: [text] }
const known = new Map();
const listeners = new Set();
let version = 0;
const emit = () => {
  version += 1;
  listeners.forEach((fn) => fn());
};

const entry = (id) => known.get(id) || { text: null, name: null, modified: 0, path: null, by: null, at: 0, undo: [], redo: [] };
// What a file was before a save, for undo: before the first save, the
// template it showed.
const before = (e) => e.text ?? template(e.name);

/** An agent's memory as it now stands (the template if it has none yet).
 *  Read again from the file when it changed there since -- edited in another
 *  editor, say. */
export async function readMemory(id, name) {
  const kept = await backend.read(id).catch(() => null);
  const was = known.get(id);
  if (kept && (!was || kept.modified !== was.modified)) {
    known.set(id, { ...entry(id), name, text: kept.text, modified: kept.modified, path: kept.path });
    emit();
  } else if (was && name && was.name !== name) known.set(id, { ...was, name });
  return known.get(id)?.text ?? template(name);
}

/** The text last read, without reading again (null if never read). */
export const memoryNow = (id) => known.get(id)?.text ?? null;

/** Saved: `text`, by "user" or the agent. Goes on the undo stack. */
export async function writeMemory(id, text, by = "user") {
  const was = entry(id);
  if (was.text === text) return;
  const modified = await backend.write(id, text);
  known.set(id, { ...was, text, modified, by, at: Date.now(), undo: [...was.undo, before(was)].slice(-100), redo: [] });
  emit();
}

/** The last save undone, or redone -- as a save of its own. */
export async function undoMemory(id) {
  const was = entry(id);
  if (!was.undo.length) return;
  const text = was.undo[was.undo.length - 1];
  const modified = await backend.write(id, text);
  known.set(id, { ...was, text, modified, by: "user", at: Date.now(), undo: was.undo.slice(0, -1), redo: [...was.redo, before(was)] });
  emit();
}
export async function redoMemory(id) {
  const was = entry(id);
  if (!was.redo.length) return;
  const text = was.redo[was.redo.length - 1];
  const modified = await backend.write(id, text);
  known.set(id, { ...was, text, modified, by: "user", at: Date.now(), undo: [...was.undo, before(was)], redo: was.redo.slice(0, -1) });
  emit();
}

/** The agent was deleted: its file goes. Returns how to put it back. */
export async function removeMemory(id) {
  const text = (await backend.read(id).catch(() => null))?.text ?? null;
  await backend.remove(id).catch(() => {});
  known.delete(id);
  emit();
  return () => (text == null ? Promise.resolve() : writeMemory(id, text, "user"));
}

/** An agent's memory, kept current in a component: { text, by, at, canUndo,
 *  canRedo, path }. */
export function useMemory(id) {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  const e = entry(id);
  return { text: e.text, by: e.by, at: e.at, path: e.path, canUndo: e.undo.length > 0, canRedo: e.redo.length > 0 };
}

/* -- editing ------------------------------------------------------------------------- */

const lines = (text) => String(text ?? "").replace(/\r\n?/g, "\n").split("\n");

/** `text` with one edit made, or a throw saying what was wrong (which the
 *  agent reads). */
export function editMemory(text, { action, heading, text: line, old, new: replacement }) {
  if (action === "append") {
    const add = String(line ?? "").trim();
    if (!add) throw new Error("append needs text");
    const entryLine = /^([-*]|\d+\.|#)/.test(add) ? add : `- ${add}`;
    const all = lines(text);
    if (!heading?.trim()) return `${all.join("\n").trimEnd()}\n${entryLine}\n`;
    const want = heading.replace(/^#+\s*/, "").trim().toLowerCase();
    const at = all.findIndex((l) => /^#{2,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLowerCase() === want);
    if (at === -1) return `${all.join("\n").trimEnd()}\n\n## ${heading.replace(/^#+\s*/, "").trim()}\n${entryLine}\n`;
    // At the end of that heading's part: before the next heading, after its
    // last line of writing.
    let end = all.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l));
    if (end === -1) end = all.length;
    while (end > at + 1 && !all[end - 1].trim()) end -= 1;
    return [...all.slice(0, end), entryLine, ...all.slice(end)].join("\n");
  }
  if (action === "revise") {
    const from = String(old ?? "");
    if (!from.trim()) throw new Error("revise needs old: the words to change, exactly as they are");
    const found = String(text).split(from).length - 1;
    if (found !== 1) throw new Error(found ? `“${from}” is in your memory ${found} times: give more of the words around it` : `“${from}” isn't in your memory: check how it's written`);
    return String(text).replace(from, String(replacement ?? ""));
  }
  if (action === "remove") {
    const part = String(line ?? old ?? "").trim();
    if (!part) throw new Error("remove needs text: words from the line to take out");
    const all = lines(text);
    const hits = all.filter((l) => l.includes(part));
    if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} lines have “${part}”: give more of the line` : `no line has “${part}”`);
    return all.filter((l) => !l.includes(part)).join("\n");
  }
  throw new Error("action is append, revise, remove or read");
}

/* -- for the agent ------------------------------------------------------------------ */

/** The part of an agent's system prompt that is its own memory. */
export function memoryBrief(text) {
  const body = String(text ?? "").trim();
  if (!body) return "";
  const over = body.length > MEMORY_LIMIT ? `\n\n(Your memory is ${body.length} characters, over its ${MEMORY_LIMIT}: tidy it with my_memory -- merge, shorten, take out what no longer matters.)` : "";
  return `Your own memory (MEMORY.md) -- only you and the user see it; the user can read and edit it. Keep in it how to work with this user, what you're in the middle of, and what you've learned that matters to your work; what's about the user themselves belongs in the shared notebook. Change it with my_memory.\n\n${body}${over}`;
}

export const MEMORY_TOOLS = [
  {
    name: "my_memory",
    always: true,
    label: "My memory",
    description:
      "Change your own memory (MEMORY.md, shown to you in your instructions): append a line (text, under heading if given -- e.g. Learned, In progress), revise exact words (old, new), or remove the line with text in it. read gives the file back (only the lines with query, if given). Keep it short: one fact or habit per line.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["append", "revise", "remove", "read"] },
        text: { type: "string", description: "append: the line to add; remove: words from the line to take out" },
        heading: { type: "string", description: "append: the heading to put it under, e.g. Learned" },
        old: { type: "string", description: "revise: the words to change, exactly as they are" },
        new: { type: "string", description: "revise: what they become" },
        query: { type: "string", description: "read: only lines with these words" },
      },
      required: ["action"],
    },
    run: async (args, ctx) => {
      const current = await readMemory(ctx.agentId, ctx.agentName);
      if (args.action === "read") {
        const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return current;
        const hits = lines(current).filter((l) => words.some((w) => l.toLowerCase().includes(w)));
        return hits.length ? hits.join("\n") : "No line has those words.";
      }
      const next = editMemory(current, args);
      await writeMemory(ctx.agentId, next, ctx.agentId);
      const over = next.length > MEMORY_LIMIT ? ` It is now over its ${MEMORY_LIMIT} characters: tidy it.` : "";
      return `Saved. Your memory is ${next.length} characters.${over}`;
    },
  },
];

/** Notes kept the old way (state.notes, the remember tool) moved into the
 *  agent's MEMORY.md, under Learned -- once. */
export async function migrateNotes(id, name, notes = []) {
  if (!notes.length) return;
  let text = await readMemory(id, name);
  for (const n of notes) {
    const when = n.at ? ` (${new Date(n.at).toISOString().slice(0, 10)})` : "";
    text = editMemory(text, { action: "append", heading: "Learned", text: `${n.text}${when}` });
  }
  await writeMemory(id, text, id);
}
