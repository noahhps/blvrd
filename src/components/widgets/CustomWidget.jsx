import { useCallback, useState } from "react";

import { notebook } from "../../lib/notebook.js";
import { widgetIdOf } from "../../lib/widgets.js";
import { Icon } from "../Icon.jsx";
import { RowMenu } from "../RowMenu.jsx";
import { WidgetFrame } from "../WidgetFrame.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

/* One of the reader's own widgets (lib/widgets.js) where it's placed: the
 * sidebar, or its section on the Notebook page. Its menu edits it, saves it
 * as a file to pass on, or takes it off the page -- its code stays in the
 * widget sheet's "Yours", to put back. */
export function CustomWidget({ ctx, handle, section }) {
  const id = widgetIdOf(section.source);
  const widget = ctx.customWidgets?.[id];
  const [menu, setMenu] = useState(null);
  const [problem, setProblem] = useState(null);
  const onSave = useCallback((data) => ctx.saveWidgetData(id, data), [ctx.saveWidgetData, id]);

  const more = (
    <button
      type="button"
      className="btn icon-only"
      aria-label={`${widget?.name || section.title}: more`}
      aria-haspopup="menu"
      title="More"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setMenu({ x: box.left, y: box.bottom + 4 });
      }}
    >
      <Icon name="more" size={15} />
    </button>
  );

  return (
    <>
      <WidgetHead label={widget?.name || section.title} handle={handle} action={more} />
      <div className="widget widget-custom">
        {widget ? (
          <WidgetFrame html={widget.html} data={widget.data ?? null} dark={ctx.dark} title={widget.name} onSave={onSave} onProblem={setProblem} />
        ) : (
          <p className="side-empty">This widget’s code is gone.</p>
        )}
        {problem ? <p className="widget-problem" title={problem}>It hit a snag: {problem}</p> : null}
      </div>
      {menu ? (
        <RowMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: "Edit…", disabled: !widget, run: () => ctx.openWidgetSheet({ id }) },
            { label: "Save as a file", disabled: !widget, run: () => ctx.exportWidget(id) },
            "-",
            { label: "Remove", danger: true, run: () => notebook.remove(section.id) },
          ]}
        />
      ) : null}
    </>
  );
}
