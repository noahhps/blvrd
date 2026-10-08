import { useEffect, useRef, useState } from "react";

import { calendarSources, dayKey, monthEvents } from "./calendar.js";

/* A month's events from every connected calendar, for the sidebar's widget
 * and the calendar screen alike. Kept a few minutes per month, so both -- and
 * flipping back to a month just seen -- share one fetch; looked at again when
 * the window comes back into focus. */

const FRESH_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, data } | { promise }

const keyOf = (sources, { year, month }) => `${sources.join(",")}|${year}-${month}`;

function fetchMonth(key, connectors, patchConnectors, month, force) {
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit?.data && !force && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.data);
  const promise = monthEvents(connectors, patchConnectors, month).then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
  cache.set(key, { ...hit, promise });
  promise.catch(() => cache.delete(key));
  return promise;
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
      setResult({ key, events: [], problems: [] });
      return undefined;
    }
    let live = true;
    const load = (force) =>
      fetchMonth(key, latest.current.connectors, latest.current.patchConnectors, month, force)
        .then((data) => live && setResult({ key, ...data }))
        .catch((err) => live && setResult({ key, events: [], problems: [String(err?.message || err)] }));
    load(false);
    const onFocus = () => load(false);
    const timer = setInterval(() => load(true), FRESH_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
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
