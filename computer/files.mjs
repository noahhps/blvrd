/* Files, the cheap way (docs/computer.md §4).
 *
 *   read   numbered lines, a window of the file at a time; a directory lists
 *          itself; a file too big for the budget is outlined first, so the
 *          model asks for the part it needs
 *   write  a whole file, or more on the end of one (`append`), so a model with
 *          little output room can write a long file in parts
 *   edit   exact find and replace: a fix is the lines that change, not the
 *          file again. A `find` that isn't there, or is there twice, comes back
 *          with where it nearly was, so the next try lands
 *
 * Paths are taken from where the shell is, as the model would expect after
 * a `cd` -- except the task's notes, .task/…, which are always the
 * workspace's, wherever the shell has gone. */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

import { DEFAULT_LIMIT } from "./cut.mjs";

export const WINDOW_LINES = 200;
const MAX_LISTED = 200;

let ROOT = null;
/** The workspace, for .task/ paths. */
export const setRoot = (root) => (ROOT = root);

export function pathIn(cwd, path) {
  const p = String(path || "").trim();
  if (!p) throw new Error("no path given");
  if (ROOT && /^\.?\/?\.task\//.test(p)) return resolve(ROOT, p.replace(/^\.?\//, ""));
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}

/** Whether `path` is outside `root` (the workspace). */
export const outside = (root, path) => {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${"/"}`) || isAbsolute(rel);
};

const numbered = (lines, from) => {
  const width = String(from + lines.length - 1).length;
  return lines.map((l, i) => `${String(from + i).padStart(width)}| ${l}`).join("\n");
};

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// The lines that say what a code file holds: its functions, classes, exports.
const DEFINES = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?|class|def|fn|func|struct|enum|trait|impl|interface|type|module|pub\s+(fn|struct|enum|trait|mod)|const\s+\w+\s*=\s*(async\s*)?\(|#{1,3}\s)/;

export function read(cwd, { path, from, lines } = {}, limit = DEFAULT_LIMIT) {
  const file = pathIn(cwd, path);
  if (!existsSync(file)) throw new Error(`there is no ${path}${nearby(file)}`);
  const stat = statSync(file);
  if (stat.isDirectory()) return listing(file, limit);
  const buf = readFileSync(file);
  if (isBinary(buf)) return `${path}: a binary file, ${size(stat.size)}. Look at it with the shell (file, xxd, …).`;
  const all = buf.toString("utf8").split("\n");
  if (all.at(-1) === "") all.pop();
  const total = all.length;
  const start = Math.max(1, Number(from) || 1);
  const want = Math.max(1, Math.min(Number(lines) || WINDOW_LINES, 2000));
  // Asked for nothing in particular, and too big to show: the outline first.
  if (!from && !lines && buf.length > limit) return outline(path, all, limit);
  let shown = all.slice(start - 1, start - 1 + want);
  let text = numbered(shown, start);
  while (text.length > limit && shown.length > 1) {
    shown = shown.slice(0, Math.max(1, Math.floor(shown.length * 0.75)));
    text = numbered(shown, start);
  }
  const end = start + shown.length - 1;
  const more = end < total ? `\n[lines ${start}-${end} of ${total}; read from=${end + 1} for more]` : start > 1 ? `\n[lines ${start}-${end} of ${total}]` : "";
  return `${text}${more}`;
}

function outline(path, all, limit) {
  const head = all.slice(0, 30);
  const defs = all.map((l, i) => [i + 1, l]).filter(([, l]) => DEFINES.test(l)).map(([n, l]) => `${n}| ${l.trim().slice(0, 120)}`);
  let parts = [`${path}: ${all.length} lines, too long to show at once. The start:`, numbered(head, 1)];
  if (defs.length) parts.push(`What it defines (line| text):`, defs.join("\n"));
  parts.push(`Read a part with from= and lines=, or search it with the shell (grep -n).`);
  let text = parts.join("\n");
  if (text.length > limit) text = `${text.slice(0, limit - 80)}\n[... outline cut; grep -n for the rest]`;
  return text;
}

function listing(dir, limit) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = entries.slice(0, MAX_LISTED).map((e) => {
    if (e.isDirectory()) return `${e.name}/`;
    try {
      return `${e.name}  ${size(statSync(join(dir, e.name)).size)}`;
    } catch {
      return e.name;
    }
  });
  let text = `${dir}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}\n${lines.join("\n")}`;
  if (entries.length > MAX_LISTED) text += `\n[... and ${entries.length - MAX_LISTED} more; use the shell: ls, find]`;
  return text.length > limit ? `${text.slice(0, limit - 60)}\n[... cut; use the shell: ls, find]` : text;
}

// A file that isn't there, but something like it is.
function nearby(file) {
  try {
    const dir = dirname(file);
    const want = file.slice(dir.length + 1).toLowerCase();
    const near = readdirSync(dir).filter((n) => n.toLowerCase().includes(want.split(".")[0]) || want.includes(n.toLowerCase().split(".")[0]));
    return near.length ? `. In ${dir} there is: ${near.slice(0, 5).join(", ")}` : "";
  } catch {
    return "";
  }
}

export function write(cwd, { path, content, append } = {}) {
  const file = pathIn(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  const text = String(content ?? "");
  if (append) appendFileSync(file, text);
  else writeFileSync(file, text);
  const total = readFileSync(file, "utf8").split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const added = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return append ? `added ${added} line${added === 1 ? "" : "s"} to ${path} (now ${total})` : `wrote ${added} line${added === 1 ? "" : "s"} to ${path}`;
}

const squash = (s) => s.replace(/\s+/g, " ").trim();

export function edit(cwd, { path, find, replace } = {}) {
  const file = pathIn(cwd, path);
  if (!existsSync(file)) throw new Error(`there is no ${path}${nearby(file)}`);
  const text = readFileSync(file, "utf8");
  const wanted = String(find ?? "");
  if (!wanted) throw new Error("`find` is empty -- give the exact text to change");
  const count = text.split(wanted).length - 1;
  const lines = text.split("\n");
  if (count === 0) {
    // Where it nearly was: the same words, spacing aside, or the line that
    // shares the most with its first line.
    const first = squash(wanted.split("\n")[0]);
    const tight = (t) => t.replace(/\s+/g, "");
    const close = lines
      .map((l, i) => [i + 1, l, squash(l) === first || (tight(first) && tight(l).includes(tight(first))) ? 1 : overlap(squash(l), first)])
      .filter(([, , score]) => score > 0.5)
      .sort((a, b) => b[2] - a[2])
      .slice(0, 3);
    const hint = close.length ? ` The closest: ${close.map(([n, l]) => `line ${n}: ${JSON.stringify(l.trim().slice(0, 100))}`).join("; ")}. Copy it exactly -- spaces and all -- or read the file first.` : " Read the file to see it as it is.";
    throw new Error(`"${wanted.slice(0, 80)}" isn't in ${path}.${hint}`);
  }
  if (count > 1) {
    const at = [];
    let i = text.indexOf(wanted);
    while (i !== -1 && at.length < 5) {
      at.push(text.slice(0, i).split("\n").length);
      i = text.indexOf(wanted, i + 1);
    }
    throw new Error(`"${wanted.slice(0, 80)}" is in ${path} ${count} times (lines ${at.join(", ")}). Put more of the text around it in \`find\` so it is there once.`);
  }
  const at = text.indexOf(wanted);
  const next = text.slice(0, at) + String(replace ?? "") + text.slice(at + wanted.length);
  writeFileSync(file, next);
  const startLine = text.slice(0, at).split("\n").length;
  const newLines = next.split("\n");
  const changed = String(replace ?? "").split("\n").length;
  const from = Math.max(1, startLine - 3);
  const to = Math.min(newLines.length, startLine + changed - 1 + 3);
  return `${path} changed. Now:\n${numbered(newLines.slice(from - 1, to), from)}`;
}

// How much two lines share, by words, 0 to 1.
function overlap(a, b) {
  const wa = new Set(a.split(" "));
  const wb = b.split(" ");
  if (!wb.length || !wa.size) return 0;
  return wb.filter((w) => wa.has(w)).length / Math.max(wb.length, wa.size);
}
