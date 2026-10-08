import { CalendarWidget } from "./CalendarWidget.jsx";

/* The sidebar's widgets: small, glanceable panes at the top of the rail, each
 * a way into a screen of its own. A widget is
 *
 *   { id, label, view, Component }
 *
 * `view` is the screen it opens (App's view kind), so the widget can show
 * itself as current there. Component gets { connectors, patchConnectors,
 * open(view), current }. Which widgets show, and in what order, is
 * state.widgets (lib/store.js) -- ids, so one added later slots in without
 * touching what's saved. */
export const WIDGETS = [{ id: "calendar", label: "Calendar", view: "calendar", Component: CalendarWidget }];

const byId = new Map(WIDGETS.map((w) => [w.id, w]));

export function Widgets({ ids, view, connectors, patchConnectors, open }) {
  const shown = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="widgets">
      {shown.map(({ id, view: kind, Component }) => (
        <Component key={id} connectors={connectors} patchConnectors={patchConnectors} open={open} current={view.kind === kind} />
      ))}
    </div>
  );
}
