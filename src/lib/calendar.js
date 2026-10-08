/* The calendar: a month laid out Monday first, the reader's events from the
 * calendars they have connected (Google, Apple), and how full each day is.
 *
 * Events are only counted and listed here; adding or changing them stays an
 * agent's job, behind the reader's Allow (lib/connectors). */

import { apple } from "./connectors/apple.js";
import { googleCalendarEvents } from "./connectors/google.js";
import { inDesktop } from "./http.js";

export const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A day's key, in local time: "2026-10-08". */
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A local date from a day's key -- not `new Date("2026-10-08")`, which is
 *  midnight in UTC and so the day before west of Greenwich. */
export function fromDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The first moment of a month and of the month after, as [from, to). */
export const monthRange = ({ year, month }) => [new Date(year, month, 1), new Date(year, month + 1, 1)];

export const shiftMonth = ({ year, month }, by) => {
  const d = new Date(year, month + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};

export const monthOf = (date = new Date()) => ({ year: date.getFullYear(), month: date.getMonth() });

/** A month as weeks of seven days, Monday first. Days from the months either
 *  side fill the first and last weeks, marked `inMonth: false`. */
export function monthGrid({ year, month }) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(year, month, 1 - lead + w * 7 + i);
      week.push({ date, key: dayKey(date), day: date.getDate(), inMonth: date.getMonth() === month });
    }
    grid.push(week);
  }
  return grid;
}

/** The days an event falls on, by key. An end exactly at midnight -- every
 *  all-day event's, and an evening's that runs to 12 -- doesn't take the
 *  next day too. */
export function daysOf(event) {
  const start = new Date(event.start);
  const end = new Date(event.end || event.start);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const keys = [dayKey(day)];
  for (;;) {
    day.setDate(day.getDate() + 1);
    if (day >= end) break;
    keys.push(dayKey(day));
    if (keys.length > 366) break;
  }
  return keys;
}

/** Events by the day they fall on: { "2026-10-08": [event, ...] }. */
export function byDay(events) {
  const out = {};
  for (const e of events) for (const key of daysOf(e)) (out[key] ||= []).push(e);
  return out;
}

/** How strongly a day is marked, 0 to 1: one event a light wash of red, five
 *  or more the full red. */
export const BUSIEST = 5;
export const heatOf = (count) => (count > 0 ? Math.min(1, 0.2 + (0.8 * (count - 1)) / (BUSIEST - 1)) : 0);

/* -- where events come from ------------------------------------------------------ */

/** The calendars the reader has connected, by name, for the widget's cache. */
export function calendarSources(connectors) {
  const sources = [];
  const g = connectors?.google;
  if (g?.tokens?.access_token && (g.services || []).includes("calendar")) sources.push(`google:${g.email || ""}`);
  if (connectors?.apple?.enabled && connectors.apple.calendar !== false && inDesktop()) sources.push("apple");
  return sources;
}

// Google's all-day events give a bare date; timed ones a dateTime.
const googleTime = (t) => (t?.dateTime ? t.dateTime : t?.date ? fromDayKey(t.date).toISOString() : null);

export function fromGoogle(e) {
  return {
    id: `google:${e.id}`,
    title: e.summary || "(no title)",
    start: googleTime(e.start),
    end: googleTime(e.end),
    allDay: Boolean(e.start?.date),
    location: e.location || "",
    calendar: "Google Calendar",
    source: "google",
  };
}

export function fromApple(e, i) {
  return {
    id: `apple:${e.calendar}:${e.start}:${i}`,
    title: e.title || "(no title)",
    start: e.start,
    end: e.end,
    allDay: Boolean(e.allDay),
    location: e.location || "",
    calendar: e.calendar,
    source: "apple",
  };
}

/** Every connected calendar's events in a month, oldest first. A calendar
 *  that fails is left out and named in `problems`, so one signed-out account
 *  doesn't blank the others. */
export async function monthEvents(connectors, patchConnectors, month) {
  const [from, to] = monthRange(month);
  const events = [];
  const problems = [];
  const jobs = [];
  const g = connectors?.google;
  if (g?.tokens?.access_token && (g.services || []).includes("calendar")) {
    const save = (tokens) => patchConnectors((c) => ({ google: { ...c.google, tokens } }));
    jobs.push(
      googleCalendarEvents(g, save, from, to)
        .then((items) => events.push(...items.filter((e) => e.status !== "cancelled").map(fromGoogle)))
        .catch((err) => problems.push(`Google Calendar: ${err.message || err}`)),
    );
  }
  if (connectors?.apple?.enabled && connectors.apple.calendar !== false && inDesktop()) {
    jobs.push(
      apple("calendar_events", { from: from.toISOString(), to: to.toISOString() })
        .then((items) => events.push(...(Array.isArray(items) ? items : []).map(fromApple)))
        .catch((err) => problems.push(`Apple Calendar: ${err.message || err}`)),
    );
  }
  await Promise.all(jobs);
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { events, problems };
}
