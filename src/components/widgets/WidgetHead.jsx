import { createContext, useContext } from "react";

/* Where a widget is drawn: the sidebar, or its section on the Notebook page
   (components/NotebookView.jsx), which has its own heading and handle. */
export const WidgetPlace = createContext("sidebar");

/* A widget's name, which is also how it is picked up and moved; anything it
   can do (`action`) sits at the other end. On the Notebook page the section
   already has both, so only the action is kept. */
export function WidgetHead({ label, handle, action = null }) {
  const place = useContext(WidgetPlace);
  if (place === "notebook") return action ? <div className="nb-widget-action">{action}</div> : null;
  return (
    <div className="widget-head">
      <button type="button" className="widget-grip" aria-roledescription="movable widget" title="Drag to move" {...handle}>
        <span className="label">{label}</span>
      </button>
      {action}
    </div>
  );
}
