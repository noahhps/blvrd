import { useEffect, useRef, useState } from "react";

import { invoke, openInBrowser } from "../lib/desktop.js";
import { inDesktop } from "../lib/http.js";
import { widgetDoc } from "../lib/widgets.js";

/* One of the reader's widgets, running (lib/widgets.js): a sandboxed frame --
 * scripts, and nothing of the app's -- as tall as what it shows. In the
 * desktop app its page comes from blvrd-widget:// (src-tauri/src/widgets.rs)
 * with a policy of its own; in a plain browser, written into the frame.
 *
 * The page is made again only when its code changes. The look, and data a
 * copy elsewhere saved, go to it by message; what it saves comes back to
 * `onSave`, and a link it opens goes to the reader's browser. */

const ORIGIN = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent) ? "http://blvrd-widget.localhost/" : "blvrd-widget://localhost/";
let frames = 0;

const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

// The face widgets are set in: the Notebook's widget font (lib/fonts.js).
const fontNow = () => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--nb-font-widget").trim());

export function WidgetFrame({ html, data = null, dark = false, title = "Widget", onSave = null, onProblem = null, maxHeight = 640 }) {
  const frame = useRef(null);
  const [height, setHeight] = useState(40);
  const [page, setPage] = useState(null); // { src } | { srcDoc }
  const key = useRef(null);
  key.current ??= `f${(frames += 1)}`;
  const theme = dark ? "dark" : "light";
  const font = fontNow();
  // What this frame saved last: not sent back to it as news.
  const mine = useRef(data);
  const latest = useRef({ data, theme, font });
  latest.current = { data, theme, font };

  const post = (message) => frame.current?.contentWindow?.postMessage({ blvrd: true, ...message }, "*");

  useEffect(() => {
    const doc = widgetDoc(html, latest.current);
    mine.current = latest.current.data;
    if (!inDesktop()) {
      setPage({ srcDoc: doc });
      return undefined;
    }
    let live = true;
    const name = `${key.current}-${hash(doc)}`;
    invoke("widget_serve", { key: name, html: doc }, "A widget")
      .then(() => live && setPage({ src: ORIGIN + name }))
      .catch((e) => onProblem?.(String(e?.message || e)));
    return () => {
      live = false;
    };
    // Only new code makes a new page; the rest goes by message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  useEffect(() => post({ type: "theme", theme, font }), [theme, font]);
  useEffect(() => {
    if (data === mine.current) return;
    mine.current = data;
    post({ type: "data", data });
  }, [data]);

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.blvrd) return;
      const m = e.data;
      if (m.type === "height") setHeight(Math.max(20, Math.min(maxHeight, Number(m.height) || 0)));
      else if (m.type === "save") {
        mine.current = m.data;
        onSave?.(m.data);
      } else if (m.type === "open") openInBrowser(m.url);
      else if (m.type === "error") onProblem?.(String(m.message || "it hit an error"));
      else if (m.type === "wheel") scrollOuter(frame.current, m.dx, m.dy);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSave, onProblem, maxHeight]);

  return (
    <iframe
      ref={frame}
      className="widget-frame"
      title={title}
      sandbox="allow-scripts"
      style={{ height }}
      // Loaded, it's told the look and data as they are now (they may have
      // changed while it loaded).
      onLoad={() => {
        post({ type: "theme", theme: latest.current.theme, font: latest.current.font });
        if (latest.current.data !== mine.current) post({ type: "data", data: latest.current.data });
      }}
      {...page}
    />
  );
}

/* A wheel over a widget scrolls what it sits in: a frame keeps its wheel to
   itself, and a widget doesn't scroll. */
function scrollOuter(el, dx, dy) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      node.scrollBy({ left: Number(dx) || 0, top: Number(dy) || 0 });
      return;
    }
  }
}
