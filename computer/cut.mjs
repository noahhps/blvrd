/* Output cut to what a model can afford (docs/computer.md §6): every
 * observation has a budget, set by the app from the model's real window and
 * passed with each call as `_limit` (characters). What doesn't fit is kept
 * in a file the model can grep, not dropped and not sent. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_LIMIT = 6000;

/** Terminal noise taken out: colour codes, and lines redrawn in place by a
 *  carriage return (progress bars) kept only as they ended. */
export function clean(text) {
  return String(text || "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][A-Z0-9]|\x1b[=>]/g, "")
    .split("\n")
    .map((line) => {
      const parts = line.split("\r");
      // "\r\n" leaves an empty last part: the line as it was before it.
      return parts.length > 1 ? parts.filter((p) => p !== "").at(-1) ?? "" : line;
    })
    .join("\n");
}

let spills = 0;

/** Keep the whole of `text` in `dir`/.blvrd/out, and say where. */
export function spill(dir, text, name = "out") {
  const folder = join(dir, ".blvrd", "out");
  mkdirSync(folder, { recursive: true });
  spills += 1;
  const file = join(folder, `${Date.now().toString(36)}-${spills}-${name}.log`);
  writeFileSync(file, text);
  return file;
}

/** `text` in at most `limit` characters: some of the start and more of the
 *  end -- where errors and results are -- each cut at a line, and a line in
 *  the middle saying how much was left out and where all of it is. `tail`
 *  is the share of the budget given to the end. */
export function cut(text, limit = DEFAULT_LIMIT, { tail = 0.75, keepIn = null, name = "out", what = "lines" } = {}) {
  const s = String(text || "");
  if (s.length <= limit) return s;
  const lines = s.split("\n");
  const backBudget = Math.floor(limit * tail);
  const frontBudget = limit - backBudget;
  const front = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > frontBudget) break;
    front.push(line);
    used += line.length + 1;
  }
  const back = [];
  used = 0;
  for (let i = lines.length - 1; i >= front.length; i--) {
    if (used + lines[i].length + 1 > backBudget) break;
    back.unshift(lines[i]);
    used += lines[i].length + 1;
  }
  // One very long line: cut it by characters instead.
  if (!front.length && !back.length) {
    const where = keepIn ? `; all of it is in ${spill(keepIn, s, name)}` : "";
    return `${s.slice(0, frontBudget)}\n[... ${s.length - limit} characters left out${where} ...]\n${s.slice(-backBudget)}`;
  }
  const left = lines.length - front.length - back.length;
  const where = keepIn ? ` All ${lines.length} ${what} are in ${spill(keepIn, s, name)} -- grep or read it.` : "";
  return [...front, `[... ${left} ${what} left out.${where} ...]`, ...back].join("\n");
}
