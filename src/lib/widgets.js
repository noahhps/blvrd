/* Widgets of the reader's own: small HTML pages -- made in the widget sheet
 * (components/WidgetSheet.jsx), imported from a file, picked from the ready
 * ones below, or written by an agent (lib/widgetTools.js) -- that sit in the
 * Notebook and the sidebar like the app's own.
 *
 *   customWidgets  { [id]: { name, html, data, by, updatedAt } }  (store.js)
 *
 * Each one placed is a live section of the Notebook, `custom:<id>`
 * (lib/notebook.js addWidget). It runs sealed off in a sandboxed frame
 * (components/WidgetFrame.jsx), served from blvrd-widget:// by the desktop
 * app with a policy of its own (src-tauri/src/widgets.rs): it can run its
 * own code and reach the web over https, and nothing of the app's. What it
 * has is `blvrd` (WIDGET_API): its own saved data, the app's look, and a way
 * to open a link in the reader's browser. */

export const MAX_HTML = 300_000; // characters of a widget's page
export const MAX_DATA = 100_000; // characters of its saved data, as JSON

export const sourceOf = (id) => `custom:${id}`;
export const widgetIdOf = (source) => (String(source || "").startsWith("custom:") ? source.slice(7) : null);
export const newWidgetId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** What a widget's page may use -- for the reader in the editor, and for an
 *  agent writing one. */
export const WIDGET_API = `A widget is one HTML page, shown about 240px wide in the sidebar and wider on the Notebook page; its height follows its content. Write a fragment (markup, <style>, <script>) or a whole document. It runs sandboxed: no access to the app, cookies or storage, but fetch() to https APIs that allow it works.

Styling: the page already has the app's look. CSS variables: --ink (text), --dim, --faint, --surface, --well (a quiet fill), --line (hairlines), --accent, --on-accent, --font, --mono, --r (8px corners). They follow light and dark by themselves. Buttons, inputs and selects are styled to match; body has no margin and a transparent background.

window.blvrd:
  blvrd.data        what this widget last saved (null at first)
  blvrd.save(value) keep any JSON value (under 100 KB) for next time
  blvrd.onData(fn)  fn(value) when another copy of this widget saved
  blvrd.theme       "light" or "dark"; blvrd.onTheme(fn) hears changes
  blvrd.open(url)   open an https link in the user's browser`;

/* The app's look inside a widget: its colours in both looks, its fonts, and
   controls that match its own. */
const BASE_CSS = `
:root{--ink:#141414;--dim:#5e5e5b;--faint:#767672;--surface:#fff;--well:#f1f1f0;--line:#e4e4e2;--accent:#007cff;--on-accent:#fff;--mono:ui-monospace,"SF Mono",Menlo,monospace;--r:8px;color-scheme:light}
:root[data-theme="dark"]{--ink:#f2f2f0;--dim:#aaaaa6;--faint:#8e8e8a;--surface:#1f1f1f;--well:#262626;--line:#2f2f2f;--accent:#3392ff;--on-accent:#fff;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{color:var(--ink);font:13px/1.45 var(--font);-webkit-font-smoothing:antialiased;overflow:hidden}
button,input,select,textarea{font:inherit;color:inherit}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);font-weight:500;cursor:pointer;transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 150ms ease}
button:active{transform:scale(.97)}
@media (hover:hover) and (pointer:fine){button:hover{background:var(--well)}}
button.primary{background:var(--ink);border-color:var(--ink);color:var(--surface)}
input,select,textarea{min-width:0;padding:5px 8px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--ink)}
@media (prefers-reduced-motion:reduce){button:active{transform:none}}
`;

/* The widget's side of the bridge: what it saved, the look, its height, and
   a link out -- all by message to the app, the only way out of the frame. */
const RUNTIME = `
(() => {
  const boot = JSON.parse(document.currentScript.dataset.boot);
  const send = (m) => parent.postMessage({ blvrd: true, ...m }, "*");
  const heard = { data: [], theme: [] };
  const blvrd = {
    data: boot.data,
    theme: boot.theme,
    save(value) {
      const json = JSON.stringify(value ?? null);
      if (json.length > ${MAX_DATA}) throw new Error("blvrd.save: over 100 KB");
      blvrd.data = JSON.parse(json);
      send({ type: "save", data: blvrd.data });
    },
    onData: (fn) => heard.data.push(fn),
    onTheme: (fn) => heard.theme.push(fn),
    open(url) {
      if (/^https?:\\/\\//i.test(String(url))) send({ type: "open", url: String(url) });
    },
  };
  window.blvrd = blvrd;
  const root = document.documentElement;
  const look = (theme, font) => {
    root.dataset.theme = theme;
    if (font) root.style.setProperty("--font", font);
  };
  look(boot.theme, boot.font);
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || !m.blvrd) return;
    if (m.type === "theme") {
      blvrd.theme = m.theme;
      look(m.theme, m.font);
      heard.theme.forEach((fn) => fn(m.theme));
    } else if (m.type === "data") {
      blvrd.data = m.data;
      heard.data.forEach((fn) => fn(m.data));
    }
  });
  // Its height, as it changes: the app sizes the frame to it.
  let last = 0;
  const measure = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height);
    if (h !== last) send({ type: "height", height: (last = h) });
  };
  addEventListener("DOMContentLoaded", () => {
    new ResizeObserver(measure).observe(document.body);
    measure();
  });
  addEventListener("error", (e) => send({ type: "error", message: String(e.message || e) }));
  // A wheel nothing in here scrolls with goes to what the widget sits in.
  const scrolls = (node, dy) => {
    for (; node && node !== document.body; node = node.parentElement) {
      const o = getComputedStyle(node).overflowY;
      if ((o === "auto" || o === "scroll") && (dy < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight)) return true;
    }
    return false;
  };
  addEventListener("wheel", (e) => {
    if (!scrolls(e.target, e.deltaY)) send({ type: "wheel", dx: e.deltaX, dy: e.deltaY });
  }, { passive: true });
})();
`;

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** The page a widget runs as: its own HTML with the look and the bridge put
 *  in first. `boot`: { data, theme, font }. */
export function widgetDoc(html, boot) {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${BASE_CSS}</style><script data-boot="${escapeAttr(JSON.stringify(boot))}">${RUNTIME}</script>`;
  const text = String(html || "");
  if (/<head[\s>]/i.test(text)) return text.replace(/<head([^>]*)>/i, (m) => `${m}${head}`);
  if (/<html[\s>]/i.test(text)) return text.replace(/<html([^>]*)>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${text}</body></html>`;
}

/** A widget's name, from its page's <title>, else `fallback`. */
export function nameFromHtml(html, fallback = "Widget") {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(String(html || ""))?.[1]?.trim();
  return (title || fallback).slice(0, 60);
}

/** Why `html` can't be a widget, or null. */
export function problemWith(html) {
  if (!String(html || "").trim()) return "The widget is empty.";
  if (html.length > MAX_HTML) return `That's over ${Math.round(MAX_HTML / 1000)} KB: too big for a widget.`;
  return null;
}

/* -- ready-made ------------------------------------------------------------------- */

/* Ones to start from: each a complete widget, and an example of the API. */
export const STARTERS = [
  {
    id: "clock",
    name: "Clock",
    hint: "The time and date, large",
    html: `<title>Clock</title>
<style>
  .clock { padding: 6px 4px 8px; }
  .time { font-size: 34px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .date { color: var(--dim); }
</style>
<div class="clock"><div class="time" id="time"></div><div class="date" id="date"></div></div>
<script>
  const time = document.getElementById("time");
  const date = document.getElementById("date");
  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  };
  tick();
  setInterval(tick, 1000);
</script>`,
  },
  {
    id: "countdown",
    name: "Countdown",
    hint: "Days to go until something",
    html: `<title>Countdown</title>
<style>
  .cd { padding: 4px; }
  .n { font-size: 34px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .what { color: var(--dim); }
  form { display: none; gap: 6px; flex-direction: column; margin-top: 8px; }
  .editing form { display: flex; }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; }
  .edit { margin-top: 8px; height: 24px; font-size: 12px; color: var(--dim); }
  .editing .edit { display: none; }
</style>
<div class="cd" id="cd">
  <div class="n" id="n"></div>
  <div class="what" id="what"></div>
  <button class="edit" id="edit" type="button">Change</button>
  <form id="form">
    <input id="label" placeholder="What for" maxlength="40">
    <div class="row"><input id="day" type="date"><button class="primary">Save</button></div>
  </form>
</div>
<script>
  const el = (id) => document.getElementById(id);
  const show = (d) => {
    if (!d || !d.day) {
      el("n").textContent = "—";
      el("what").textContent = "Pick a day";
      el("cd").classList.add("editing");
      return;
    }
    const days = Math.round((new Date(d.day + "T00:00") - new Date().setHours(0, 0, 0, 0)) / 864e5);
    el("n").textContent = Math.abs(days) + (Math.abs(days) === 1 ? " day" : " days");
    el("what").textContent = (days >= 0 ? "until " : "since ") + (d.label || "the day");
  };
  el("edit").onclick = () => {
    el("label").value = blvrd.data?.label || "";
    el("day").value = blvrd.data?.day || "";
    el("cd").classList.add("editing");
  };
  el("form").onsubmit = (e) => {
    e.preventDefault();
    blvrd.save({ label: el("label").value.trim(), day: el("day").value });
    el("cd").classList.remove("editing");
    show(blvrd.data);
  };
  blvrd.onData(show);
  show(blvrd.data);
  setInterval(() => show(blvrd.data), 60000);
</script>`,
  },
  {
    id: "counter",
    name: "Counter",
    hint: "Count anything, up and down",
    html: `<title>Counter</title>
<style>
  .c { display: flex; align-items: center; gap: 10px; padding: 4px; }
  .n { flex: 1; font-size: 30px; font-weight: 650; font-variant-numeric: tabular-nums; text-align: center; }
  button { width: 36px; height: 36px; padding: 0; font-size: 18px; border-radius: 999px; }
  .label { display: block; width: 100%; margin-top: 4px; border-color: transparent; background: none; color: var(--dim); text-align: center; }
  .label:focus { border-color: var(--line); }
</style>
<div class="c"><button id="down" aria-label="One less">−</button><div class="n" id="n">0</div><button id="up" aria-label="One more">+</button></div>
<input class="label" id="label" placeholder="What you're counting" maxlength="40">
<script>
  const state = () => blvrd.data || { n: 0, label: "" };
  const show = (d = state()) => {
    document.getElementById("n").textContent = d.n;
    const label = document.getElementById("label");
    if (document.activeElement !== label) label.value = d.label || "";
  };
  const by = (k) => () => { const d = state(); blvrd.save({ ...d, n: d.n + k }); show(); };
  document.getElementById("up").onclick = by(1);
  document.getElementById("down").onclick = by(-1);
  document.getElementById("label").oninput = (e) => blvrd.save({ ...state(), label: e.target.value });
  blvrd.onData(() => show());
  show();
</script>`,
  },
  {
    id: "focus",
    name: "Focus timer",
    hint: "25 minutes on, then a break",
    html: `<title>Focus timer</title>
<style>
  .t { display: flex; align-items: center; gap: 12px; padding: 4px; }
  svg { flex: none; }
  .left { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .mode { color: var(--dim); font-size: 12px; }
  .buttons { display: flex; gap: 6px; margin-top: 6px; }
  circle { fill: none; stroke-width: 5; }
  .track { stroke: var(--well); }
  .bar { stroke: var(--accent); stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 1s linear; }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
</style>
<div class="t">
  <svg width="54" height="54" viewBox="0 0 54 54"><circle class="track" cx="27" cy="27" r="22"/><circle class="bar" id="bar" cx="27" cy="27" r="22" stroke-dasharray="138.2" stroke-dashoffset="0"/></svg>
  <div>
    <div class="left" id="left">25:00</div>
    <div class="mode" id="mode">Focus</div>
    <div class="buttons"><button class="primary" id="go">Start</button><button id="reset">Reset</button></div>
  </div>
</div>
<script>
  const SPANS = { Focus: 25 * 60, Break: 5 * 60 };
  let mode = "Focus", left = SPANS.Focus, timer = null;
  const el = (id) => document.getElementById(id);
  const show = () => {
    el("left").textContent = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
    el("mode").textContent = mode;
    el("bar").style.strokeDashoffset = 138.2 * (1 - left / SPANS[mode]);
    el("go").textContent = timer ? "Pause" : "Start";
  };
  const stop = () => { clearInterval(timer); timer = null; };
  el("go").onclick = () => {
    if (timer) stop();
    else timer = setInterval(() => {
      left -= 1;
      if (left <= 0) { mode = mode === "Focus" ? "Break" : "Focus"; left = SPANS[mode]; }
      show();
    }, 1000);
    show();
  };
  el("reset").onclick = () => { stop(); mode = "Focus"; left = SPANS.Focus; show(); };
  show();
</script>`,
  },
  {
    id: "links",
    name: "Links",
    hint: "Places you go often, one click away",
    html: `<title>Links</title>
<style>
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 6px; }
  a { flex: 1; min-width: 0; padding: 4px 6px; border-radius: 6px; color: var(--ink); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (hover: hover) and (pointer: fine) { a:hover { background: var(--well); } }
  .x { width: 22px; height: 22px; padding: 0; border: 0; background: none; color: var(--faint); opacity: 0; }
  li:hover .x, .x:focus-visible { opacity: 1; }
  form { display: flex; gap: 6px; margin-top: 6px; }
  form input { flex: 1; }
  .none { margin: 0 0 4px; color: var(--faint); }
</style>
<ul id="list"></ul>
<form id="add"><input id="url" placeholder="Paste a link" inputmode="url"><button>Add</button></form>
<script>
  const links = () => (blvrd.data && blvrd.data.links) || [];
  const label = (u) => { try { return new URL(u).hostname.replace(/^www\\./, ""); } catch { return u; } };
  const show = () => {
    const list = document.getElementById("list");
    list.innerHTML = links().length ? "" : '<p class="none">No links yet.</p>';
    links().forEach((u, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = u; a.textContent = label(u); a.title = u;
      a.onclick = (e) => { e.preventDefault(); blvrd.open(u); };
      const x = document.createElement("button");
      x.className = "x"; x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Remove " + label(u));
      x.onclick = () => { blvrd.save({ links: links().filter((_, j) => j !== i) }); show(); };
      li.append(a, x);
      list.append(li);
    });
  };
  document.getElementById("add").onsubmit = (e) => {
    e.preventDefault();
    let u = document.getElementById("url").value.trim();
    if (!u) return;
    if (!/^https?:\\/\\//i.test(u)) u = "https://" + u;
    blvrd.save({ links: [...links(), u] });
    document.getElementById("url").value = "";
    show();
  };
  blvrd.onData(show);
  show();
</script>`,
  },
  {
    id: "habits",
    name: "Habits",
    hint: "A week of ticks for a few habits",
    html: `<title>Habits</title>
<style>
  table { width: 100%; border-collapse: collapse; }
  th { color: var(--faint); font-size: 10.5px; font-weight: 600; text-align: center; padding-bottom: 4px; }
  td { padding: 2px 0; text-align: center; }
  td.name { text-align: left; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 18px; height: 18px; padding: 0; border-radius: 999px; border: 1.5px solid var(--line); background: none; }
  .dot[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); }
  form { display: flex; gap: 6px; margin-top: 6px; }
  form input { flex: 1; }
</style>
<table><thead id="head"></thead><tbody id="body"></tbody></table>
<form id="add"><input id="habit" placeholder="A habit" maxlength="24"><button>Add</button></form>
<script>
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d.toISOString().slice(0, 10); });
  const data = () => blvrd.data || { habits: [], done: {} };
  const show = () => {
    const d = data();
    document.getElementById("head").innerHTML = "<tr><th></th>" + days.map((day) => "<th>" + new Date(day + "T00:00").toLocaleDateString([], { weekday: "narrow" }) + "</th>").join("") + "</tr>";
    const body = document.getElementById("body");
    body.innerHTML = "";
    d.habits.forEach((h) => {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.className = "name"; name.textContent = h; name.title = h;
      tr.append(name);
      days.forEach((day) => {
        const td = document.createElement("td");
        const b = document.createElement("button");
        const key = h + "|" + day;
        b.className = "dot"; b.type = "button";
        b.setAttribute("aria-pressed", String(Boolean(d.done[key])));
        b.setAttribute("aria-label", h + " on " + day);
        b.onclick = () => { const n = data(); blvrd.save({ ...n, done: { ...n.done, [key]: !n.done[key] } }); show(); };
        td.append(b);
        tr.append(td);
      });
      body.append(tr);
    });
  };
  document.getElementById("add").onsubmit = (e) => {
    e.preventDefault();
    const h = document.getElementById("habit").value.trim();
    if (!h) return;
    const d = data();
    blvrd.save({ ...d, habits: [...d.habits.filter((x) => x !== h), h] });
    document.getElementById("habit").value = "";
    show();
  };
  blvrd.onData(show);
  show();
</script>`,
  },
];

/* A blank one: where writing your own starts. */
export const BLANK = `<title>My widget</title>
<style>
  .hello { padding: 4px; }
  .big { font-size: 22px; font-weight: 650; }
</style>
<div class="hello">
  <div class="big">Hello</div>
  <div style="color: var(--dim)">Edit this to make it yours.</div>
</div>
<script>
  // blvrd.data, blvrd.save(value), blvrd.open(url) -- see the help.
</script>`;
