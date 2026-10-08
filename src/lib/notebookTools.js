import { ACTIONS, LIVE, TYPES, asText, changedBy, find, liveRows, notebook, ready } from "./notebook.js";
import { rowsText } from "./liveRows.js";

/* The Notebook (lib/notebook.js) as an agent's tools: what's in it, one
 * section read, one section kept up to date. An agent can't make or remove a
 * section -- the user decides what the notebook holds. Each tool's `ctx`
 * carries `agentId` and `nameOf` (App.jsx). */

// What kind a section is, as an agent is told.
const kindOf = (s) => (s.type === "live" ? "kept current by the app; read-only" : TYPES[s.type].label.toLowerCase());
const sectionsLine = (sections) => sections.map((s) => `- ${s.title} (${kindOf(s)})`).join("\n");

// Said when a section was changed by someone else since this agent last read
// it -- the only way an agent learns the notebook isn't only its own.
const noteChange = (section, ctx) => {
  const who = changedBy(section, ctx.agentId, ctx.nameOf);
  return who ? `Since you last read “${section.title}”, ${who} changed it.\n\n` : "";
};

const sectionNamed = (name) => {
  const section = find(notebook.get().sections, name);
  if (!section) {
    const titles = notebook.get().sections.map((s) => `“${s.title}”`).join(", ");
    throw new Error(`there is no section “${name}”${titles ? ` -- the sections are ${titles}` : " -- the notebook has no sections yet"}`);
  }
  return section;
};

export const NOTEBOOK_TOOLS = [
  {
    name: "notebook_contents",
    always: true,
    label: "Notebook: contents",
    description: "The sections of your notebook about the user, by title and kind. The user decides which sections it has.",
    parameters: { type: "object", properties: {}, required: [] },
    run: async () => {
      await ready;
      const { sections } = notebook.get();
      return sections.length ? sectionsLine(sections) : "Your notebook has no sections yet. The user adds them.";
    },
  },
  {
    name: "notebook_read",
    always: true,
    label: "Notebook: read",
    description: "Read one section of your notebook about the user, by its title. Read the relevant section before answering anything about the user's life, plans or preferences.",
    parameters: { type: "object", properties: { section: { type: "string", description: "The section's title" } }, required: ["section"] },
    run: async ({ section: name }, ctx) => {
      await ready;
      const section = sectionNamed(name);
      // A live section is read as it stands right now.
      if (section.type === "live") return `${section.title} (${kindOf(section)}, as of now):\n${rowsText(await liveRows(section.source), LIVE[section.source].empty || "(nothing)")}`;
      const heads = noteChange(section, ctx);
      notebook.markSeen(section.id, ctx.agentId);
      return `${heads}${section.title} (${kindOf(section)}):\n${asText(section)}`;
    },
  },
  {
    name: "notebook_edit",
    always: true,
    label: "Notebook: edit",
    description:
      "Keep one section of your notebook about the user up to date when you learn something that belongs in it. Facts sections: action set (key, value) or remove (key). List sections: action add, check, uncheck or remove (item). Note sections: action append or replace (text). You can't add or remove sections.",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", description: "The section's title" },
        action: { type: "string", enum: [...new Set(Object.values(ACTIONS).flat())] },
        key: { type: "string", description: "Facts: the label, e.g. Birthday" },
        value: { type: "string", description: "Facts: the value, e.g. 14 March" },
        item: { type: "string", description: "Lists: the item's text" },
        text: { type: "string", description: "Notes: the text to add, or the whole new text" },
      },
      required: ["section", "action"],
    },
    // Asks the user first only when they've said so (the Notebook's switch);
    // read at the moment of the call, so flipping it applies at once.
    get confirm() {
      return notebook.get().settings.approve;
    },
    summary: (a) => {
      const what = a.key ? `${a.key}: ${a.value ?? ""}` : a.item || (a.text ? `“${String(a.text).slice(0, 80)}${String(a.text).length > 80 ? "…" : ""}”` : "");
      return `${a.action} in “${a.section}” — ${what}`.trim();
    },
    run: async ({ section: name, ...change }, ctx) => {
      await ready;
      const section = sectionNamed(name);
      const heads = noteChange(section, ctx);
      notebook.edit(section.id, ctx.agentId, change);
      const now = find(notebook.get().sections, section.id);
      return `${heads}Done. “${now.title}” now reads:\n${asText(now)}`;
    },
  },
];

/** The line in an agent's instructions that says the notebook is there. */
export function notebookBrief() {
  const { sections } = notebook.get();
  if (!sections.length) return "";
  return `You keep a notebook about the user, with these sections:\n${sectionsLine(sections)}\nRead the section that bears on a question before answering it, and keep sections up to date as you learn things that belong in them (notebook_read, notebook_edit). Sections kept current by the app (the user's calendar, what's playing, and so on) can be read but not changed.`;
}
