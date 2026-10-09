import { LIVE, TYPES, asText, find, liveRows, notebook, ready } from "./notebook.js";
import { ALL_ACTIONS, catchUp, caughtUp, changesOf, cursorFor, editAs, kindOf } from "./notebookSync.js";
import { rowsText } from "./liveRows.js";

/* The Notebook (lib/notebook.js) as an agent's tools. Every one of them is a
 * sync (lib/notebookSync.js): it starts by catching the agent up -- only what
 * changed since it last looked, or the whole notebook the first time in a
 * conversation -- and leaves it up to date with the head. An agent can start
 * a section of its own when something worth keeping has no home
 * (notebook_add_section) -- a few a conversation, never one like a section
 * already there -- but can't remove one: that's the user's to do. Each tool's
 * `ctx` carries `agentId`, `chatId`, `nameOf` (App.jsx), and the call's id and
 * the messages the model can see (lib/run.js). */

const sectionsLine = (sections) => sections.map((s) => `- ${s.title} (${kindOf(s)})`).join("\n");

const sectionNamed = (name) => {
  const { sections } = notebook.head();
  const section = find(sections, name);
  if (!section) {
    const titles = sections.map((s) => `“${s.title}”`).join(", ");
    throw new Error(`there is no section “${name}”${titles ? ` -- the sections are ${titles}` : " -- the notebook has no sections yet"}`);
  }
  return section;
};

// How many sections an agent may start in one conversation.
export const MAX_STARTED = 3;
const TITLE_MAX = 60;
const LITTLE = new Set(["a", "an", "the", "my", "your", "to", "of", "for", "and", "in", "on", "with", "list", "notes", "note", "things", "stuff", "ideas"]);
// A title's words that say what it's about: "Books to read" -> book, read.
const wordsOf = (title) =>
  String(title)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !LITTLE.has(w))
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
/* A section already there that the new title would duplicate: the same
   title, or one whose words take in the other's ("Books" and "Books to
   read"). */
function likeOne(sections, title) {
  const exact = find(sections, title);
  if (exact) return exact;
  const mine = wordsOf(title);
  if (!mine.length) return null;
  return (
    sections.find((s) => {
      const theirs = wordsOf(s.title);
      if (!theirs.length) return false;
      const inMine = theirs.every((w) => mine.includes(w));
      const inTheirs = mine.every((w) => theirs.includes(w));
      return inMine || inTheirs;
    }) || null
  );
}

/* What an agent asked a new section to start with, as the section's data. */
function startingData(type, args) {
  if (type === "facts") {
    const raw = Array.isArray(args.rows) ? args.rows : [];
    const rows = raw
      .map((r) => (typeof r === "string" ? { key: r.split(":")[0], value: r.split(":").slice(1).join(":") } : { key: r?.key, value: r?.value }))
      .map((r) => ({ key: String(r.key ?? "").trim(), value: String(r.value ?? "").trim() }))
      .filter((r) => r.key && r.value);
    const keys = new Set();
    return { rows: rows.filter((r) => !keys.has(r.key.toLowerCase()) && keys.add(r.key.toLowerCase())) };
  }
  if (type === "list") {
    const raw = Array.isArray(args.items) ? args.items : [];
    const texts = raw.map((i) => String(typeof i === "string" ? i : (i?.text ?? i?.item ?? "")).trim()).filter(Boolean);
    return { items: [...new Set(texts)].map((text) => ({ text, done: false })) };
  }
  return { text: String(args.text ?? "").trim() };
}
const isEmpty = (type, data) => (type === "facts" ? !data.rows.length : type === "list" ? !data.items.length : !data.text);

// How many sections this agent has started in this conversation.
const startedHere = (agentId, chatId) =>
  notebook.history().filter((r) => r.by === agentId && (r.chat || null) === (chatId || null) && r.ops.some((op) => op.kind === "create")).length;

export const NOTEBOOK_TOOLS = [
  {
    name: "notebook_sync",
    always: true,
    label: "Notebook: catch up",
    description:
      "Catch up on your notebook about the user: what changed since you last looked (the first time in a conversation, the whole notebook). Call it before answering anything about the user's life, plans or preferences when you're told the notebook has changed.",
    parameters: { type: "object", properties: {}, required: [] },
    run: async (_, ctx) => {
      await ready;
      const { text } = catchUp(ctx);
      caughtUp(ctx);
      return text;
    },
  },
  {
    name: "notebook_read",
    always: true,
    label: "Notebook: read",
    description: "Read one section of your notebook about the user in full, by its title (and catch up on anything else that changed).",
    parameters: { type: "object", properties: { section: { type: "string", description: "The section's title" } }, required: ["section"] },
    run: async ({ section: name }, ctx) => {
      await ready;
      const section = sectionNamed(name);
      const { text, full } = catchUp(ctx);
      caughtUp(ctx);
      // A live section is read as it stands right now.
      const body =
        section.type === "live"
          ? `${section.title} (${kindOf(section)}, as of now):\n${rowsText(await liveRows(section.source), LIVE[section.source]?.empty || "(nothing)")}`
          : `${section.title} (${kindOf(section)}):\n${asText(section)}`;
      // The whole notebook was just sent, this section with it.
      return full && section.type !== "live" && text.includes(`${section.title}:\n${asText(section)}`) ? text : `${text}\n\n${body}`;
    },
  },
  {
    name: "notebook_edit",
    always: true,
    label: "Notebook: edit",
    description:
      "Keep your notebook about the user up to date when you learn something that belongs in it. Facts sections: action set (key, value) or remove (key). List sections: action add, check, uncheck or remove (item). Note sections: append (text), revise (old: the exact words to change, new: what they become), or replace (text: the whole new text). For several edits at once, pass changes: a list of edits, each with its own section. An edit to something someone else changed since you last looked isn't saved -- you're told what it now says. For something with no section to go in, start one with notebook_add_section.",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", description: "The section's title" },
        action: { type: "string", enum: ALL_ACTIONS },
        key: { type: "string", description: "Facts: the label, e.g. Birthday" },
        value: { type: "string", description: "Facts: the value, e.g. 14 March" },
        item: { type: "string", description: "Lists: the item's text" },
        text: { type: "string", description: "Notes: the text to add, or the whole new text" },
        old: { type: "string", description: "Notes, revise: the words to change, exactly as they are now" },
        new: { type: "string", description: "Notes, revise: what those words become" },
        changes: {
          type: "array",
          description: "Several edits at once, saved together: each { section, action, ... } as above",
          items: { type: "object" },
        },
      },
      required: [],
    },
    // Asks the user first only when they've said so (the Notebook's switch);
    // read at the moment of the call, so flipping it applies at once.
    get confirm() {
      return notebook.get().settings.approve;
    },
    summary: (a) => {
      const one = (c) => {
        const what = c.key ? `${c.key}: ${c.value ?? ""}` : c.item || (c.text ? `“${String(c.text).slice(0, 80)}${String(c.text).length > 80 ? "…" : ""}”` : c.old ? `“${String(c.old).slice(0, 40)}” → “${String(c.new ?? "").slice(0, 40)}”` : "");
        return `${c.action} in “${c.section ?? a.section}” — ${what}`.trim();
      };
      return changesOf(a).map(one).join("; ") || "change the notebook";
    },
    run: async (args, ctx) => {
      await ready;
      const changes = changesOf(args);
      if (!changes.length) throw new Error("say what to change: an action (and key/value, item, text or old/new), or changes: a list of them");
      // What the agent decided on is what it last saw -- checked before it's
      // brought up to date (and checked again here, at the moment the user
      // allowed it, if they were asked).
      const base = cursorFor(ctx.agentId, ctx.chatId, ctx.messages)?.v ?? 0;
      const { text } = catchUp(ctx);
      const { record, saved, refused, sections } = editAs(ctx, changes, base);
      caughtUp(ctx);
      const lines = [text, ""];
      if (record) lines.push(`Saved as v${record.v}: ${saved.join("; ")}.`);
      if (refused.length) lines.push(`Not saved:\n${refused.map((r) => `- ${r}`).join("\n")}`);
      for (const s of sections) lines.push("", `“${s.title}” now reads:\n${asText(s)}`);
      if (!record && !refused.length) lines.push("Nothing changed: the notebook already said that.");
      return lines.join("\n").trim();
    },
  },
  {
    name: "notebook_add_section",
    always: true,
    label: "Notebook: add a section",
    description: `Start a new section in your notebook about the user, for something worth keeping that has no section to go in yet -- not for one-off details, and never when a section already there would do (add to it with notebook_edit). Give it a short title and a kind: facts (labelled values: rows, each { key, value }), list (things to keep or do: items, each a short text) or note (free writing: text) -- and what it starts with. At most ${MAX_STARTED} a conversation. The user sees who started it, and can move, change or remove it.`,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: `A short title, e.g. Books to read (at most ${TITLE_MAX} characters)` },
        kind: { type: "string", enum: ["facts", "list", "note"], description: "facts, list or note" },
        rows: {
          type: "array",
          description: "Facts: what it starts with, each { key, value }",
          items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } } },
        },
        items: { type: "array", description: "List: what it starts with, each a short text", items: { type: "string" } },
        text: { type: "string", description: "Note: what it starts with" },
      },
      required: ["title", "kind"],
    },
    // Asks the user first when they've said agents' changes should wait for
    // them (the Notebook's switch), as edits do.
    get confirm() {
      return notebook.get().settings.approve;
    },
    summary: (a) => {
      const type = String(a.kind || "").toLowerCase();
      const data = TYPES[type] ? startingData(type, a) : null;
      const what = !data ? "" : type === "facts" ? `${data.rows.length} fact${data.rows.length === 1 ? "" : "s"}` : type === "list" ? `${data.items.length} item${data.items.length === 1 ? "" : "s"}` : "a note";
      return `start a section “${String(a.title ?? "").trim()}”${type ? ` (${type}${what ? `, ${what}` : ""})` : ""}`;
    },
    run: async (args, ctx) => {
      await ready;
      const title = String(args.title ?? "").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
      const type = String(args.kind ?? args.type ?? "").trim().toLowerCase();
      if (!title) throw new Error("give the section a title");
      if (title.length > TITLE_MAX) throw new Error(`that title is too long: keep it under ${TITLE_MAX} characters`);
      if (!["facts", "list", "note"].includes(type)) throw new Error("kind is facts, list or note");
      const data = startingData(type, args);
      if (isEmpty(type, data))
        throw new Error(type === "facts" ? "give it what it starts with: rows, each { key, value }" : type === "list" ? "give it what it starts with: items, each a short text" : "give it what it starts with: text");
      // Brought up to date first: the section may have been made meanwhile.
      const { text } = catchUp(ctx);
      caughtUp(ctx);
      const { sections } = notebook.head();
      const like = likeOne(sections, title);
      if (like) {
        const how = like.type === "live" ? "it's kept by the app, so it can only be read" : `add to it with notebook_edit${like.type === type ? "" : ` (it's a ${kindOf(like)} section)`}`;
        return `${text}\n\nNot started: there is already “${like.title}” -- ${how}. If what you're keeping really is something else, give it a title that says how.`.trim();
      }
      if (startedHere(ctx.agentId, ctx.chatId) >= MAX_STARTED) {
        return `${text}\n\nNot started: you've already started ${MAX_STARTED} sections in this conversation. Add to those, or ask the user whether they want another.`.trim();
      }
      const { record, section } = notebook.agentCreate(type, title, data, ctx.agentId, ctx.chatId || null);
      caughtUp(ctx);
      return `${text}\n\nStarted “${section.title}” (${kindOf(section)}), saved as v${record.v}. It now reads:\n${asText(section)}\nIt's at the end of the user's notebook; keep it up to date with notebook_edit.`.trim();
    },
  },
];

/** The lines in an agent's instructions that say the notebook is there --
 *  only what changes when sections do, so the prompt stays the same from turn
 *  to turn (and a model server can reuse its cache of it). */
export function notebookBrief() {
  const { sections } = notebook.head();
  if (!sections.length)
    return "You keep a notebook about the user, shared with the user (and any other assistants they have). It's empty so far: when you learn something worth keeping about them -- a standing preference, a plan, things they want to remember -- you may start a section for it (notebook_add_section), sparingly.";
  return `You keep a notebook about the user, shared with the user (and any other assistants they have), with these sections:\n${sectionsLine(sections)}\nRead what bears on a question before answering it, and keep sections up to date as you learn things that belong in them (notebook_sync, notebook_read, notebook_edit). When something worth keeping has no section, you may start one (notebook_add_section) -- sparingly, and never one like a section already there. Every notebook call first tells you what changed since you last looked. Sections kept current by the app (the user's calendar, what's playing, and so on) can be read but not changed. The notebook may be out of date: before acting on something that matters (sending, paying, booking), check it with the user or the source.`;
}
