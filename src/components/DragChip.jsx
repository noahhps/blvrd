import { notebook } from "../lib/notebook.js";
import { useWidgetDrop } from "../lib/widgetDrop.js";
import { LIVE_WIDGETS } from "./widgets/index.jsx";
import { NotebookWidget } from "./widgets/NotebookWidget.jsx";

/* The widget being carried between the Notebook page and the sidebar
 * (lib/widgetDrop.js), drawn as it is in the sidebar and held under the
 * pointer once the drag has left where it started -- the page and the
 * sidebar each clip what's dragged past their edge. It's wherever the
 * pointer is: no easing, it's the hand. Held over the page from the sidebar,
 * it says it will be taken out. */
export function DragChip({ ctx }) {
  const { chip, removing } = useWidgetDrop();
  if (!chip) return null;
  const section = notebook.get().sections.find((s) => s.id === chip.id);
  const Widget = section ? (section.type === "live" ? LIVE_WIDGETS[section.source] : NotebookWidget) : null;
  if (!Widget) return null;
  return (
    <div className="drag-widget" style={{ transform: `translate(${chip.x - 24}px, ${chip.y - 16}px)` }} data-removing={removing ? "" : undefined} aria-hidden="true" inert="">
      <div className="drag-widget-body">
        <Widget ctx={ctx} handle={{}} section={section} />
        {removing ? <span className="drag-widget-note">Remove from sidebar</span> : null}
      </div>
    </div>
  );
}
