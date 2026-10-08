import { useSortable } from "../../lib/sortable.js";
import { AgentsWidget, GroupsWidget } from "./ListWidgets.jsx";
import { CalendarWidget } from "./CalendarWidget.jsx";
import { MusicWidget } from "./MusicWidget.jsx";
import { SettingsWidget } from "./SettingsWidget.jsx";

/* The sidebar is a column of widgets: each part of it -- this month, what's
 * playing, the agents, the groups, the way to settings -- is one, and they can be put in
 * any order by dragging one by its name. A widget is
 *
 *   { id, label, Component }
 *
 * Component gets { ctx, handle }: ctx is App's sidebar state and actions,
 * handle the props for what picks it up (pass both to WidgetHead). Which
 * widgets show, and in what order, is state.widgets (lib/store.js) -- ids, so
 * one added later slots in at the end without touching what's saved. */
export const WIDGETS = [
  { id: "calendar", label: "Calendar", Component: CalendarWidget },
  { id: "music", label: "Now playing", Component: MusicWidget },
  { id: "agents", label: "Agents", Component: AgentsWidget },
  { id: "groups", label: "Groups", Component: GroupsWidget },
  { id: "settings", label: "Settings", Component: SettingsWidget },
];

const byId = new Map(WIDGETS.map((w) => [w.id, w]));

// The saved order, with any widget it doesn't know of yet put in after the
// one it follows in WIDGETS (a new widget lands where it would by default).
export const orderOf = (ids = []) => {
  const out = ids.filter((id, i) => byId.has(id) && ids.indexOf(id) === i);
  WIDGETS.forEach(({ id }, i) => {
    if (out.includes(id)) return;
    const before = WIDGETS.slice(0, i).reverse().find((w) => out.includes(w.id));
    out.splice(before ? out.indexOf(before.id) + 1 : 0, 0, id);
  });
  return out;
};

export function Widgets({ ids, onOrder, ctx }) {
  const order = orderOf(ids);
  const { list, handle } = useSortable(order, onOrder);
  return (
    <div className="widgets" ref={list}>
      {order.map((id) => {
        const { label, Component } = byId.get(id);
        return (
          <section key={id} className="widget-slot" data-sort={id} aria-label={label}>
            <div className="widget-lift">
              <Component ctx={ctx} handle={handle(id)} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
