import { useMemo } from "react";

import { byDay, fromDayKey, monthOf } from "../../lib/calendar.js";
import { useMonthEvents, useToday } from "../../lib/useMonthEvents.js";
import { MonthGrid } from "../MonthGrid.jsx";

/* This month at a glance: each day washed red by how much is on it. The
 * whole month is one button, to the calendar screen. */
export function CalendarWidget({ connectors, patchConnectors, open, current }) {
  const today = useToday();
  const month = monthOf(fromDayKey(today));
  const { events } = useMonthEvents(connectors, patchConnectors, month);
  const days = useMemo(() => byDay(events), [events]);
  const name = new Date(month.year, month.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todays = days[today]?.length || 0;
  return (
    <button
      type="button"
      className="widget widget-calendar"
      aria-current={current ? "true" : undefined}
      aria-label={`${name}${todays ? `, ${todays} event${todays === 1 ? "" : "s"} today` : ""}. Open the calendar.`}
      onClick={() => open({ kind: "calendar" })}
    >
      <span className="widget-head">
        <span className="label">{name}</span>
      </span>
      <MonthGrid month={month} days={days} today={today} />
    </button>
  );
}
