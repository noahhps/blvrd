/* Apple Calendar and Reminders, on this Mac.
 *
 * Every call goes to a fixed script inside the app (src-tauri/scripts) with
 * its arguments as a JSON string -- so whatever an agent passes is data, never
 * code. Whatever accounts Calendar and Reminders are signed in to (iCloud,
 * Google, Exchange) come with them. macOS asks once before blvrd may use each. */

import { calendarChanged } from "../calendarBus.js";
import { invoke } from "../desktop.js";

const obj = (properties, required = []) => ({ type: "object", properties, required });

export async function apple(action, args = {}) {
  const out = await invoke("apple_script", { action, args: JSON.stringify(args) }, "Apple Calendar and Reminders");
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

export function appleTools(config) {
  const tools = [];
  if (config.calendar !== false) {
    tools.push(
      {
        name: "apple_calendar_events",
        label: "Calendar: events",
        description: "Events in the user's Apple Calendar (every account it is signed in to) between two times, ISO 8601. Optionally one calendar, or a text search. Recurring events show their first occurrence only.",
        parameters: obj({ from: { type: "string" }, to: { type: "string" }, calendar: { type: "string" }, query: { type: "string" } }, ["from", "to"]),
        run: async (a) => {
          const events = await apple("calendar_events", a);
          if (!events.length) return "No events.";
          return events
            .map((e) => `- ${e.allDay ? new Date(e.start).toDateString() + " (all day)" : `${when(e.start)} → ${when(e.end)}`} | ${e.title} | ${e.calendar}${e.location ? ` | ${e.location}` : ""}`)
            .join("\n");
        },
      },
      {
        name: "apple_calendar_list",
        label: "Calendar: calendars",
        description: "The user's calendars in Apple Calendar, and which can be added to.",
        parameters: obj({}),
        run: async () => (await apple("calendar_list")).map((c) => `- ${c.name}${c.writable ? "" : " (read-only)"}`).join("\n"),
      },
      {
        name: "apple_calendar_add",
        label: "Calendar: add event",
        confirm: true,
        description: "Add an event to Apple Calendar. Times ISO 8601 with time zone. Without a calendar name, the first one that can be written to.",
        parameters: obj({ title: { type: "string" }, start: { type: "string" }, end: { type: "string" }, calendar: { type: "string" }, location: { type: "string" }, notes: { type: "string" }, allDay: { type: "boolean" } }, ["title", "start", "end"]),
        summary: (a) => `Add “${a.title}” to ${a.calendar || "Calendar"}, ${when(a.start)}`,
        run: async (a) => {
          const r = await apple("calendar_add", a);
          calendarChanged();
          return `Added “${r.added}” to ${r.calendar}.`;
        },
      },
    );
  }
  if (config.reminders !== false) {
    tools.push(
      {
        name: "apple_reminders",
        label: "Reminders: list",
        description: "The user's open reminders in Apple Reminders, optionally from one list.",
        parameters: obj({ list: { type: "string" }, includeCompleted: { type: "boolean" } }),
        run: async (a) => {
          const items = await apple("reminders_list", a);
          if (!items.length) return "No reminders.";
          return items.map((r) => `- ${r.completed ? "[done] " : ""}${r.title} | ${r.list}${r.due ? ` | due ${when(r.due)}` : ""} | id ${r.id}`).join("\n");
        },
      },
      {
        name: "apple_reminders_add",
        label: "Reminders: add",
        confirm: true,
        description: "Add a reminder to Apple Reminders, optionally with a due time (ISO 8601) and a list.",
        parameters: obj({ title: { type: "string" }, due: { type: "string" }, list: { type: "string" }, notes: { type: "string" } }, ["title"]),
        summary: (a) => `Add the reminder “${a.title}”${a.due ? `, due ${when(a.due)}` : ""}`,
        run: async (a) => {
          const r = await apple("reminders_add", a);
          return `Added “${r.added}” to ${r.list}.`;
        },
      },
      {
        name: "apple_reminders_complete",
        label: "Reminders: mark done",
        confirm: true,
        description: "Mark a reminder done, by its id from apple_reminders.",
        parameters: obj({ id: { type: "string" } }, ["id"]),
        summary: () => "Mark a reminder as done",
        run: async ({ id }) => `Marked “${(await apple("reminders_complete", { id })).completed}” as done.`,
      },
    );
  }
  return tools;
}
