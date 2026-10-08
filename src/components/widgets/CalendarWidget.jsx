import { useMemo } from "react";

import { byDay, fromDayKey, monthOf } from "../../lib/calendar.js";
import { useMonthEvents, useToday } from "../../lib/useMonthEvents.js";
import { MonthGrid } from "../MonthGrid.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

/* This month at a glance: each day washed red by how much is on it. Each day
 * is a button to the calendar screen, opened on that day. */
export function CalendarWidget({ ctx, handle }) {
  const { connectors, patchConnectors, view, setView } = ctx;
  const today = useToday();
  const month = monthOf(fromDayKey(today));
  const { events } = useMonthEvents(connectors, patchConnectors, month);
  const days = useMemo(() => byDay(events), [events]);
  const name = new Date(month.year, month.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todays = days[today]?.length || 0;
  const showing = view.kind === "calendar" ? view.day || today : null;
  return (
    <>
      <WidgetHead label={name} handle={handle} />
      <div
        className="widget widget-calendar"
        aria-current={view.kind === "calendar" ? "true" : undefined}
        aria-label={`${name}${todays ? `, ${todays} event${todays === 1 ? "" : "s"} today` : ""}`}
      >
        <MonthGrid month={month} days={days} today={today} selected={showing} onPick={(day) => setView({ kind: "calendar", day })} />
      </div>
    </>
  );
}
