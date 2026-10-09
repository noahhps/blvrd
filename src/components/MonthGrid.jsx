import { WEEKDAYS, WEEKDAY_NAMES, heatOf, monthGrid } from "../lib/calendar.js";

/* A month, Monday first, each day washed in the brand's red by how many events
 * it holds (lib/calendar.js heatOf): the more, the stronger. Small in the
 * sidebar's widget, large on the calendar screen; with `onPick`, each day is
 * a button. */
export function MonthGrid({ month, days, today, selected = null, onPick = null, size = "small" }) {
  const weeks = monthGrid(month);
  return (
    <div className="month" data-size={size} role="grid" aria-readonly="true" aria-hidden={onPick ? undefined : "true"}>
      <div className="month-row month-weekdays" role="row">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="month-weekday" role="columnheader" aria-label={WEEKDAY_NAMES[i]} title={WEEKDAY_NAMES[i]}>
            {d}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div className="month-row" role="row" key={week[0].key}>
          {week.map((cell) => {
            const events = days[cell.key] || [];
            const heat = heatOf(events.length);
            const Cell = onPick ? "button" : "span";
            return (
              <Cell
                key={cell.key}
                type={onPick ? "button" : undefined}
                role="gridcell"
                className="month-day"
                data-out={cell.inMonth ? undefined : ""}
                data-today={cell.key === today ? "" : undefined}
                data-selected={cell.key === selected ? "" : undefined}
                data-strong={heat >= 0.45 ? "" : undefined}
                style={heat ? { "--heat": `${Math.round(heat * 100)}%` } : undefined}
                aria-label={`${cell.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${events.length ? `, ${events.length} event${events.length === 1 ? "" : "s"}` : ""}`}
                aria-selected={onPick ? cell.key === selected : undefined}
                onClick={onPick ? () => onPick(cell.key) : undefined}
              >
                <span className="month-num">{cell.day}</span>
                {size === "large" && events.length ? <span className="month-count">{events.length}</span> : null}
              </Cell>
            );
          })}
        </div>
      ))}
    </div>
  );
}
