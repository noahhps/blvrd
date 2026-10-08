import { useState } from "react";

import { notebook } from "../../lib/notebook.js";
import { Icon } from "../Icon.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

/* A Notebook section the user put in the sidebar (lib/notebook.js): facts as
 * label and value, a list's open items (tickable here), a note's first lines.
 * Its head opens the section in the Notebook. */

const SHOWN = 5;

export function NotebookWidget({ ctx, handle, section }) {
  const open = (
    <button
      type="button"
      className="btn icon-only"
      title={`Open “${section.title}” in the Notebook`}
      aria-label={`Open ${section.title} in the Notebook`}
      onClick={() => ctx.setView({ kind: "notebook", section: section.id })}
    >
      <Icon name="open" size={15} />
    </button>
  );
  return (
    <>
      <WidgetHead label={section.title} handle={handle} action={open} />
      <div className="widget widget-notebook">
        <Body section={section} />
      </div>
    </>
  );
}

function Body({ section }) {
  if (section.type === "facts") {
    const rows = section.data.rows;
    if (!rows.length) return <p className="side-empty">Nothing yet — agents fill this in as they learn.</p>;
    return (
      <dl className="nbw-facts">
        {rows.slice(0, SHOWN).map((r, i) => (
          <div key={`${r.key}:${i}`} className="nbw-fact">
            <dt>{r.key}</dt>
            <dd title={r.value}>{r.value}</dd>
          </div>
        ))}
        {rows.length > SHOWN ? <p className="nbw-more">{rows.length - SHOWN} more</p> : null}
      </dl>
    );
  }
  if (section.type === "list") return <ListBody section={section} />;
  const text = section.data.text.trim();
  return text ? <p className="nbw-note">{text}</p> : <p className="side-empty">Nothing yet — agents fill this in as they learn.</p>;
}

/* What's still to do. Something ticked here stays, struck through, until the
   widget is next shown -- it doesn't vanish from under the pointer. */
function ListBody({ section }) {
  const items = section.data.items;
  const [doneBefore] = useState(() => new Set(items.filter((i) => i.done).map((i) => i.id)));
  const shown = items.filter((i) => !doneBefore.has(i.id));
  const open = shown.filter((i) => !i.done);
  const done = items.length - open.length;
  if (!items.length) return <p className="side-empty">Nothing yet — agents fill this in as they learn.</p>;
  const toggle = (item) => notebook.write(section.id, { items: items.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)) });
  return (
    <ul className="nbw-items">
      {shown.slice(0, SHOWN).map((item) => (
        <li key={item.id} className="nbw-item" data-done={item.done ? "" : undefined}>
        <label className="nb-check">
          <input type="checkbox" checked={item.done} onChange={() => toggle(item)} aria-label={`Done: ${item.text}`} />
            <span>
              <Icon name="check" size={12} />
            </span>
          </label>
          <span className="nbw-item-text" title={item.text}>
            {item.text}
            </span>
          </li>
        ))}
      {shown.length > SHOWN || done ? (
        <p className="nbw-more">{[shown.length > SHOWN ? `${shown.length - SHOWN} more` : "", done ? `${done} done` : ""].filter(Boolean).join(" · ")}</p>
      ) : null}
      {!shown.length ? <p className="side-empty">All done.</p> : null}
    </ul>
  );
}
