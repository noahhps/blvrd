import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { LIVE, TYPES, isFixed, notebook, useNotebook } from "../lib/notebook.js";
import { versionLines } from "../lib/notebookSync.js";
import { GRID, freeSpot, packRows, pushDown, snap } from "../lib/placement.js";
import { outside, sidebarIndexAt, widgetDrop } from "../lib/widgetDrop.js";
import { Icon } from "./Icon.jsx";
import { RowMenu } from "./RowMenu.jsx";
import { LIVE_WIDGETS } from "./widgets/index.jsx";
import { WidgetPlace } from "./widgets/WidgetHead.jsx";

/* The Notebook (lib/notebook.js): a page that goes on down and sideways as
 * far as it's used, where widgets are made -- and what agents read about the
 * user. It reads like a Notion page: plain, with nothing that looks like a
 * field until it's typed in.
 *
 * Everything sits where it was put, and empty space is space to use: click
 * it to write right there, or type "/" there for a widget (facts as label and
 * value, a to-do list, a note, or one of the app's: Calendar, Now
 * playing...). Drag empty space to look around. A widget's handles sit above
 * its corner: + for a widget under it, ⋮⋮ to move it -- it lands snapped into
 * the open space where it's dropped, or onto the sidebar -- or, clicked, its
 * menu.
 *
 * What's typed waits in a draft (lib/notebook.js) until it's saved: with ⌘S
 * or Save, or a few seconds after the hand leaves the page. ⌘Z and ⇧⌘Z undo
 * and redo the user's own steps; History shows every version, agents'
 * included, and can undo any of them. */

const KINDS = {
  facts: { icon: "props", also: ["table", "properties", "details", "info", "key", "value"] },
  list: { icon: "todo", also: ["todo", "to-do", "checklist", "tasks", "bullets"] },
  note: { icon: "text", also: ["text", "paragraph", "writing", "page"] },
};

const ago = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const itemId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* Focus the input `selector` inside `root`, with the caret at the end. */
function focusIn(root, selector) {
  const el = root?.querySelector(selector);
  if (!el) return;
  el.focus();
  const end = el.value?.length ?? 0;
  el.setSelectionRange?.(end, end);
}

/* Where the caret goes after a row is added or removed: set by `go`, moved
   there once the rows have rendered. */
function useCaret(body) {
  const [target, setTarget] = useState(null);
  useLayoutEffect(() => {
    if (target) focusIn(body.current, target.selector);
  }, [target, body]);
  return (selector) => setTarget({ selector });
}

export function NotebookView({ focus = null, nameOf, notify, widgetCtx }) {
  const { sections, settings, loaded, head, pending, dirty, conflicts, canUndo, canRedo } = useNotebook();
  const sidebar = settings.sidebar || [];
  const scroll = useRef(null);
  const [history, setHistory] = useState(false);

  // While the hand is in the notebook its draft waits; once focus leaves --
  // for a chat, the sidebar, another app -- the count to saving it starts.
  useEffect(() => {
    const box = scroll.current;
    if (!box) return undefined;
    const into = () => notebook.hold(true);
    const out = (e) => !box.contains(e.relatedTarget) && notebook.hold(false);
    const away = () => notebook.hold(false);
    box.addEventListener("focusin", into);
    box.addEventListener("focusout", out);
    addEventListener("blur", away);
    return () => {
      box.removeEventListener("focusin", into);
      box.removeEventListener("focusout", out);
      removeEventListener("blur", away);
      notebook.hold(false);
    };
  }, []);

  const undo = () => {
    const done = notebook.undo();
    if (done?.skipped.length) notify(`Undone, except ${done.skipped.length === 1 ? "one change" : `${done.skipped.length} changes`} made since by someone else`);
  };
  const redo = () => {
    const done = notebook.redo();
    if (done?.skipped.length) notify(`Redone, except ${done.skipped.length === 1 ? "one change" : `${done.skipped.length} changes`} that no longer fit`);
  };
  // What's being typed in a field joins the draft as the field is left; ⌘S
  // takes it too, without moving the caret.
  const save = () => {
    const el = document.activeElement;
    if (el && scroll.current?.contains(el)) {
      el.blur();
      el.focus();
    }
    notebook.save();
  };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        return save();
      }
      // A field being typed in keeps its own undo.
      const el = document.activeElement;
      if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type !== "checkbox"))) return;
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const canvas = useRef(null);
  const flow = useRef(null);
  // Agents' changes since the user last opened the page, fixed for the visit
  // so the marks don't vanish while being read.
  const [since] = useState(() => {
    try {
      return Number(localStorage.getItem("blvrd.notebook-seen")) || 0;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("blvrd.notebook-seen", String(Date.now()));
    } catch {
      // The marks just won't outlast the visit.
    }
  }, []);

  const [fresh, setFresh] = useState(null); // a widget just made: its heading takes the caret
  const [made, setMade] = useState(null); // ...and, once drawn, it settles clear of its neighbours
  const [caret, setCaret] = useState(null); // { x, y, start }: where writing starts
  const [spot, setSpot] = useState(null); // where a widget being dragged would land
  const [menu, setMenu] = useState(null); // { at, section }

  // Made where the caret was: a widget ("/"), or the words typed there.
  const create = (type, data, at) => {
    setCaret(null);
    if (type.startsWith("live:")) {
      const added = notebook.addLive(type.slice(5));
      notebook.place(added.id, at);
      return setMade(added.id);
    }
    const added = notebook.add(type, null, undefined, data, at);
    setMade(added.id);
    if (type !== "text") setFresh(added.id);
  };
  // The widgets' sections not on the page right now, offered by "/".
  const missingLive = Object.keys(LIVE).filter((source) => !sections.some((s) => s.type === "live" && s.source === source));

  // Opened from a sidebar widget: that section, in view.
  useEffect(() => {
    if (focus?.section) document.getElementById(`section-${focus.section}`)?.scrollIntoView({ block: "center", inline: "center" });
  }, [focus]);

  const remove = (section) => {
    const undo = notebook.remove(section.id);
    notify(`Deleted “${section.title}”`, undo);
  };

  const placed = sections.filter((s) => s.at);
  const unplaced = sections.filter((s) => !s.at);

  // How far the page goes: a screen past the furthest thing on it, both
  // ways -- there's always room further on.
  const [extent, setExtent] = useState({ w: 0, h: 0, bottom: 0 });
  useLayoutEffect(() => {
    const box = canvas.current;
    if (!box) return;
    let right = 0;
    let bottom = 0;
    for (const el of box.querySelectorAll(":scope > .nb-place")) {
      right = Math.max(right, el.offsetLeft + el.offsetWidth);
      bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
    }
    const view = scroll.current;
    const next = { w: right + (view?.clientWidth || 800), h: bottom + (view?.clientHeight || 600), bottom };
    if (next.w !== extent.w || next.h !== extent.h || next.bottom !== extent.bottom) setExtent(next);
  });

  // Sections with no place yet (from before the page could be arranged) are
  // laid out once, in rows under what's placed, and kept where they fell.
  useLayoutEffect(() => {
    if (!unplaced.length || !flow.current || !canvas.current) return;
    const cells = [...flow.current.children];
    const spots = packRows(
      cells.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight })),
      canvas.current.clientWidth,
      placed.length ? extent.bottom + 48 : 0,
    );
    notebook.placeMany(Object.fromEntries(cells.map((el, i) => [el.dataset.id, spots[i]])));
  });

  // Anything placed before the page was a table of cells (or by hand, off
  // it) is put on the cells once: top to bottom, each on the nearest open one.
  useLayoutEffect(() => {
    if (!canvas.current || !placed.some((s) => s.at.x % GRID || s.at.y % GRID)) return;
    const els = new Map([...canvas.current.querySelectorAll(":scope > .nb-place")].map((el) => [el.dataset.id, el]));
    const done = [];
    const where = {};
    for (const s of [...placed].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)) {
      const el = els.get(s.id);
      if (!el) continue;
      const size = { w: el.offsetWidth, h: el.offsetHeight };
      const at = freeSpot(s.at, size, done);
      done.push({ ...at, ...size });
      where[s.id] = at;
    }
    notebook.placeMany(where);
  });

  // A widget that grows (a longer list, an agent's new facts, a busier month)
  // pushes down only what it would run into, as a table's column would.
  // Watched by size, so growth inside a widget counts too. Not mid-drag.
  useEffect(() => {
    const box = canvas.current;
    if (!box) return undefined;
    const settle = () => {
      if (box.querySelector(":scope > .nb-place[data-dragging]")) return;
      const rects = [...box.querySelectorAll(":scope > .nb-place")].map((el) => ({ id: el.dataset.id, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
      const moved = pushDown(rects);
      if (Object.keys(moved).length) notebook.placeMany(moved);
    };
    const watch = new ResizeObserver(settle);
    box.querySelectorAll(":scope > .nb-place").forEach((el) => watch.observe(el));
    // Also once the notebook's change has reached every widget (an edit
    // shows a render after the page's own), size observer or not.
    const later = setTimeout(settle, 0);
    return () => {
      watch.disconnect();
      clearTimeout(later);
    };
  });

  // Empty space: a click starts writing there; a drag looks around.
  const pan = useRef(null);
  const onDown = (e) => {
    if (e.target !== canvas.current || e.button !== 0) return;
    pan.current = { x: e.clientX, y: e.clientY, left: scroll.current.scrollLeft, top: scroll.current.scrollTop, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    canvas.current.dataset.panning = "";
    scroll.current.scrollLeft = p.left - dx;
    scroll.current.scrollTop = p.top - dy;
  };
  const onUp = (e) => {
    const p = pan.current;
    pan.current = null;
    if (!p) return;
    delete canvas.current.dataset.panning;
    if (p.moved) return;
    const box = canvas.current.getBoundingClientRect();
    setCaret({ x: snap(e.clientX - box.left - GRID / 2), y: snap(e.clientY - box.top - GRID / 2), start: "" });
  };

  return (
    <div className="nb-scroll" ref={scroll}>
      <header className="nb-head">
        <h1 className="nb-page-title">Notebook</h1>
        <p className="nb-page-lede">What your agents know about you. Click anywhere to write, or type “/” there for a widget. Drag widgets where you like, or onto the sidebar.</p>
        <div className="nb-props">
          <span className="nb-prop-key">
            <Icon name="pen" size={14} />
            Agent edits
          </span>
          <label className="nb-toggle" title="When on, agents ask in the chat before changing anything here">
            <span className="switch">
              <input type="checkbox" role="switch" checked={settings.approve} onChange={(e) => notebook.setApprove(e.target.checked)} />
              <span />
            </span>
            <span className="nb-toggle-label">Ask before saving</span>
          </label>
          <span className="nb-prop-key">
            <Icon name="history" size={14} />
            Version
          </span>
          <div className="nb-save" aria-live="polite">
            <span className="nb-version">v{head}</span>
            {pending ? (
              <>
                <span className="nb-unsaved">
                  <span className="nb-dot" />
                  Unsaved changes
                </span>
                <button type="button" className="btn nb-save-button" onClick={save} title="Save now (⌘S) — it also saves a few seconds after you leave the notebook">
                  Save
                </button>
              </>
            ) : (
              <span className="nb-saved">Saved</span>
            )}
            <button type="button" className="btn icon-only" disabled={!canUndo} onClick={undo} aria-label="Undo" title="Undo (⌘Z)">
              <Icon name="undo" size={16} />
            </button>
            <button type="button" className="btn icon-only" disabled={!canRedo} onClick={redo} aria-label="Redo" title="Redo (⇧⌘Z)">
              <Icon name="redo" size={16} />
            </button>
            <button type="button" className="btn" aria-pressed={history} onClick={() => setHistory((h) => !h)}>
              History
            </button>
          </div>
        </div>
        {history ? <History nameOf={nameOf} notify={notify} head={head} /> : null}
      </header>

      {!loaded ? null : (
        <div
          className="nb-canvas"
          ref={canvas}
          style={{ width: extent.w || undefined, height: extent.h || undefined }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (pan.current = null)}
        >
          {placed.map((section) => (
            <Item key={section.id} section={section} scroll={scroll} canvas={canvas} onSpot={setSpot} settleClear={made === section.id} onSettled={() => setMade(null)}>
              {(handle) => body(section, handle)}
            </Item>
          ))}

          {/* Where the widget in hand will land. */}
          {spot ? <div className="nb-spot" style={{ transform: `translate(${spot.x}px, ${spot.y}px)`, width: spot.w, height: spot.h }} aria-hidden="true" /> : null}

          {caret ? (
            <div className="nb-caret" style={{ left: caret.x, top: caret.y }}>
              <SlashLine
                key={`${caret.x},${caret.y}`}
                start={caret.start}
                autoFocus
                placeholder="Write, or “/” for a widget"
                missingLive={missingLive}
                onCreate={(type, data) => create(type, data, { x: caret.x, y: caret.y })}
                onCancel={() => setCaret(null)}
                onLeave={(text) => create("text", { text }, { x: caret.x, y: caret.y })}
              />
            </div>
          ) : null}

          {unplaced.length ? (
            <div className="nb-flow" ref={flow} aria-hidden="true">
              {unplaced.map((section) => (
                <div key={section.id} data-id={section.id} className="nb-flow-cell">
                  {body(section, {})}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {menu ? (
        <RowMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={
            isFixed(menu.section)
              ? [{ label: "Always in the sidebar", disabled: true, run: () => {} }]
              : [
                  sidebar.includes(menu.section.id)
                    ? { label: "Remove from sidebar", run: () => notebook.removeFromSidebar(menu.section.id) }
                    : { label: "Add to sidebar", run: () => notebook.addToSidebar(menu.section.id) },
                  "-",
                  { label: menu.section.type === "live" ? "Remove from the notebook" : "Delete", danger: true, run: () => remove(menu.section) },
                ]
          }
        />
      ) : null}
    </div>
  );

  // A section drawn: the app's widget, words on the page, or one of yours.
  function body(section, handle) {
    const onMenu = (at) => setMenu({ at, section });
    const onAddBelow = () => addBelow(section);
    if (section.type === "live")
      return <LiveBlock section={section} handle={handle} widgetCtx={widgetCtx} inSidebar={sidebar.includes(section.id)} onAddBelow={onAddBelow} onMenu={onMenu} />;
    if (section.type === "text") return <TextItem section={section} handle={handle} onMenu={onMenu} />;
    return (
      <Block
        section={section}
        handle={handle}
        autoFocus={fresh === section.id}
        onFocused={() => setFresh(null)}
        editor={section.edited && section.edited.by !== "user" ? nameOf(section.edited.by) : null}
        marked={section.edited?.by !== "user" && section.edited?.at > since}
        unsaved={dirty.includes(section.id)}
        clashes={conflicts.filter((c) => c.sec === section.id)}
        nameOf={nameOf}
        onAddBelow={onAddBelow}
        onMenu={onMenu}
        inSidebar={sidebar.includes(section.id)}
      />
    );
  }

  // + on a widget: the caret just under it, "/" already typed.
  function addBelow(section) {
    const el = document.getElementById(`section-${section.id}`)?.closest(".nb-place");
    setCaret({ x: section.at?.x ?? 0, y: snap((section.at?.y ?? 0) + (el?.offsetHeight ?? 0) + 24), start: "/" });
  }
}

/* -- on the page -----------------------------------------------------------------
 * A widget sits where it was put. Dragged by its handle it follows the
 * pointer, a dashed outline shows where it will land -- there, snapped to the
 * grid, or the nearest open space if that's taken (lib/placement.js) -- and
 * on letting go it glides into it. Nothing else moves. Carried over the
 * sidebar, it goes in there instead (lib/widgetDrop.js) and floats home. The
 * arrow keys, on its handle, nudge it a grid step. */

// Everything else on the page, as rectangles: what a widget must keep clear of.
function othersThan(canvas, self) {
  return [...canvas.querySelectorAll(":scope > .nb-place")]
    .filter((el) => el !== self)
    .map((el) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
}

function Item({ section, scroll, canvas, onSpot, settleClear, onSettled, children }) {
  const el = useRef(null);
  const drag = useRef(null);
  const glide = (from) => {
    const node = el.current;
    const to = node.getBoundingClientRect();
    const x = from.left - to.left;
    const y = from.top - to.top;
    if (Math.abs(x) + Math.abs(y) < 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = getComputedStyle(node).getPropertyValue("--ease-out").trim() || "ease-out";
    node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], { duration: 200, easing: ease });
  };
  const spotFor = (want) => {
    const node = el.current;
    const size = { w: node.offsetWidth, h: node.offsetHeight };
    return { ...freeSpot(want, size, othersThan(canvas.current, node)), ...size };
  };

  // Just made where something already was: it moves into the open space.
  useLayoutEffect(() => {
    if (!settleClear || !el.current) return;
    const at = spotFor(section.at);
    if (at.x !== section.at.x || at.y !== section.at.y) notebook.place(section.id, { x: at.x, y: at.y });
    onSettled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleClear]);

  const end = (how) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.started) return;
    widgetDrop.clear();
    onSpot(null);
    removeEventListener("keydown", d.onKey);
    const node = el.current;
    const from = node.getBoundingClientRect();
    delete node.dataset.dragging;
    node.style.transform = "";
    if (how === "place" && d.spot) flushSync(() => notebook.place(section.id, { x: d.spot.x, y: d.spot.y }));
    glide(from);
  };
  const handle = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, started: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.started) {
        if (Math.hypot(dx, dy) < 4) return;
        d.started = true;
        d.onKey = (k) => k.key === "Escape" && end("home");
        addEventListener("keydown", d.onKey);
        el.current.dataset.dragging = "";
      }
      d.point = { x: e.clientX, y: e.clientY };
      // Straight under the pointer: it's the hand, never eased.
      el.current.style.transform = `translate(${dx}px, ${dy}px)`;
      const toSidebar = sidebarIndexAt(d.point);
      widgetDrop.set({ chip: outside(scroll.current, d.point) ? { id: section.id, x: d.point.x, y: d.point.y, label: section.title } : null, sidebarAt: toSidebar });
      d.spot = toSidebar == null ? spotFor({ x: section.at.x + dx, y: section.at.y + dy }) : null;
      onSpot(d.spot);
    },
    onPointerUp: () => {
      const d = drag.current;
      if (!d?.started) {
        drag.current = null;
        return;
      }
      const at = sidebarIndexAt(d.point);
      if (at != null) {
        notebook.addToSidebar(section.id, at);
        widgetDrop.set({ arrived: section.id });
        setTimeout(() => widgetDrop.get().arrived === section.id && widgetDrop.set({ arrived: null }), 600);
        return end("home");
      }
      end("place");
    },
    onPointerCancel: () => end("home"),
    onKeyDown: (e) => {
      const by = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key];
      if (!by) return;
      e.preventDefault();
      const next = spotFor({ x: section.at.x + by[0], y: section.at.y + by[1] });
      notebook.place(section.id, { x: next.x, y: next.y });
    },
  };
  return (
    <div ref={el} className="nb-place" data-id={section.id} style={{ left: section.at.x, top: section.at.y }}>
      {children(handle)}
    </div>
  );
}

/* Words written on the page, right where they were: as wide as they are,
   edited in place. Left empty, they go. */
function TextItem({ section, handle, onMenu }) {
  const box = useRef(null);
  useEffect(() => {
    if (box.current && document.activeElement !== box.current) box.current.innerText = section.data.text;
  }, [section.data.text]);
  const save = () => {
    const text = box.current.innerText.trim();
    if (!text) return void notebook.remove(section.id);
    if (text !== section.data.text) notebook.write(section.id, { text });
  };
  return (
    <section className="nb-block nb-text-item" id={`section-${section.id}`}>
      <Gutter section={section} handle={handle} onMenu={onMenu} />
      <div
        ref={box}
        className="nb-freetext"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Text on the page"
        onBlur={save}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
      />
    </section>
  );
}

/* -- a section --------------------------------------------------------------- */

function Block({ section, handle, autoFocus, onFocused, editor, marked, unsaved, clashes = [], nameOf, onAddBelow, onMenu, inSidebar }) {
  const root = useRef(null);
  const title = useRef(null);
  useLayoutEffect(() => {
    if (!autoFocus) return;
    title.current?.focus();
    title.current?.select();
    title.current?.scrollIntoView({ block: "nearest" });
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const [name, setName] = useState(section.title);
  useEffect(() => setName(section.title), [section.title]);
  const rename = () => {
    const next = name.trim() || TYPES[section.type].label;
    setName(next);
    if (next !== section.title) notebook.rename(section.id, next);
  };

  return (
    <section ref={root} className="nb-block" id={`section-${section.id}`} data-sort={section.id} data-marked={marked ? "" : undefined} data-unsaved={unsaved ? "" : undefined}>
      <Gutter section={section} handle={handle} onAddBelow={onAddBelow} onMenu={onMenu} />
      <div className="nb-heading">
        <input
          ref={title}
          className="nb-title"
          value={name}
          placeholder="Untitled"
          aria-label="Section heading"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            focusIn(root.current, ".nb-body input:not([type=checkbox]), .nb-body textarea");
          }}
        />
        {/* Who last changed it, when it was an agent: there whenever it's new to
            the user (with the red mark), otherwise on pointing at the section.
            It sits in the heading's row, so showing it moves nothing. */}
        {editor ? (
          <span className="nb-meta">
            {marked ? <span className="nb-dot" /> : null}
            Updated by {editor} · {ago(section.edited.at)}
          </span>
        ) : null}
        {inSidebar ? (
          <span className="nb-in-sidebar" title="In the sidebar">
            <Icon name="sidebar" size={14} />
          </span>
        ) : null}
      </div>

      {clashes.map((c) => (
        <p className="nb-clash" key={c.target}>
          {nameOf(c.by)} changed {clashWhat(section, c)} while you were editing.
          <button type="button" className="nb-clash-button" onClick={() => notebook.settle(c.target, "mine")}>
            Keep mine
          </button>
          <button type="button" className="nb-clash-button" onClick={() => notebook.settle(c.target, "theirs")}>
            Use theirs
          </button>
        </p>
      ))}

      {section.type === "facts" ? <Facts section={section} /> : section.type === "list" ? <Todo section={section} /> : <Text section={section} />}

    </section>
  );
}

/* What a clash was over, in words: a row, an item, or the section. */
function clashWhat(section, clash) {
  const entry = (section.data.rows || section.data.items || []).find((e) => e.id === clash.id);
  return entry ? `“${entry.key ?? entry.text}”` : "this";
}

/* -- history ---------------------------------------------------------------------
 * Every version kept, newest first: who, when, what it did -- and Undo, which
 * reverses it with a new version (anything changed since is left alone). */

const PAGE = 40;

function History({ nameOf, notify, head }) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState(null);
  // Read again whenever the head moves.
  const versions = useMemo(() => notebook.history(), [head]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = (by) => (by === "user" ? "You" : nameOf(by));
  const undo = (v) => {
    const done = notebook.revert(v);
    if (!done?.version) notify(`Nothing to undo in v${v}: what it changed has been changed since`);
    else if (done.skipped.length) notify(`Undid v${v}, except what's been changed since`);
    else notify(`Undid v${v}`);
  };
  if (!versions.length) return <div className="nb-history"><p className="nb-history-none">No versions yet: they start with your next change.</p></div>;
  return (
    <div className="nb-history" role="list" aria-label="Versions">
      {versions.slice(0, shown).map((r) => {
        const lines = versionLines(r);
        const more = open === r.v ? lines : lines.slice(0, 2);
        return (
          <div className="nb-version-row" role="listitem" key={r.v}>
            <div className="nb-version-head">
              <span className="nb-version">v{r.v}</span>
              <span className="nb-version-who">{who(r.by)}</span>
              {r.label ? <span className="nb-version-label">{r.label}</span> : null}
              {r.revertOf != null ? <span className="nb-version-label">undid v{r.revertOf}</span> : null}
              <span className="nb-version-when">{ago(r.at)}</span>
              <button type="button" className="nb-clash-button" onClick={() => undo(r.v)}>
                Undo
              </button>
            </div>
            <ul className="nb-version-lines">
              {more.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
              {lines.length > 2 ? (
                <li>
                  <button type="button" className="nb-clash-button" onClick={() => setOpen(open === r.v ? null : r.v)}>
                    {open === r.v ? "Less" : `${lines.length - 2} more`}
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        );
      })}
      {versions.length > shown ? (
        <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
          Older versions
        </button>
      ) : null}
    </div>
  );
}

/* The margin's + and ⋮⋮ (see Block). */
function Gutter({ section, handle, onAddBelow, onMenu }) {
  const down = useRef(null);
  return (
    <div className="nb-gutter">
      {onAddBelow ? (
        <button type="button" className="nb-gutter-button" aria-label="Add a widget below" title="Add a widget below" onClick={onAddBelow}>
          <Icon name="plus" size={16} />
        </button>
      ) : null}
      <button
        type="button"
        className="nb-gutter-button nb-handle"
        aria-label={`${section.title}: drag to move, or open its menu`}
        title="Drag to move · Click for options"
        {...handle}
        onPointerDown={(e) => {
          down.current = { x: e.clientX, y: e.clientY };
          handle.onPointerDown?.(e);
        }}
        onClick={(e) => {
          const d = down.current;
          if (d && e.detail && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
          const box = e.currentTarget.getBoundingClientRect();
          onMenu({ x: box.left, y: box.bottom + 4 });
        }}
      >
        <Icon name="grip" size={16} />
      </button>
    </div>
  );
}

/* A sidebar widget's section: just the widget, drawn as it is in the
   sidebar -- on the sidebar's ground, at its width, no title over it -- and
   as live as it is there. Agents read the same thing as rows
   (lib/liveRows.js), under the section's title. */
function LiveBlock({ section, handle, widgetCtx, inSidebar, onAddBelow, onMenu }) {
  const Widget = LIVE_WIDGETS[section.source];
  return (
    <section className="nb-block nb-live" id={`section-${section.id}`} data-sort={section.id}>
      <Gutter section={section} handle={handle} onAddBelow={onAddBelow} onMenu={onMenu} />
      {Widget && widgetCtx ? (
        <div className="nb-widget" aria-label={`${section.title}${inSidebar ? ", in the sidebar" : ""}`}>
          <WidgetPlace.Provider value="notebook">
            <Widget ctx={widgetCtx} handle={null} section={section} />
          </WidgetPlace.Provider>
        </div>
      ) : null}
    </section>
  );
}

/* A section's draft: what's being typed, kept to itself while the caret is
   in the section, saved once as it leaves. An agent's change shows at once
   unless the user is mid-edit (then theirs wins on save). */
function useDraft(section) {
  const [draft, setDraft] = useState(section.data);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(section.data);
  }, [section.data]);
  const bodyProps = (clean) => ({
    onFocus: () => (editing.current = true),
    onBlur: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      editing.current = false;
      const next = clean(draft);
      setDraft(next);
      if (JSON.stringify(next) !== JSON.stringify(section.data)) notebook.write(section.id, next);
    },
  });
  return [draft, setDraft, bodyProps];
}

/* -- facts: label and value -------------------------------------------------- */

function Facts({ section }) {
  const body = useRef(null);
  const go = useCaret(body);
  const [draft, setDraft, bodyProps] = useDraft(section);
  const rows = draft.rows.length ? draft.rows : [{ key: "", value: "" }];
  const set = (next) => setDraft({ rows: next });
  const change = (i, patch) => set(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Rows keep their ids, so a changed label is the same row changed.
  const clean = (d) => ({ rows: d.rows.map((r) => ({ ...r, key: r.key.trim(), value: r.value.trim() })).filter((r) => r.key) });

  return (
    <div className="nb-body nb-facts" ref={body} {...bodyProps(clean)}>
      {rows.map((r, i) => (
        <div className="nb-fact" key={i} data-row={i}>
          <input
            className="nb-key"
            value={r.key}
            placeholder="Label"
            aria-label="Label"
            onChange={(e) => change(i, { key: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(`[data-row="${i}"] .nb-value`);
              } else if (e.key === "Backspace" && !r.key && !r.value && rows.length > 1) {
                e.preventDefault();
                set(rows.filter((_, j) => j !== i));
                go(`[data-row="${Math.max(0, i - 1)}"] .nb-value`);
              }
            }}
          />
          <input
            className="nb-value"
            value={r.value}
            placeholder="Empty"
            aria-label={`${r.key || "Label"}: value`}
            onChange={(e) => change(i, { value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                set([...rows.slice(0, i + 1), { key: "", value: "" }, ...rows.slice(i + 1)]);
                go(`[data-row="${i + 1}"] .nb-key`);
              } else if (e.key === "Backspace" && !r.value) {
                e.preventDefault();
                go(`[data-row="${i}"] .nb-key`);
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* -- a to-do list ------------------------------------------------------------- */

function Todo({ section }) {
  const body = useRef(null);
  const go = useCaret(body);
  const [draft, setDraft, bodyProps] = useDraft(section);
  const items = draft.items.length ? draft.items : [{ id: "blank", text: "", done: false }];
  const set = (next) => setDraft({ items: next });
  const clean = (d) => ({ items: d.items.map((x) => ({ ...x, id: x.id === "blank" ? itemId() : x.id, text: x.text.trim() })).filter((x) => x.text) });
  // A tick is saved at once, even mid-edit: it's an answer, not a draft.
  const tick = (id, done) => {
    const next = items.map((x) => (x.id === id ? { ...x, done } : x));
    set(next);
    const saved = clean({ items: next });
    if (JSON.stringify(saved) !== JSON.stringify(section.data)) notebook.write(section.id, saved);
  };

  return (
    <ul className="nb-body nb-todo" ref={body} {...bodyProps(clean)}>
      {items.map((item, i) => (
        <li className="nb-item" key={item.id} data-row={i} data-done={item.done ? "" : undefined}>
          <label className="nb-check">
            <input type="checkbox" checked={item.done} disabled={!item.text.trim()} onChange={(e) => tick(item.id, e.target.checked)} aria-label={`Done: ${item.text}`} />
            <span>
              <Icon name="check" size={12} />
            </span>
          </label>
          <input
            className="nb-item-text"
            value={item.text}
            placeholder="To-do"
            aria-label="To-do"
            onChange={(e) => set(items.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Enter on an empty last item ends the list, as in any editor.
                if (!item.text.trim() && i === items.length - 1 && items.length > 1) {
                  set(items.slice(0, -1));
                  e.currentTarget.blur();
                  return;
                }
                set([...items.slice(0, i + 1), { id: itemId(), text: "", done: false }, ...items.slice(i + 1)]);
                go(`[data-row="${i + 1}"] .nb-item-text`);
              } else if (e.key === "Backspace" && !item.text && items.length > 1) {
                e.preventDefault();
                set(items.filter((x) => x.id !== item.id));
                go(`[data-row="${Math.max(0, i - 1)}"] .nb-item-text`);
              }
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/* -- free text ----------------------------------------------------------------- */

function Text({ section }) {
  const area = useRef(null);
  const [draft, setDraft, bodyProps] = useDraft(section);
  // Grows with what's written rather than scrolling inside itself.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.text]);
  return (
    <div className="nb-body" {...bodyProps((d) => ({ text: d.text.trim() }))}>
      <textarea
        ref={area}
        className="nb-text"
        rows={1}
        value={draft.text}
        placeholder="Write anything an agent should know…"
        aria-label={`${section.title}: text`}
        onChange={(e) => setDraft({ text: e.target.value })}
      />
    </div>
  );
}

/* -- "/" ------------------------------------------------------------------------
 * An empty line that makes sections: "/" opens the kinds (filtered by what
 * follows it; ↑ ↓ and Enter to pick); plain words and Enter make a note of
 * them. Opened by typing, so it simply appears. */

function SlashLine({ onCreate, onCancel = null, onLeave = null, placeholder = "Type “/” for a section", start = "", autoFocus = false, missingLive = [] }) {
  const [value, setValue] = useState(start);
  const [pick, setPick] = useState(0);
  const input = useRef(null);
  useLayoutEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
    input.current?.setSelectionRange(start.length, start.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = value.startsWith("/") ? value.slice(1).trim().toLowerCase() : null;
  // The kinds of section, then any widget's section that's been taken out.
  const kinds = [
    // (Text isn't one: typing here, without "/", is how text is made.)
    ...Object.entries(TYPES)
      .filter(([type]) => KINDS[type])
      .map(([type, t]) => [type, { label: t.label, hint: t.hint, icon: KINDS[type].icon, also: KINDS[type].also }]),
    ...missingLive.map((source) => [`live:${source}`, { label: LIVE[source].title, hint: `${LIVE[source].hint} · live`, icon: "sidebar", also: ["widget", "live", source] }]),
  ];
  const options = query == null ? [] : kinds.filter(([, t]) => !query || t.label.toLowerCase().includes(query) || t.also.some((a) => a.includes(query)));
  const at = Math.min(pick, Math.max(0, options.length - 1));
  const make = (type, data = null) => {
    setValue("");
    setPick(0);
    onCreate(type, data);
  };

  return (
    <div className="nb-slash">
      <input
        ref={input}
        className="nb-slash-input"
        value={value}
        placeholder={placeholder}
        aria-label="Add a section"
        aria-expanded={query != null}
        aria-controls="nb-insert"
        aria-activedescendant={options[at] ? `nb-insert-${options[at][0]}` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setPick(0);
        }}
        onBlur={() => {
          // Words typed and left (not "/"): they stay, as text.
          if (onLeave && value.trim() && !value.startsWith("/")) return onLeave(value.trim());
          if (onCancel && (!value.trim() || value.startsWith("/"))) onCancel();
        }}
        onKeyDown={(e) => {
          if (query != null && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            if (options.length) setPick((at + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (query != null) options[at] && make(options[at][0]);
            else if (value.trim()) make("note", { text: value.trim() });
          } else if (e.key === "Escape") {
            setValue("");
            onCancel?.();
          } else if (e.key === "Backspace" && !value) {
            onCancel?.();
          }
        }}
      />
      {query != null ? (
        <div className="nb-insert" id="nb-insert" role="listbox" aria-label="Kinds of section">
          {options.length ? (
            options.map(([type, t], i) => (
              <div
                key={type}
                id={`nb-insert-${type}`}
                role="option"
                aria-selected={i === at}
                className="nb-insert-option"
                onPointerEnter={() => setPick(i)}
                // Picking mustn't blur the line first.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => make(type)}
              >
                <span className="nb-insert-icon">
                  <Icon name={t.icon} size={18} />
                </span>
                <span className="nb-insert-text">
                  <span className="nb-insert-name">{t.label}</span>
                  <span className="nb-insert-hint">{t.hint}</span>
                </span>
              </div>
            ))
          ) : (
            <p className="nb-insert-none">No kind of section matches.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
