/* Versions of the Notebook (lib/notebook.js): what a change is.
 *
 * A change is a list of operations, each saying what was there before and
 * what is there after -- enough to apply it, undo it, and tell an agent about
 * it, without keeping whole copies of the notebook.
 *
 *   { kind: "entry",  sec, id, prev, before, after }  a facts row or list item:
 *          before null = added (after `prev`, the entry before it, or first);
 *          after null = removed; both = changed
 *   { kind: "order",  sec, before: [id], after: [id] }  entries in a new order
 *   { kind: "text",   sec, before, after }             a note's or text's words
 *   { kind: "create", sec, index, after: section }     a new section
 *   { kind: "remove", sec, index, before: section }    a section gone
 *   { kind: "rename", sec, before, after }             a new title
 *
 * Everything here is pure: sections in, sections out. The app's widgets
 * (type "live"), where things sit on the page and the sidebar aren't memory,
 * so they never appear in an operation. */

export const newEntryId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Where a section's entries are, if it has any: rows (facts), items (lists). */
export const entriesKey = (type) => (type === "facts" ? "rows" : type === "list" ? "items" : null);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A section as it is kept in a version: its words and shape, not its place
 *  on the page or its bookkeeping. */
export function bare(section) {
  const { id, title, type, data, createdAt } = section;
  return { id, title, type, data, createdAt };
}

/** Facts rows given ids where they have none (rows made before they had
 *  them, or by a hand that dropped them), matched to `previous` rows by label
 *  first, so a row keeps its id when only its value changed. */
export function withRowIds(rows, previous = []) {
  const free = previous.filter((r) => r.id);
  const taken = new Set(rows.filter((r) => r.id).map((r) => r.id));
  return rows.map((r) => {
    if (r.id) return r;
    const match = free.find((p) => !taken.has(p.id) && String(p.key).trim().toLowerCase() === String(r.key).trim().toLowerCase());
    const id = match ? match.id : newEntryId("r");
    taken.add(id);
    return { id, ...r };
  });
}

/* -- making operations ------------------------------------------------------------ */

/** The operations that turn section `sec`'s data `before` into `after`. */
export function diffData(sec, type, before, after) {
  const key = entriesKey(type);
  if (!key) {
    const a = String(before?.text ?? "");
    const b = String(after?.text ?? "");
    return a === b ? [] : [{ kind: "text", sec, before: a, after: b }];
  }
  const was = before?.[key] || [];
  const now = after?.[key] || [];
  const wasById = new Map(was.map((e) => [e.id, e]));
  const nowById = new Map(now.map((e) => [e.id, e]));
  const ops = [];
  // Removed first, then changed, then added in order -- so applying them one
  // after another lands every added entry after the one before it.
  was.forEach((e, i) => {
    if (!nowById.has(e.id)) ops.push({ kind: "entry", sec, id: e.id, prev: i ? was[i - 1].id : null, before: e, after: null });
  });
  for (const e of now) {
    const old = wasById.get(e.id);
    if (old && !same(old, e)) ops.push({ kind: "entry", sec, id: e.id, prev: null, before: old, after: e });
  }
  now.forEach((e, i) => {
    if (!wasById.has(e.id)) ops.push({ kind: "entry", sec, id: e.id, prev: i ? now[i - 1].id : null, before: null, after: e });
  });
  // The kept entries in a new order (dragged, say): one more operation.
  const kept = now.filter((e) => wasById.has(e.id)).map((e) => e.id);
  const keptBefore = was.filter((e) => nowById.has(e.id)).map((e) => e.id);
  if (!same(kept, keptBefore)) ops.push({ kind: "order", sec, before: keptBefore, after: kept });
  return ops;
}

/** The operations that turn `before` (sections) into `after`: sections made,
 *  removed, renamed, and what changed inside each. */
export function diffSections(before, after) {
  const memory = (list) => list.filter((s) => s.type !== "live");
  const was = memory(before);
  const now = memory(after);
  const wasById = new Map(was.map((s) => [s.id, s]));
  const nowById = new Map(now.map((s) => [s.id, s]));
  const ops = [];
  for (const s of was) if (!nowById.has(s.id)) ops.push({ kind: "remove", sec: s.id, index: before.indexOf(s), before: bare(s) });
  for (const s of now) {
    const old = wasById.get(s.id);
    if (!old) {
      ops.push({ kind: "create", sec: s.id, index: after.indexOf(s), after: bare(s) });
      continue;
    }
    if (old.title !== s.title && s.type !== "text") ops.push({ kind: "rename", sec: s.id, before: old.title, after: s.title });
    ops.push(...diffData(s.id, s.type, old.data, s.data));
  }
  return ops;
}

/* -- applying them ------------------------------------------------------------------ */

const textTitle = (text) => {
  const line = String(text || "").trim().split("\n")[0].trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || "Text";
};

/** `sections` with `op` applied. An operation whose section is gone does
 *  nothing (it may have been removed by someone else in the meantime). */
export function applyOp(sections, op) {
  if (op.kind === "create") {
    if (sections.some((s) => s.id === op.sec)) return sections;
    const at = Math.max(0, Math.min(op.index ?? sections.length, sections.length));
    const made = { ...op.after, edited: null };
    return [...sections.slice(0, at), made, ...sections.slice(at)];
  }
  if (op.kind === "remove") return sections.filter((s) => s.id !== op.sec);
  return sections.map((s) => (s.id === op.sec ? applyInside(s, op) : s));
}

function applyInside(section, op) {
  if (op.kind === "rename") return { ...section, title: op.after };
  if (op.kind === "text") return { ...section, data: { ...section.data, text: op.after }, ...(section.type === "text" ? { title: textTitle(op.after) } : {}) };
  const key = entriesKey(section.type);
  if (!key) return section;
  let list = section.data[key] || [];
  if (op.kind === "order") {
    const rank = new Map(op.after.map((id, i) => [id, i]));
    // Only the entries the order names move; any others keep their slots.
    const named = list.filter((e) => rank.has(e.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    let next = 0;
    list = list.map((e) => (rank.has(e.id) ? named[next++] : e));
  } else if (op.after === null) {
    list = list.filter((e) => e.id !== op.id);
  } else if (list.some((e) => e.id === op.id)) {
    list = list.map((e) => (e.id === op.id ? op.after : e));
  } else {
    const after = op.prev == null ? -1 : list.findIndex((e) => e.id === op.prev);
    // The entry it followed is gone: it goes at the end.
    const at = op.prev != null && after === -1 ? list.length : after + 1;
    list = [...list.slice(0, at), op.after, ...list.slice(at)];
  }
  return { ...section, data: { ...section.data, [key]: list } };
}

export const applyOps = (sections, ops) => ops.reduce(applyOp, sections);

/** The operation that undoes `op`. */
export function invert(op) {
  if (op.kind === "create") return { kind: "remove", sec: op.sec, index: op.index, before: op.after };
  if (op.kind === "remove") return { kind: "create", sec: op.sec, index: op.index, after: op.before };
  return { ...op, before: op.after, after: op.before };
}

/** The operations that undo `ops`, in the order to apply them. */
export const invertAll = (ops) => [...ops].reverse().map(invert);

/* -- what's there now ---------------------------------------------------------------- */

/** What `op` would find where it applies, in `sections` now: a section, an
 *  entry, a title or words -- or null if that isn't there. */
export function currentOf(sections, op) {
  const s = sections.find((x) => x.id === op.sec);
  if (op.kind === "create" || op.kind === "remove") return s ? bare(s) : null;
  if (!s) return undefined;
  if (op.kind === "rename") return s.title;
  if (op.kind === "text") return String(s.data.text ?? "");
  const list = s.data[entriesKey(s.type)] || [];
  if (op.kind === "order") return list.filter((e) => op.before.includes(e.id) || op.after.includes(e.id)).map((e) => e.id);
  return list.find((e) => e.id === op.id) || null;
}

/** Whether applying `op` would overwrite something other than what it
 *  expects to find (its `before`): someone changed it in the meantime. */
export function stale(sections, op) {
  const now = currentOf(sections, op);
  if (now === undefined) return true; // its section is gone
  if (op.kind === "create") return now !== null;
  if (op.kind === "remove") return now === null || !same(now.data, op.before.data) || now.title !== op.before.title;
  if (op.kind === "order") return !same([...now].sort(), [...op.before].sort());
  return !same(now, op.before);
}

/* -- net changes ------------------------------------------------------------------- */

/** Where an operation lands, so several changes to one thing can be told as
 *  one: the section itself, its title, its words, or one entry. */
export const targetOf = (op) =>
  op.kind === "entry" ? `${op.sec}/${op.id}` : op.kind === "create" || op.kind === "remove" ? op.sec : `${op.sec}:${op.kind}`;

/**
 * Many versions' operations as their net effect, one change per thing that
 * changed: [{ target, sec, kind, id, before, after, by: [who], v, ops }] --
 * where `before` is how it was before the first of them and `after` how it
 * was left. Something changed and changed back is left out; a section made
 * and then changed is just made (what it holds now is in the notebook); a
 * section made and removed again is nothing. `entries`: [{ op, by, v }],
 * oldest first.
 */
export function netChanges(entries) {
  const out = new Map();
  const made = new Set();
  for (const { op, by, v } of entries) {
    // A new section's own changes are part of it being made.
    if (made.has(op.sec) && op.kind !== "remove") {
      const c = out.get(op.sec);
      c.after = { ...c.after, ...(op.kind === "rename" ? { title: op.after } : {}) };
      c.by = [...new Set([...c.by, by])];
      c.v = v;
      c.ops.push(op);
      continue;
    }
    const target = targetOf(op);
    const prior = out.get(target);
    if (prior) {
      prior.after = op.after;
      prior.by = [...new Set([...prior.by, by])];
      prior.v = v;
      prior.ops.push(op);
    } else {
      out.set(target, { target, sec: op.sec, kind: op.kind, id: op.id, before: op.before, after: op.after, by: [by], v, ops: [op] });
    }
    if (op.kind === "create") made.add(op.sec);
    if (op.kind === "remove") {
      // Gone: whatever happened inside it no longer matters.
      for (const [key, c] of out) if (c.sec === op.sec && key !== op.sec) out.delete(key);
      if (made.has(op.sec)) out.delete(op.sec);
      made.delete(op.sec);
    }
  }
  return [...out.values()].filter((c) => {
    if (c.kind === "create") return true;
    // Removed and put back as it was: nothing happened.
    if (c.kind === "remove") return !(c.after && same(c.before.data, c.after.data) && c.before.title === c.after.title);
    return !same(c.before, c.after);
  });
}
