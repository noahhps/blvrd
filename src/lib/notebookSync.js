import { ACTIONS, TYPES, apply, asText, find, notebook } from "./notebook.js";
import { diffData, netChanges } from "./versions.js";

/* How an agent keeps up with the Notebook (docs/notebook-sync.md).
 *
 * Each agent, in each conversation, has a cursor: the version it last saw,
 * and the tool call whose result told it (`anchor`). Every notebook tool call
 * starts by catching the agent up -- only what changed since its cursor, net,
 * leaving out its own changes -- then moves its cursor to the head. A cursor
 * is only good while the agent can still see that result: once the chat has
 * been folded up past it (lib/compact.js), or the log no longer reaches back
 * to it, the agent reads the whole notebook again.
 *
 * An agent's edits are checked against its cursor: one that would overwrite
 * a row, item or note someone else changed after the agent last looked is
 * refused, with the value as it now stands, so the agent can decide again.
 *
 *   ctx  { agentId, chatId, nameOf, callId, messages } -- from the tool call
 *        (App.jsx notebookOf, lib/run.js) */

export const CATCH_UP_BUDGET = 6000; // characters, about 1,500 tokens
export const FULL_READ_BUDGET = 8000;

/* -- the cursor ------------------------------------------------------------------ */

/** Whether the tool result `anchor` names is still among `messages`. */
const visible = (anchor, messages) => Boolean(anchor) && (messages || []).some((m) => m.role === "tool" && m.callId === anchor);

/** The agent's cursor in this conversation, if it still holds: what it was
 *  told is still in front of it, and the log still reaches back to it. */
export function cursorFor(agentId, chatId, messages) {
  const cursor = notebook.cursor(agentId, chatId);
  if (!cursor || !visible(cursor.anchor, messages)) return null;
  return notebook.since(cursor.v) ? cursor : null;
}

/* -- telling an agent what changed --------------------------------------------- */

const quote = (s) => `“${String(s ?? "").trim()}”`;
const short = (s, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const whoFor = (agentId, nameOf) => (by) => (by === "user" ? "the user" : by === agentId ? "you" : `${nameOf(by)} (another assistant)`);

/** What kind a section is, as an agent is told. */
export const kindOf = (s) => (s.type === "live" ? "kept current by the app; read-only" : TYPES[s.type].label.toLowerCase());

/** A section's size, said briefly. */
function sizeOf(s) {
  if (s.type === "facts") return `${s.data.rows.length} row${s.data.rows.length === 1 ? "" : "s"}`;
  if (s.type === "list") {
    const done = s.data.items.filter((i) => i.done).length;
    return `${s.data.items.length - done} to do, ${done} done`;
  }
  if (s.type === "live") return null;
  const words = String(s.data.text ?? "").trim().split(/\s+/).filter(Boolean).length;
  return `${words} word${words === 1 ? "" : "s"}`;
}

/* The lines that were added and taken out between two texts. */
function lineChanges(before, after) {
  const a = String(before ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const b = String(after ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const added = b.filter((l) => !a.includes(l));
  const removed = a.filter((l) => !b.includes(l));
  return { added, removed, whole: added.length + removed.length > Math.max(a.length, b.length) / 2 };
}

/* One net change as a line, or null if there's nothing worth saying. `who`
 * names the editors at the end of it; without it, they're left out. */
function lineFor(c, sections, who = null) {
  const now = sections.find((s) => s.id === c.sec);
  const title = now?.title || c.before?.title || (c.before && typeof c.before === "object" && c.before.title) || "a section";
  const by = who ? `(${c.by.map(who).join(", ")}, v${c.v})` : "";
  if (c.kind === "create") {
    if (!now) return null;
    return `- New section ${quote(now.title)} (${kindOf(now)}) ${by}:\n${asText(now).split("\n").map((l) => `  ${l}`).join("\n")}`;
  }
  if (c.kind === "remove") return c.after ? `- Section ${quote(title)} was put back ${by}` : `- Section ${quote(c.before.title)} was removed ${by}`;
  if (c.kind === "rename") return `- Section ${quote(c.before)} is now called ${quote(c.after)} ${by}`;
  if (c.kind === "order") return `- ${title}: put in a new order ${by}`;
  if (c.kind === "text") {
    const { added, removed, whole } = lineChanges(c.before, c.after);
    if (!String(c.after).trim()) return `- ${title}: emptied ${by}`;
    if (whole) return `- ${title} now reads ${by}:\n${String(c.after).split("\n").map((l) => `  ${l}`).join("\n")}`;
    const parts = [...added.map((l) => `added ${quote(short(l))}`), ...removed.map((l) => `removed ${quote(short(l))}`)];
    return `- ${title}: ${parts.join("; ")} ${by}`;
  }
  // A row or an item.
  const { before: b, after: a } = c;
  if ("key" in (a || b)) {
    if (!b) return `- ${title} › ${a.key}: ${quote(a.value)} (new) ${by}`;
    if (!a) return `- ${title} › ${b.key} removed (was ${quote(b.value)}) ${by}`;
    if (b.key !== a.key) return `- ${title} › ${quote(b.key)} is now ${quote(a.key)}: ${quote(a.value)} ${by}`;
    return `- ${title} › ${a.key}: ${quote(b.value)} → ${quote(a.value)} ${by}`;
  }
  if (!b) return `- ${title}: added ${quote(a.text)}${a.done ? " (done)" : ""} ${by}`;
  if (!a) return `- ${title}: removed ${quote(b.text)} ${by}`;
  if (b.text !== a.text) return `- ${title}: ${quote(b.text)} → ${quote(a.text)}${a.done !== b.done ? (a.done ? ", done" : ", not done") : ""} ${by}`;
  return `- ${title}: ${a.done ? "ticked off" : "unticked"} ${quote(a.text)} ${by}`;
}

/**
 * What changed between version `from` and the head, for `agentId`: lines,
 * net, its own changes left out -- or null if the log doesn't reach back.
 * When someone undid one of its own changes, it's told that too.
 */
export function changesSince(from, agentId, nameOf) {
  const versions = notebook.since(from);
  if (!versions) return null;
  const { sections } = notebook.head();
  const who = whoFor(agentId, nameOf);
  const entries = versions.flatMap((r) => (r.by === agentId ? [] : r.ops.map((op) => ({ op, by: r.by, v: r.v }))));
  const lines = netChanges(entries)
    .map((c) => lineFor(c, sections, who))
    .filter(Boolean);
  for (const r of versions) {
    const undone = r.revertOf != null && r.by !== agentId ? notebook.version(r.revertOf) : null;
    if (undone?.by === agentId) lines.push(`- ${who(r.by)[0].toUpperCase()}${who(r.by).slice(1)} undid your change from v${undone.v} (v${r.v}).`);
  }
  return lines;
}

/* The changes, or -- when there are too many to send -- which sections
 * changed and how often, to read the ones that matter. */
function fitted(lines, budget) {
  const text = lines.join("\n");
  if (text.length <= budget) return text;
  const counts = new Map();
  for (const line of lines) {
    const name = line.replace(/^- (New section |Section )?/, "").split(/ › |: | \(|”/)[0].replace(/^“/, "");
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return `${[...counts].map(([name, n]) => `- ${name}: ${n} change${n === 1 ? "" : "s"}`).join("\n")}\n(Too much changed to list it all: notebook_read the sections that matter.)`;
}

/** What one version did, line by line, for the History panel. */
export function versionLines(record) {
  const sections = notebook.asOf(record.v) || notebook.head().sections;
  return netChanges(record.ops.map((op) => ({ op, by: record.by, v: record.v })))
    .map((c) => lineFor(c, sections))
    .filter(Boolean)
    .map((line) => line.replace(/^- /, "").replace(/ +(:|$)/, "$1").split("\n")[0].replace(/:$/, ""));
}

/** The whole notebook, for an agent meeting it for the first time in a
 *  conversation: what's in it, then each section in full while they fit. */
export function fullRead(budget = FULL_READ_BUDGET) {
  const { sections, head } = notebook.head();
  if (!sections.length) return `Notebook v${head}: no sections yet. The user adds them.`;
  const list = sections.map((s) => `- ${s.title} (${[kindOf(s), sizeOf(s)].filter(Boolean).join(", ")})`).join("\n");
  const parts = [`Notebook v${head}. Its sections:\n${list}`];
  let used = parts[0].length;
  const left = [];
  for (const s of sections.filter((x) => x.type !== "live")) {
    const body = `${s.title}:\n${asText(s)}`;
    if (used + body.length > budget) {
      left.push(s.title);
      continue;
    }
    parts.push(body);
    used += body.length;
  }
  if (left.length) parts.push(`(Not shown here, to keep this short: ${left.map(quote).join(", ")}. notebook_read them when they matter.)`);
  return parts.join("\n\n");
}

/** The catch-up an agent gets at the start of every notebook call: changes
 *  since its cursor, or the whole notebook when it has none that holds. */
export function catchUp(ctx) {
  const cursor = cursorFor(ctx.agentId, ctx.chatId, ctx.messages);
  const { head } = notebook.head();
  if (!cursor) return { text: fullRead(), full: true, from: null };
  if (cursor.v >= head) return { text: `Notebook v${head} — nothing has changed since you last looked.`, full: false, from: cursor.v };
  const lines = changesSince(cursor.v, ctx.agentId, ctx.nameOf);
  if (!lines.length) return { text: `Notebook v${head} — nothing has changed since you last looked, apart from your own edits.`, full: false, from: cursor.v };
  return { text: `Notebook v${head} — you last saw v${cursor.v}. Since then:\n${fitted(lines, CATCH_UP_BUDGET)}`, full: false, from: cursor.v };
}

/** The agent is up to date as of the head, by this tool call's result. */
export const caughtUp = (ctx) => notebook.setCursor(ctx.agentId, ctx.chatId, { v: notebook.head().head, anchor: ctx.callId || null });

/**
 * A line for the end of the user's message, when the agent is behind: how
 * far, and where -- so it knows to catch up without the system prompt (and
 * the model's cache of it) changing every turn. "" when it's up to date.
 */
export function behindNote(agentId, chatId, history, nameOf) {
  const { sections, head } = notebook.head();
  if (!sections.some((s) => s.type !== "live")) return "";
  const cursor = cursorFor(agentId, chatId, history);
  if (!cursor) return `(Notebook: v${head}. You haven't read it in this conversation — notebook_sync to see what's in it when it bears on what the user asks.)`;
  if (cursor.v >= head) return "";
  const versions = notebook.since(cursor.v).filter((r) => r.by !== agentId);
  if (!versions.length) return "";
  const changed = [...new Set(versions.flatMap((r) => r.ops.map((op) => sections.find((s) => s.id === op.sec)?.title || op.before?.title).filter(Boolean)))];
  const n = changesSince(cursor.v, agentId, nameOf).length;
  if (!n) return "";
  return `(Notebook: v${head}, you last saw v${cursor.v} — ${n} change${n === 1 ? "" : "s"}${changed.length ? `, in ${changed.join(", ")}` : ""}. notebook_sync to catch up.)`;
}

/* -- an agent's edits ------------------------------------------------------------ */

/* Who changed something at version `v`, as the agent should hear it. */
function byAt(v, agentId, nameOf) {
  const r = notebook.version(v);
  return r ? whoFor(agentId, nameOf)(r.by) : "someone";
}

/* The entry an edit means, in a section as it stands. */
function entryFor(section, change) {
  if (section.type === "facts") return section.data.rows.find((r) => String(r.key).trim().toLowerCase() === String(change.key ?? "").trim().toLowerCase()) || null;
  if (section.type === "list") return section.data.items.find((i) => String(i.text).trim().toLowerCase() === String(change.item ?? "").trim().toLowerCase()) || null;
  return null;
}

/* Why this edit can't go ahead on what the agent last saw -- or null. */
function clash(section, change, base, ctx) {
  const show = (e) => (section.type === "facts" ? quote(e.value) : `${quote(e.text)}${e.done ? " (done)" : ""}`);
  if (section.type === "facts" || section.type === "list") {
    if (change.action === "add") return null; // a duplicate is refused by `apply`
    const entry = entryFor(section, change);
    const v = entry ? section.ev?.[entry.id] || 0 : 0;
    if (!entry || v <= base) return null;
    const what = section.type === "facts" ? `${section.title} › ${entry.key}` : `${quote(entry.text)} in ${section.title}`;
    return `${what} — ${byAt(v, ctx.agentId, ctx.nameOf)} changed it to ${show(entry)} at v${v}, after you last looked. If your change is still right, make it again.`;
  }
  // Notes: an append never clashes, and revise checks its own words; a whole
  // replacement would lose what someone else wrote since.
  if (change.action === "replace" && (section.v || 0) > base) {
    return `${section.title} — ${byAt(section.v, ctx.agentId, ctx.nameOf)} changed it at v${section.v}, after you last looked. Read it, then use revise or append, or replace it again if your text is still right.`;
  }
  return null;
}

/* An edit, said back. */
function described(section, change) {
  if (section.type === "facts") return change.action === "remove" ? `removed ${change.key} from ${section.title}` : `${section.title} › ${change.key}: ${quote(change.value)}`;
  if (section.type === "list") {
    const verb = { add: "added", check: "ticked off", uncheck: "unticked", remove: "removed" }[change.action];
    return `${verb} ${quote(change.item)} ${change.action === "add" ? "to" : "in"} ${section.title}`;
  }
  return { append: `added to ${section.title}`, replace: `rewrote ${section.title}`, revise: `revised ${section.title}` }[change.action] || `changed ${section.title}`;
}

/**
 * The agent's edits, each checked against its cursor (`base`, the version it
 * last saw; 0 if none) and applied together as one version. Each edit names
 * its section. Returns { record, saved: [line], refused: [line], sections }
 * -- `sections`, the ones that changed, as they now stand.
 */
export function editAs(ctx, changes, base) {
  const { sections } = notebook.head();
  const working = new Map(); // sec -> data
  const saved = [];
  const refused = [];
  for (const change of changes) {
    const name = String(change.section ?? "").trim();
    const section = find(sections, name);
    if (!section) {
      const titles = sections.map((s) => quote(s.title)).join(", ");
      refused.push(`${quote(name || "(no section)")} — there is no such section${titles ? `; the sections are ${titles}` : ""}`);
      continue;
    }
    const problem = section.type === "live" ? null : clash(section, change, base, ctx);
    if (problem) {
      refused.push(problem);
      continue;
    }
    try {
      const data = apply({ ...section, data: working.get(section.id) ?? section.data }, change);
      working.set(section.id, data);
      saved.push(described(section, change));
    } catch (error) {
      refused.push(`${section.title} — ${error.message}`);
    }
  }
  const ops = [...working].flatMap(([id, data]) => {
    const s = sections.find((x) => x.id === id);
    return diffData(id, s.type, s.data, data);
  });
  const record = notebook.agentCommit(ops, ctx.agentId, ctx.chatId || null);
  const now = notebook.head().sections;
  return { record, saved, refused, sections: [...working.keys()].map((id) => now.find((s) => s.id === id)).filter(Boolean) };
}

/** The edits a `notebook_edit` call carries: its `changes`, or the one it
 *  spells out flat, each with a section. */
export function changesOf(args) {
  const flat = ["action", "key", "value", "item", "text", "old", "new"].some((k) => args[k] !== undefined) ? [{ ...args }] : [];
  const listed = Array.isArray(args.changes) ? args.changes.filter((c) => c && typeof c === "object") : [];
  return [...flat, ...listed].map(({ changes: _, ...c }) => ({ ...c, section: c.section ?? args.section }));
}

export const ALL_ACTIONS = [...new Set(Object.values(ACTIONS).flat())];
