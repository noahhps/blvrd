import { daysOf, dayKey } from "./calendar.js";

/* What each live section of the Notebook holds (lib/notebook.js LIVE): the
 * sidebar's widgets as rows of label and value -- the Notebook page shows the
 * rows, an agent reads them as text, so the two can't disagree. Plain
 * functions of what the app already knows. */

const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const day = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The next `days` days of events, from `now`, soonest first. */
export function calendarRows(events, now = new Date(), days = 7) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const today = dayKey(now);
  const rows = [];
  for (const e of [...events].sort((a, b) => (a.start < b.start ? -1 : 1))) {
    const at = new Date(e.start);
    const through = new Date(e.end || e.start);
    if (through <= now && !e.allDay) continue;
    if (at >= end) continue;
    const keys = daysOf(e);
    if (!keys.some((k) => k >= today)) continue;
    const when = at < start ? `${day(start)}, ongoing` : `${day(at)}, ${e.allDay ? "all day" : `${time(e.start)}–${time(e.end || e.start)}`}`;
    rows.push({ key: when, value: [e.title, e.location].filter(Boolean).join(" · ") });
  }
  return rows;
}

/** What's playing (lib/music.js), or nothing. */
export function musicRows(now) {
  if (!now) return [];
  const app = now.app === "spotify" ? "Spotify" : "Apple Music";
  const rows = [
    { key: now.state === "playing" ? "Playing" : "Paused", value: [now.title, now.artist].filter(Boolean).join(" — ") },
  ];
  if (now.album) rows.push({ key: "Album", value: now.album });
  if (now.duration > 0 && now.position >= 0) rows.push({ key: "Where", value: `${clock(now.position)} of ${clock(now.duration)}` });
  rows.push({ key: "In", value: app });
  return rows;
}

/** The agents, each with what it does. */
export function agentsRows(agents, taglineOf) {
  return agents.map((a) => ({ key: a.name, value: taglineOf(a) }));
}

/** The group chats, each with who's in it. */
export function groupsRows(groups, nameOf) {
  return groups.map((g) => ({ key: g.name, value: g.members.map(nameOf).join(", ") || "No one yet" }));
}

/** How the app is set up: the default model, what's connected, search. */
export function setupRows({ defaultModel, providers = [], connectors = {}, search = null }) {
  const rows = [];
  const provider = providers.find((p) => p.id === defaultModel?.provider);
  rows.push({ key: "Default model", value: defaultModel?.model ? `${defaultModel.model}${provider ? ` on ${provider.name}` : ""}` : "None chosen yet" });
  const connected = [];
  const g = connectors.google;
  if (g?.tokens?.access_token) connected.push(`Google${g.email ? ` (${g.email})` : ""}: ${(g.services || []).join(", ") || "signed in"}`);
  if (connectors.apple?.enabled) connected.push(`Apple ${[connectors.apple.calendar !== false && "Calendar", connectors.apple.reminders !== false && "Reminders"].filter(Boolean).join(" & ")}`);
  if (connectors.homeassistant?.enabled && connectors.homeassistant.url) connected.push("Home Assistant");
  const servers = (connectors.mcp || []).filter((s) => s.enabled !== false);
  if (servers.length) connected.push(`${servers.length} MCP server${servers.length === 1 ? "" : "s"} (${servers.map((s) => s.name).join(", ")})`);
  rows.push({ key: "Connected", value: connected.join("; ") || "Nothing yet" });
  if (search?.provider) rows.push({ key: "Web search", value: search.provider === "free" ? "The free tier" : search.provider });
  return rows;
}

/** Rows as an agent reads them. */
export const rowsText = (rows, empty) => (rows.length ? rows.map((r) => `- ${r.key}: ${r.value}`).join("\n") : empty);
