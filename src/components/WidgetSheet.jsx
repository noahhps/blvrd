import { useEffect, useMemo, useRef, useState } from "react";

import { BLANK, STARTERS, WIDGET_API, nameFromHtml, problemWith } from "../lib/widgets.js";
import { Icon } from "./Icon.jsx";
import { WidgetFrame } from "./WidgetFrame.jsx";

/* Making a widget (lib/widgets.js), or changing one: what to start from on
 * the left -- a blank one, a ready one, one of yours, or a file -- its name
 * and code in the middle, and on the right the widget itself, running at the
 * sidebar's width as you write.
 *
 *   editing  the id of one of `widgets` to change, else a new one
 *   onSave({ id, name, html }, { sidebar })  -- placed on the page if new */

const PREVIEW_MS = 450; // the preview waits this long after the last key

export function WidgetSheet({ widgets, editing = null, dark, onSave, onClose }) {
  const existing = editing ? widgets[editing] : null;
  const [from, setFrom] = useState(existing ? `yours:${editing}` : "blank");
  const [name, setName] = useState(existing?.name || "");
  const [html, setHtml] = useState(existing?.html || BLANK);
  const [shown, setShown] = useState(html); // what the preview runs: html, a moment behind
  const [sidebar, setSidebar] = useState(true);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const file = useRef(null);
  const code = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The preview runs what's written once the writing pauses.
  useEffect(() => {
    const t = setTimeout(() => {
      setProblem(null);
      setShown(html);
    }, PREVIEW_MS);
    return () => clearTimeout(t);
  }, [html]);

  const yours = useMemo(
    () => Object.entries(widgets).sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [widgets],
  );

  const start = (key, text, title) => {
    setFrom(key);
    setHtml(text);
    setShown(text);
    setProblem(null);
    setError("");
    if (!editing) setName(title);
  };

  const importFile = async (picked) => {
    if (!picked) return;
    const text = await picked.text().catch(() => "");
    const why = problemWith(text);
    if (why) return setError(`${picked.name}: ${why}`);
    start("file", text, nameFromHtml(text, picked.name.replace(/\.html?$/i, "")));
  };

  const save = () => {
    const why = problemWith(html);
    if (why) return setError(why);
    onSave({ id: editing, name: name.trim() || nameFromHtml(html), html }, { sidebar });
  };

  // Tab writes two spaces, as in an editor; Escape leaves the box first.
  const onCodeKey = (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = `${html.slice(0, a)}  ${html.slice(b)}`;
      setHtml(next);
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet widget-sheet" role="dialog" aria-modal="true" aria-label={editing ? "Edit widget" : "New widget"}>
        <button type="button" className="sheet-close btn icon-only" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>

        <div className="ws-grid">
          <nav className="ws-from" aria-label="Start from">
            <p className="label">Start from</p>
            <FromRow on={from === "blank"} label="Blank" hint="Your own, from scratch" onPick={() => start("blank", BLANK, "")} />
            {STARTERS.map((s) => (
              <FromRow key={s.id} on={from === s.id} label={s.name} hint={s.hint} onPick={() => start(s.id, s.html, s.name)} />
            ))}
            {yours.length ? (
              <>
                <p className="label ws-label-gap">Yours</p>
                {yours.map(([id, w]) => (
                  <FromRow key={id} on={from === `yours:${id}`} label={w.name} hint={w.by && w.by !== "user" ? `Made by ${w.by}` : "Made by you"} onPick={() => start(`yours:${id}`, w.html, `${w.name}`)} />
                ))}
              </>
            ) : null}
            <button type="button" className="btn ws-import" onClick={() => file.current?.click()}>
              <Icon name="open" size={14} />
              Import a file…
            </button>
            <input
              ref={file}
              type="file"
              accept=".html,.htm,text/html"
              hidden
              onChange={(e) => {
                importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </nav>

          <div className="ws-edit">
            <input
              className="ws-name"
              type="text"
              value={name}
              placeholder={nameFromHtml(html, "Name it")}
              aria-label="Widget name"
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              ref={code}
              className="ws-code"
              value={html}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-label="Widget code: HTML, with any CSS and JavaScript"
              onChange={(e) => {
                setHtml(e.target.value);
                setError("");
              }}
              onKeyDown={onCodeKey}
            />
            <details className="ws-help" open={helpOpen} onToggle={(e) => setHelpOpen(e.currentTarget.open)}>
              <summary>How widgets work</summary>
              <pre>{WIDGET_API}</pre>
              <p className="hint">Or ask one of your agents: “make me a widget that…”.</p>
            </details>
          </div>

          <div className="ws-preview" aria-label="Preview">
            <p className="label">Preview</p>
            <div className="ws-stage" data-look={dark ? "dark" : "light"}>
              <p className="ws-stage-name">{name.trim() || nameFromHtml(html, "Widget")}</p>
              <WidgetFrame html={shown} dark={dark} title="Preview" onProblem={setProblem} maxHeight={420} />
            </div>
            {problem ? <p className="widget-problem">It hit a snag: {problem}</p> : <p className="hint">Runs as you write. What it saves here isn’t kept.</p>}
          </div>
        </div>

        {error ? <p className="error-line">{error}</p> : null}
        <div className="sheet-actions">
          {editing ? null : (
            <label className="check">
              <input type="checkbox" checked={sidebar} onChange={(e) => setSidebar(e.target.checked)} />
              And to the sidebar
            </label>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save}>
            {editing ? "Save" : "Add to Notebook"}
          </button>
        </div>
      </div>
    </div>
  );
}

const FromRow = ({ on, label, hint, onPick }) => (
  <button type="button" className="ws-from-row" aria-pressed={on} onClick={onPick}>
    <span className="ws-from-name">{label}</span>
    <span className="ws-from-hint">{hint}</span>
  </button>
);
