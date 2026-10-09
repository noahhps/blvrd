import { useLayoutEffect, useState } from "react";

import { isFixed, notebook, useNotebook } from "../../lib/notebook.js";
import { useSortable } from "../../lib/sortable.js";
import { overMain, useWidgetDrop, widgetDrop } from "../../lib/widgetDrop.js";
import { NotebookWidget } from "./NotebookWidget.jsx";
import { AgentsWidget, GroupsWidget } from "./ListWidgets.jsx";
import { CalendarWidget } from "./CalendarWidget.jsx";
import { MusicWidget } from "./MusicWidget.jsx";
import { SettingsWidget } from "./SettingsWidget.jsx";
import { CustomWidget } from "./CustomWidget.jsx";
import { widgetIdOf } from "../../lib/widgets.js";

/* The sidebar: the widgets dragged into it from the Notebook (lib/notebook.js
 * settings.sidebar), in its own order. The Notebook is the scratchpad where
 * widgets are made; this is where the ones wanted day to day live. A
 * section the app keeps (`live`) is drawn by its widget -- the month, what's
 * playing, the agents, the groups, the way to settings; one the user made,
 * by NotebookWidget.
 *
 * Dragged within the sidebar, a widget moves; dragged off it onto the main
 * area, it leaves the sidebar (staying in the Notebook) -- except the ones
 * that are the way around the app. A section carried in from the Notebook
 * page lands where the red line shows (lib/widgetDrop.js). A widget is
 *
 *   Component({ ctx, handle, section })
 *
 * ctx is App's sidebar state and actions; handle the props for what picks it
 * up (pass both to WidgetHead). The same components draw these sections on
 * the Notebook page (WidgetPlace). */
export const LIVE_WIDGETS = {
  calendar: CalendarWidget,
  music: MusicWidget,
  agents: AgentsWidget,
  groups: GroupsWidget,
  setup: SettingsWidget,
};

/** What draws a live section: the app's widget, or the reader's own. */
export const widgetFor = (source) => LIVE_WIDGETS[source] || (widgetIdOf(source) ? CustomWidget : null);

// Before the notebook has loaded -- the first moment of a launch -- the
// widgets it starts with, so the sidebar is never empty.
const STARTING = ["calendar", "music", "agents", "groups", "setup"].map((source) => ({ id: `start:${source}`, type: "live", source, title: source }));

export function Widgets({ ctx }) {
  const { sections, settings, loaded } = useNotebook();
  const drop = useWidgetDrop();
  const byId = new Map(sections.map((s) => [s.id, s]));
  const shown = loaded && settings.sidebar ? settings.sidebar.map((id) => byId.get(id)).filter(Boolean) : STARTING;

  const { list, handle } = useSortable(
    shown.map((s) => s.id),
    notebook.setSidebar,
    {
      // Off the sidebar, over the page: it would leave the sidebar.
      onMove: (id, point) => {
        const section = byId.get(id);
        const away = overMain(point) && section && !isFixed(section);
        widgetDrop.set({ chip: away ? { id, x: point.x, y: point.y, label: section.title } : null, removing: away });
      },
      onDrop: (id, point) => {
        const section = byId.get(id);
        if (!overMain(point) || !section || isFixed(section)) return false;
        notebook.removeFromSidebar(id);
        return true;
      },
      onEnd: widgetDrop.clear,
    },
  );

  // Where a section carried in from the Notebook would land: a line in the
  // gap, moved there on a transform.
  const [line, setLine] = useState(null);
  useLayoutEffect(() => {
    const box = list.current;
    if (drop.sidebarAt == null || !box) return setLine(null);
    const slots = [...box.children].filter((el) => el.dataset.sort);
    const top = box.getBoundingClientRect().top;
    const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    const y = drop.sidebarAt < slots.length ? slots[drop.sidebarAt].getBoundingClientRect().top - top - gap / 2 : (slots.at(-1)?.getBoundingClientRect().bottom ?? top) - top + gap / 2;
    setLine(y);
  }, [drop.sidebarAt, list]);

  return (
    <div className="widgets" ref={list} data-dropping={line != null ? "" : undefined}>
      {shown.map((section) => {
        const Component = section.type === "live" ? widgetFor(section.source) : NotebookWidget;
        if (!Component) return null;
        return (
          <section
            key={section.id}
            className="widget-slot"
            data-sort={section.id}
            data-arrived={drop.arrived === section.id ? "" : undefined}
            data-leaving={drop.removing && drop.chip?.id === section.id ? "" : undefined}
            aria-label={section.title}
          >
            <div className="widget-lift">
              <Component ctx={ctx} handle={handle(section.id)} section={section} />
            </div>
          </section>
        );
      })}
      {line != null ? <span className="widgets-drop" style={{ transform: `translateY(${line}px)` }} aria-hidden="true" /> : null}
    </div>
  );
}
