/* What agents can do with the reader's widgets (lib/widgets.js): make one --
 * or change one of theirs -- and read one's code. Making asks the reader
 * first, like any tool that changes something; the widget runs sealed off
 * either way.
 *
 * `ops` is the app's:
 *   list()                          -> [{ id, name, html, data }]
 *   make({ id, name, html, by }, { sidebar }) -> id   (new ones are placed) */

import { WIDGET_API, problemWith } from "./widgets.js";

export const WIDGET_GROUP = "widgets";
const group = { group: WIDGET_GROUP, groupLabel: "Widgets", logo: null };

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function widgetTools(ops) {
  return [
    {
      name: "widget_make",
      label: "Make a widget",
      description: `Make a widget for the user: a small live HTML page they keep in their Notebook (and sidebar, unless sidebar=false) -- a tracker, a timer, a dashboard, anything. To change one of theirs, give its name as "replaces" with the whole new code. Check it works before you finish: its code runs as soon as it's placed.\n\n${WIDGET_API}`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "A short name, shown over it." },
          html: { type: "string", description: "The whole widget: HTML, with any <style> and <script>." },
          replaces: { type: "string", description: "The name of the user's widget this changes (optional)." },
          sidebar: { type: "boolean", description: "Put it in the sidebar too (default true; only for a new one)." },
        },
        required: ["name", "html"],
      },
      confirm: true,
      ...group,
      summary: (args) => (args.replaces ? `Change the widget “${args.replaces}”` : `Make a widget, “${args.name}”`),
      run: async (args, ctx) => {
        const why = problemWith(args.html);
        if (why) throw new Error(why);
        let id = null;
        if (args.replaces) {
          id = ops.list().find((w) => same(w.name, args.replaces))?.id;
          if (!id) throw new Error(`the user has no widget called “${args.replaces}” -- widget_code lists them`);
        }
        ops.make({ id, name: String(args.name).trim().slice(0, 60), html: args.html, by: ctx?.agentName || "an agent" }, { sidebar: args.sidebar !== false });
        return id ? `Changed “${args.replaces}”.` : `Made “${args.name}”: it's in the user's Notebook${args.sidebar !== false ? " and sidebar" : ""}.`;
      },
    },
    {
      name: "widget_code",
      label: "Read a widget",
      description: "The user's widgets by name -- or, given a name, that widget's code and what it has saved, to change it with widget_make.",
      parameters: { type: "object", properties: { name: { type: "string", description: "A widget's name (optional)." } } },
      ...group,
      run: async ({ name } = {}) => {
        const all = ops.list();
        if (!name) return all.length ? all.map((w) => `- ${w.name}`).join("\n") : "The user has no widgets of their own yet.";
        const w = all.find((x) => same(x.name, name));
        if (!w) throw new Error(`no widget called “${name}”. Theirs: ${all.map((x) => x.name).join(", ") || "none"}`);
        return `${w.name}\n\nSaved data: ${JSON.stringify(w.data ?? null).slice(0, 4000)}\n\nCode:\n${w.html}`;
      },
    },
  ];
}
