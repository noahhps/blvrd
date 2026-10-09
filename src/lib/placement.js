/* Where something goes on the Notebook's page (components/NotebookView.jsx).
 * The page is a table of small square cells, close together: everything sits
 * on a cell, and every widget is the same width (WIDGET, a whole number of
 * cells), so they line up in columns and rows wherever they're put. A drop
 * lands on the cell under it -- or, if that would put it on top of something,
 * the nearest open one. Nothing already there moves. */

export const GRID = 24;
// Every widget's width: twelve cells.
export const WIDGET = GRID * 12;
// The room kept between things: one cell.
export const GAP = GRID;

export const snap = (v) => Math.max(0, Math.round(v / GRID) * GRID);

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The open spot nearest `want` ({ x, y }) for something `size` ({ w, h })
 *  big, among `others` ([{ x, y, w, h }]). Tried: the spot itself, then the
 *  places just beside, above and below what's in the way -- each snapped, none
 *  off the page's top or left. */
export function freeSpot(want, size, others, gap = GAP) {
  const at = { x: snap(want.x), y: snap(want.y) };
  const clear = (p) => !others.some((o) => overlaps({ ...p, ...size }, o, gap));
  if (clear(at)) return at;
  const xs = new Set([at.x]);
  const ys = new Set([at.y]);
  for (const o of others) {
    xs.add(snap(o.x + o.w + gap));
    xs.add(snap(o.x - size.w - gap));
    xs.add(o.x);
    ys.add(snap(o.y + o.h + gap));
    ys.add(snap(o.y - size.h - gap));
    ys.add(o.y);
  }
  let best = null;
  let bestD = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      if (x < 0 || y < 0) continue;
      // Rounding up to the grid can bring an edge back into the gap.
      const p = { x: Math.ceil(x / GRID) * GRID, y: Math.ceil(y / GRID) * GRID };
      if (!clear(p)) continue;
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  // Everything nearby full: below all of it.
  return best || { x: at.x, y: snap(Math.max(0, ...others.map((o) => o.y + o.h + gap))) };
}

// A column of the table: a widget and the room after it.
export const COLUMN = WIDGET + GAP;

// A widget made wider spans whole columns, so its edges still line up with
// the widgets above and below it: up to this many.
export const MAX_COLS = 4;
export const spanWidth = (cols) => cols * COLUMN - GAP;
/** The columns nearest a width being dragged to, between 1 and `max`. */
export const colsFor = (width, max = MAX_COLS) => Math.min(max, Math.max(1, Math.round((width + GAP) / COLUMN)));
/** The most columns something at `rect` ({ x, y, h }) can span before it would
 *  run into one of `others` -- never fewer than 1. */
export function roomFor(rect, others, max = MAX_COLS, gap = GAP) {
  let cols = 1;
  while (cols < max) {
    const w = spanWidth(cols + 1);
    if (others.some((o) => overlaps({ x: rect.x, y: rect.y, w, h: rect.h }, o, gap))) break;
    cols += 1;
  }
  return cols;
}

/** Positions for things laid out for the first time ([{ w, h }]): in rows
 *  from `top`, left to right, each starting on a column (so they line up
 *  whatever their width), wrapping at `width`, a cell between rows. */
export function packRows(sizes, width, top = 0, gap = { x: GAP, y: GAP }) {
  const out = [];
  let x = 0;
  let y = snap(top);
  let row = 0;
  for (const { w, h } of sizes) {
    if (x > 0 && x + w > width) {
      x = 0;
      y = snap(y + row + gap.y);
      row = 0;
    }
    out.push({ x: snap(x), y });
    x += Math.ceil((w + gap.x) / COLUMN) * COLUMN;
    row = Math.max(row, h);
  }
  return out;
}

/** Things that grew into what's below them ([{ id, x, y, w, h }]): each pushed
 *  down just clear of whatever it now runs into, top to bottom, so a column
 *  makes room the way a table's would. Returns { [id]: { x, y } } for those
 *  that moved -- nothing that doesn't have to moves. */
export function pushDown(rects, gap = GAP) {
  const done = [];
  const moved = {};
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let y = r.y;
    for (;;) {
      const hit = done.filter((o) => r.x < o.x + o.w && o.x < r.x + r.w && y < o.y + o.h + gap && o.y < y + r.h + gap);
      if (!hit.length) break;
      y = Math.ceil((Math.max(...hit.map((o) => o.y + o.h)) + gap) / GRID) * GRID;
    }
    if (y !== r.y) moved[r.id] = { x: r.x, y };
    done.push({ ...r, y });
  }
  return moved;
}
