import { useEffect, useRef, useState } from "react";

import { calendarSources, dayKey, monthEvents } from "./calendar.js";
import { onCalendarChange } from "./calendarBus.js";
import { allMonths, pruneMonths, putMonth } from "./calendarDb.js";

/* A month's events from every connected calendar, for the sidebar's widget
 * and the calendar screen alike. Kept in memory per month, so both -- and
 * flipping back to a month just seen -- share one fetch, and in the calendar's
 * local database (lib/calendarDb.js), so opening the app shows the month at
 * once instead of asking the calendars again.
 *
 * A kept month is asked for again once it is older than FRESH_MS: checked
 * every minute while the month is on screen and when the window comes back
 * into focus, in the background, with the kept month showing meanwhile. */

const FRESH_MS = 5 * 60 * 1000;
const CHECK_MS = 60 * 1000;
// Months kept on disk: the most recently fetched, for the calendars connected.
const KEEP = 12;
const cache = new Map(); // key -> { at, data } | { at?, data?, promise }

// What the database holds, read once; nothing is fetched before it is in.
const ready = allMonths().then((rows) => {
  for (const { key, at, data } of rows) if (!cache.has(key) && data?.events) cache.set(key, { at, data });
});

// Something was added: every kept month is out of date. Its events keep
// showing while the months on screen are asked for again (each hook hears
// this too, below).
onCalendarChange(() => {
  for (const [key, hit] of cache) if (hit.data) cache.set(key, { ...hit, at: 0 });
});

const keyOf = (sources, { year, month }) => `${sources.join(",")}|${year}-${month}`;
const sourcesOfKey = (key) => key.slice(0, key.lastIndexOf("|"));

async function fetchMonth(key, connectors, patchConnectors, month, force) {
  await ready;
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit?.data && !force && Date.now() - hit.at < FRESH_MS) return hit.data;
  const promise = monthEvents(connectors, patchConnectors, month).then((data) => {
    // A fetch where a calendar failed keeps the last good month rather than
    // replacing it with a partial one -- in the cache and in what's shown,
    // with its problems said -- and isn't written down. (Handing back the
    // partial month blanked the sidebar's widget, which checks every minute,
    // whenever one check failed.)
    if (data.problems.length && hit?.data) {
      cache.set(key, { at: hit.at, data: hit.data });
      return { ...hit.data, problems: data.problems };
    }
    const at = Date.now();
    cache.set(key, { at, data });
    if (!data.problems.length) {
      const sources = sourcesOfKey(key);
      putMonth({ key, sources, at, data }).then(() => pruneMonths(sources, KEEP));
    }
    return data;
  });
  cache.set(key, { ...hit, promise });
  promise.catch(() => (hit?.data ? cache.set(key, { at: hit.at, data: hit.data }) : cache.delete(key)));
  return promise;
}

/** Every event from now to `days` ahead, through the same months the widget
 *  keeps (so an agent reading the calendar asks the calendars no more than
 *  the widget would). Empty when no calendar is connected. */
export async function eventsAhead(connectors, patchConnectors, days = 7) {
  const sources = calendarSources(connectors);
  if (!sources.length) return [];
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const months = [{ year: now.getFullYear(), month: now.getMonth() }];
  if (end.getMonth() !== now.getMonth()) months.push({ year: end.getFullYear(), month: end.getMonth() });
  const lists = await Promise.all(months.map((m) => fetchMonth(keyOf(sources, m), connectors, patchConnectors, m, false).then((d) => d.events).catch(() => [])));
  const seen = new Set();
  return lists.flat().filter((e) => !seen.has(e.id) && seen.add(e.id));
}

/** { events, problems, loading, sources } for `month` ({ year, month }). */
export function useMonthEvents(connectors, patchConnectors, month) {
  const sources = calendarSources(connectors);
  const key = keyOf(sources, month);
  const latest = useRef({ connectors, patchConnectors });
  latest.current = { connectors, patchConnectors };
  const [result, setResult] = useState(() => ({ key, ...(cache.get(key)?.data || { events: [], problems: [] }) }));

  useEffect(() => {
    if (!sources.length) {
      // Nothing connected: nothing of a calendar's is kept either.
      ready.then(() => pruneMonths("", 0));
      setResult({ key, events: [], problems: [] });
      return undefined;
    }
    let live = true;
    const load = (force) =>
      fetchMonth(key, latest.current.connectors, latest.current.patchConnectors, month, force)
        .then((data) => live && setResult({ key, ...data }))
        // A check that fails outright leaves what's shown as it was.
        .catch((err) => live && setResult((prev) => ({ key, events: prev.key === key ? prev.events : cache.get(key)?.data?.events || [], problems: [String(err?.message || err)] })));
    // The kept month first, while a stale one is asked for again.
    ready.then(() => {
      const kept = cache.get(key)?.data;
      if (live && kept) setResult({ key, ...kept });
    });
    load(false);
    const onFocus = () => load(false);
    const timer = setInterval(() => load(false), CHECK_MS);
    window.addEventListener("focus", onFocus);
    const offChange = onCalendarChange(() => load(true));
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      offChange();
    };
    // `key` names the sources and the month; the rest is read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = result.key === key;
  return {
    events: current ? result.events : cache.get(key)?.data?.events || [],
    problems: current ? result.problems : [],
    loading: sources.length > 0 && !cache.get(key)?.data && !(current && result.problems.length),
    sources,
  };
}

/** Today's key, kept current past midnight and on coming back to the window. */
export function useToday() {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const check = () => setToday(dayKey(new Date()));
    const timer = setInterval(check, 60 * 1000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  return today;
}
