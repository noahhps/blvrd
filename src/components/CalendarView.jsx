import { useEffect, useMemo, useState } from "react";

import { byDay, fromDayKey, monthOf, shiftMonth } from "../lib/calendar.js";
import { useMonthEvents, useToday } from "../lib/useMonthEvents.js";
import { Icon } from "./Icon.jsx";
import { MonthGrid } from "./MonthGrid.jsx";

const timeOf = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/* The calendar screen, opened from the sidebar's widget: a month of every
 * connected calendar, red by how full each day is, and the picked day's
 * events beneath. `focus` is the view that opened it: { day } when a day in
 * the widget was clicked, so the screen opens on that day -- and moves to
 * another clicked while it is already open. */
export function CalendarView({ connectors, patchConnectors, onConnect, focus = null }) {
  const today = useToday();
  const start = focus?.day || today;
  const [month, setMonth] = useState(() => monthOf(fromDayKey(start)));
  const [picked, setPicked] = useState(start);
  const { events, problems, loading, sources } = useMonthEvents(connectors, patchConnectors, month);
  const days = useMemo(() => byDay(events), [events]);

  const name = new Date(month.year, month.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const go = (by) => {
    const next = shiftMonth(month, by);
    setMonth(next);
    // Keep a pick in view: the 1st of the new month, or today if it's there.
    const now = monthOf(fromDayKey(today));
    setPicked(now.year === next.year && now.month === next.month ? today : `${next.year}-${String(next.month + 1).padStart(2, "0")}-01`);
  };
  const toToday = () => {
    setMonth(monthOf(fromDayKey(today)));
    setPicked(today);
  };
  const pick = (key) => {
    setPicked(key);
    const d = monthOf(fromDayKey(key));
    if (d.year !== month.year || d.month !== month.month) setMonth(d);
  };
  // A day clicked in the widget while this screen is already open.
  useEffect(() => {
    if (focus?.day) pick(focus.day);
    // Each click is a new view object, so the same day clicked again still lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const dayEvents = days[picked] || [];
  const pickedName = fromDayKey(picked).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="settings calendar-page">
      <header className="calendar-head">
        <h1>{name}</h1>
        <span className="spacer" />
        <button type="button" className="btn icon-only" aria-label="Previous month" title="Previous month" onClick={() => go(-1)}>
          <Icon name="chevron-left" />
        </button>
        <button type="button" className="btn" onClick={toToday}>
          Today
        </button>
        <button type="button" className="btn icon-only" aria-label="Next month" title="Next month" onClick={() => go(1)}>
          <Icon name="chevron" />
        </button>
      </header>

      {!sources.length ? (
        <div className="calendar-empty">
          <p className="hint">No calendar connected yet. Connect Google Calendar or Apple Calendar to see your days fill in.</p>
          <button type="button" className="btn" onClick={onConnect}>
            <Icon name="plug" />
            Connectors
          </button>
        </div>
      ) : null}
      {problems.map((p) => (
        <p key={p} className="hint warn">
          {p}
        </p>
      ))}

      <MonthGrid month={month} days={days} today={today} selected={picked} onPick={pick} size="large" />

      <section className="calendar-day" aria-live="polite">
        <h2 className="calendar-day-name">{picked === today ? `Today · ${pickedName}` : pickedName}</h2>
        {loading ? (
          <p className="hint">Loading…</p>
        ) : dayEvents.length === 0 ? (
          <p className="hint">Nothing on this day.</p>
        ) : (
          <ul className="calendar-events">
            {dayEvents.map((e) => (
              <li key={e.id} className="calendar-event">
                <span className="calendar-event-time">{e.allDay ? "All day" : `${timeOf(e.start)} – ${timeOf(e.end)}`}</span>
                <span className="calendar-event-text">
                  <span className="calendar-event-title">{e.title}</span>
                  <span className="calendar-event-where">{[e.calendar, e.location].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
