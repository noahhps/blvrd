import { LIVE, asText, find, liveRows, notebook, ready } from "./notebook.js";
import { ALL_ACTIONS, catchUp, caughtUp, changesOf, cursorFor, editAs, kindOf } from "./notebookSync.js";
import { rowsText } from "./liveRows.js";

/* The Notebook (lib/notebook.js) as an agent's tools. Every one of them is a
 * sync (lib/notebookSync.js): it starts by catching the agent up -- only what
 * changed since it last looked, or the whole notebook the first time in a
 * conversation -- and leaves it up to date with the head. An agent can't make
 * or remove a section: the user decides what the notebook holds. Each tool's
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
      "Keep your notebook about the user up to date when you learn something that belongs in it. Facts sections: action set (key, value) or remove (key). List sections: action add, check, uncheck or remove (item). Note sections: append (text), revise (old: the exact words to change, new: what they become), or replace (text: the whole new text). For several edits at once, pass changes: a list of edits, each with its own section. An edit to something someone else changed since you last looked isn't saved -- you're told what it now says. You can't add or remove sections.",
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
];

/** The lines in an agent's instructions that say the notebook is there --
 *  only what changes when sections do, so the prompt stays the same from turn
 *  to turn (and a model server can reuse its cache of it). */
export function notebookBrief() {
  const { sections } = notebook.head();
  if (!sections.length) return "";
  return `You keep a notebook about the user, shared with the user (and any other assistants they have), with these sections:\n${sectionsLine(sections)}\nRead what bears on a question before answering it, and keep sections up to date as you learn things that belong in them (notebook_sync, notebook_read, notebook_edit). Every notebook call first tells you what changed since you last looked. Sections kept current by the app (the user's calendar, what's playing, and so on) can be read but not changed. The notebook may be out of date: before acting on something that matters (sending, paying, booking), check it with the user or the source.`;
}
