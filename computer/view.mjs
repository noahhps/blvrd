/* The page as a model reads it: built for a budget, not completeness
 * (docs/computer.md §4).
 *
 *   Example — Sign in            https://example.com/login
 *   [4] textbox "Email"   [5] textbox "Password"   [9] button "Sign in"
 *   … 31 more in the header, footer and menus (find <text> to reach one)
 *   ----
 *   the page's main text, cut to what's left of the budget
 *
 * Things to act on get short numbers (refs) that stay with them while the
 * page lives. After an action on the same page the view is what changed --
 * what appeared, what went, what's different -- not the page again. */

// What's on a page, read in the page itself -- shared with the extension
// that drives the reader's own browser (extension/collect.js).
import { COLLECT } from "./extension/collect.js";

export { COLLECT };

const itemText = (it) => `[${it.ref}] ${it.role}${it.name ? ` "${it.name}"` : ""}${it.state ? ` ${it.state}` : ""}`;

function packItems(items, budget) {
  const out = [];
  let line = "";
  let used = 0;
  let shown = 0;
  for (const it of items) {
    const t = itemText(it);
    if (used + t.length + 3 > budget) break;
    if (line && line.length + t.length + 3 > 110) {
      out.push(line);
      line = "";
    }
    line = line ? `${line}   ${t}` : t;
    used += t.length + 3;
    shown += 1;
  }
  if (line) out.push(line);
  return { text: out.join("\n"), shown };
}

const where = (s) => {
  if (!s || s.h <= s.vh + 10) return "";
  const pct = Math.round((s.y / (s.h - s.vh)) * 100);
  return pct <= 0 ? " (top of a longer page; scroll down for more)" : pct >= 98 ? " (scrolled to the bottom)" : ` (scrolled ${pct}% down)`;
};

/** The whole page, in `limit` characters. */
export function fullView(state, limit = 6000) {
  const head = `${state.title || "(no title)"} — ${state.url}${where(state.scroll)}`;
  const parts = [head];
  if (state.dialogs.length) parts.push(`A dialog is open: ${state.dialogs.join(" | ").slice(0, 600)}`);
  // What can be acted on: the page's own first (a dialog's before all), then
  // the header, footer and menus -- listed if there's room, counted if not.
  const own = state.items.filter((i) => !i.chrome).sort((a, b) => Number(b.dialog) - Number(a.dialog));
  const chrome = state.items.filter((i) => i.chrome);
  const itemsBudget = Math.floor(limit * 0.45);
  const first = packItems(own, itemsBudget);
  const second = packItems(chrome, Math.max(0, itemsBudget - first.text.length));
  if (first.text) parts.push(first.text);
  if (second.shown) parts.push(second.text);
  const hidden = own.length - first.shown + chrome.length - second.shown;
  if (hidden > 0) parts.push(`… ${hidden} more to act on${chrome.length - second.shown > 0 ? ", most in the header, footer and menus" : ""} (find <text> to reach one)`);
  const sofar = parts.join("\n").length;
  const room = limit - sofar - 20;
  if (state.text && room > 200) {
    const text = state.text.length > room ? `${state.text.slice(0, room - 80).replace(/\s+\S*$/, "")}\n[... ${state.text.length - room + 80} more characters of text; scroll down or find <text>]` : state.text;
    parts.push("----", text);
  }
  return parts.join("\n");
}

/** What changed from `before` to `after` on the same page; null when it's
 *  another page (and a full view is due). */
export function diffView(before, after, limit = 6000) {
  if (!before || before.url !== after.url) return null;
  const old = new Map(before.items.map((i) => [i.ref, i]));
  const now = new Map(after.items.map((i) => [i.ref, i]));
  const added = after.items.filter((i) => !old.has(i.ref));
  const gone = before.items.filter((i) => !now.has(i.ref));
  const changed = after.items.filter((i) => old.has(i.ref) && (old.get(i.ref).state !== i.state || old.get(i.ref).name !== i.name));
  const lines = [];
  const newDialogs = after.dialogs.filter((d) => !before.dialogs.includes(d));
  if (newDialogs.length) lines.push(`A dialog opened: ${newDialogs.join(" | ").slice(0, 600)}`);
  if (before.dialogs.length && !after.dialogs.length) lines.push("The dialog closed.");
  const budget = Math.floor(limit * 0.5);
  if (added.length) {
    const p = packItems(added, budget);
    lines.push(`New: ${p.text}${added.length > p.shown ? ` … and ${added.length - p.shown} more` : ""}`);
  }
  if (changed.length) lines.push(`Changed: ${changed.slice(0, 20).map(itemText).join("   ")}`);
  if (gone.length) lines.push(`Gone: ${gone.slice(0, 20).map((i) => `[${i.ref}]`).join(" ")}${gone.length > 20 ? ` and ${gone.length - 20} more` : ""}`);
  const was = new Set(before.text.split("\n"));
  const fresh = after.text.split("\n").filter((l) => l.trim() && !was.has(l));
  if (fresh.length) {
    const room = Math.max(300, limit - lines.join("\n").length - 100);
    const t = fresh.join("\n");
    lines.push(`New text:\n${t.length > room ? `${t.slice(0, room)}\n[... more; look for the whole page]` : t}`);
  }
  if (before.scroll?.y !== after.scroll?.y) lines.push(`Now${where(after.scroll) || " at the top"}.`);
  if (!lines.length) return `Nothing on the page changed. (${after.title} — ${after.url})`;
  return [`${after.title} — ${after.url} — what changed:`, ...lines].join("\n");
}

/** What on the page has `text` in it: things to act on, and lines of text
 *  with the line around each. */
export function findView(state, text, limit = 6000) {
  const want = text.toLowerCase();
  const items = state.items.filter((i) => `${i.name} ${i.state}`.toLowerCase().includes(want));
  const lines = state.text.split("\n");
  const hits = [];
  lines.forEach((l, i) => {
    if (l.toLowerCase().includes(want)) hits.push(lines.slice(Math.max(0, i - 1), i + 2).join(" / "));
  });
  const parts = [`“${text}” on ${state.title} — ${state.url}:`];
  if (items.length) parts.push(packItems(items, Math.floor(limit * 0.4)).text);
  if (hits.length) parts.push(...hits.slice(0, 12).map((h) => `· ${h.slice(0, 300)}`));
  if (hits.length > 12) parts.push(`… and ${hits.length - 12} more lines`);
  if (!items.length && !hits.length) parts.push("Nothing with that in it is showing. Scroll, or look at the whole page.");
  const out = parts.join("\n");
  return out.length > limit ? `${out.slice(0, limit - 40)}\n[... cut]` : out;
}
