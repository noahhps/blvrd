/* Dot matrix: an agent's character as a runner terminal prints it, in the
 * UESC and Sekiguchi looks (styles/dotmascot.css). The same shape the
 * character is drawn in (components/Mascot.jsx), sampled onto a square grid
 * of cells and set in dots, the way the terminals print a shell:
 *
 *   uesc       halftone: the mass solid, its mid-tones broken by a lattice
 *              of knocked-out dots, a scatter of stray dots and a scan
 *              streak or two around it -- black ink on the screen's colour
 *   sekiguchi  a specimen scan: separate square pixels, the outline solid,
 *              the body filled in a fine checker, light parts left open
 *
 * Each part of a character has a tone, from 0 (open: paper, paint, the
 * envelope's fold) to 1 (solid: the dark parts, handles, the pencil's lead);
 * the body sits between, so it reads as the mass with texture in it. The
 * eyes are left out of the grid -- the component draws them over it, so
 * they can blink and look.
 *
 * rasterise() needs a canvas (the browser); halftone() is plain arithmetic
 * on the grid it returns. */

const TONES = {
  "m-body": 0.72,
  "m-dark": 1,
  "m-paper": 0,
  "m-fold": 0,
  "m-handle": 1,
  "m-handle-thin": 1,
  "m-wood": 0.4,
  "m-lead": 1,
  "m-metal": 0.25,
  "m-eraser": 1,
  "m-paint1": 0,
  "m-paint2": 0,
  "m-paint3": 0,
};
// Parts drawn as lines (styles/mascot.css), and how wide; `fill` too for
// the ones that are a shape with a soft stroke round it.
const STROKES = {
  "m-round": { width: 7, fill: true },
  "m-fold": { width: 3.4 },
  "m-handle": { width: 11 },
  "m-handle-thin": { width: 5 },
};

const RES = 200; // the sampling canvas, for the character's 100-unit square
const sampled = new Map(); // shape id -> darkness per canvas pixel

/** How many cells across a character `size` px wide is printed in: a cell
 *  every 2px, every 2.5px from 72px up, never fewer than 12. */
export function cellsFor(size) {
  return Math.max(12, Math.min(40, Math.round(size / (size >= 72 ? 2.5 : 2))));
}

/** The character's darkness (0-1) in each of n x n cells, its eyes left
 *  open; null where there is no canvas to draw on. `art` is the shape's
 *  drawing (Mascot.jsx), `eyes` its eye centres. */
export function rasterise(id, art, eyes, n) {
  const dark = sample(id, art);
  if (!dark) return null;
  const cells = new Float32Array(n * n);
  const step = RES / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = Math.round(i * step), x1 = Math.round((i + 1) * step);
      const y0 = Math.round(j * step), y1 = Math.round((j + 1) * step);
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += dark[y * RES + x];
      cells[j * n + i] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  // Under the eyes' whites, nothing: they are drawn on top.
  const unit = 100 / n;
  for (const [ex, ey] of eyes) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (Math.abs((i + 0.5) * unit - ex) <= 6.4 && Math.abs((j + 0.5) * unit - ey) <= 7.4) cells[j * n + i] = 0;
      }
    }
  }
  return cells;
}

function sample(id, art) {
  if (sampled.has(id)) return sampled.get(id);
  if (typeof document === "undefined" || typeof Path2D !== "function") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RES;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(RES / 100, RES / 100);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  paint(ctx, art);
  const { data } = ctx.getImageData(0, 0, RES, RES);
  const dark = new Float32Array(RES * RES);
  for (let k = 0; k < dark.length; k++) dark[k] = (data[k * 4 + 3] / 255) * (1 - data[k * 4] / 255);
  sampled.set(id, dark);
  return dark;
}

/* Each part, in order, in a grey that is its tone: a later part covers an
 * earlier one, as it does on screen. */
function paint(ctx, node) {
  if (Array.isArray(node)) {
    for (const child of node) paint(ctx, child);
    return;
  }
  if (!node || typeof node !== "object") return;
  const { type, props = {} } = node;
  if (typeof type !== "string") {
    paint(ctx, props.children); // a fragment
    return;
  }
  const classes = String(props.className || "").split(/\s+/);
  const tone = TONES[classes.find((c) => c in TONES)] ?? 1;
  const stroke = STROKES[classes.find((c) => c in STROKES)];
  const path = outline(type, props);
  if (!path) return;
  const v = Math.round(255 * (1 - tone));
  ctx.fillStyle = ctx.strokeStyle = `rgb(${v},${v},${v})`;
  if (!stroke || stroke.fill) ctx.fill(path);
  if (stroke) {
    ctx.lineWidth = stroke.width;
    ctx.stroke(path);
  }
}

function outline(type, p) {
  const n = (v) => Number(v) || 0;
  if (type === "path") return new Path2D(p.d);
  const path = new Path2D();
  if (type === "rect") {
    if (p.rx && path.roundRect) path.roundRect(n(p.x), n(p.y), n(p.width), n(p.height), n(p.rx));
    else path.rect(n(p.x), n(p.y), n(p.width), n(p.height));
  } else if (type === "circle") path.arc(n(p.cx), n(p.cy), n(p.r), 0, Math.PI * 2);
  else if (type === "ellipse") path.ellipse(n(p.cx), n(p.cy), n(p.rx), n(p.ry), 0, 0, Math.PI * 2);
  else return null;
  return path;
}

/* Five levels, from the cell's darkness. */
const levelOf = (t) => (t >= 0.86 ? 4 : t >= 0.55 ? 3 : t >= 0.3 ? 2 : t >= 0.1 ? 1 : 0);

// The same stray dots for the same character every time.
function hash(i, j, seed) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 1000;
}

const square = (x, y, s) => `M${+x.toFixed(2)} ${+y.toFixed(2)}h${s}v${s}h-${s}z`;
const dot = (i, j, s) => square(i + (1 - s) / 2, j + (1 - s) / 2, s);

/** The grid in dots, as SVG path data in cell units (a viewBox n wide):
 *  `ink`, the dots and solid runs; `holes`, the dots knocked out of the
 *  mass (drawn in the screen's colour); `noise`, the strays around it. */
export function halftone(cells, n, look = "uesc", seed = 0) {
  const level = (i, j) => (i < 0 || j < 0 || i >= n || j >= n ? 0 : levelOf(cells[j * n + i]));
  return look === "sekiguchi" ? specimen(level, n) : uesc(level, n, seed);
}

function uesc(level, n, seed) {
  const ink = [];
  const holes = [];
  const noise = [];
  // Scan streaks: a row or two across the lower half, dashed out to the edges.
  const streaks = new Set([Math.floor(n * (0.5 + (hash(1, 2, seed) % 200) / 1000)), Math.floor(n * (0.68 + (hash(3, 4, seed) % 120) / 1000))]);
  for (let j = 0; j < n; j++) {
    let run = -1;
    for (let i = 0; i <= n; i++) {
      const l = i < n ? level(i, j) : 0;
      if (l >= 3) {
        if (run < 0) run = i;
        if (l === 3 && i % 2 === 1 && j % 2 === 1) holes.push(dot(i, j, 0.5));
        continue;
      }
      if (run >= 0) {
        ink.push(`M${run} ${j}h${i - run}v1h-${i - run}z`);
        run = -1;
      }
      if (i === n) break;
      if (l === 2 && (i + j) % 2 === 0) ink.push(dot(i, j, 0.7));
      else if (l === 1 && i % 2 === 0 && j % 2 === 0) ink.push(dot(i, j, 0.55));
      else if (l === 0) {
        const near = [-2, -1, 1, 2].some((d) => level(i + d, j) >= 2 || level(i, j + d) >= 2);
        const roll = hash(i, j, seed);
        if (near && roll < 160) noise.push(dot(i, j, 0.4));
        else if (streaks.has(j) && i % 2 === 0 && roll < 420) noise.push(dot(i, j, 0.4));
      }
    }
  }
  return { ink: ink.join(""), holes: holes.join(""), noise: noise.join("") };
}

function specimen(level, n) {
  const ink = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const l = level(i, j);
      if (!l) continue;
      const edge = l >= 3 && (level(i - 1, j) < 2 || level(i + 1, j) < 2 || level(i, j - 1) < 2 || level(i, j + 1) < 2);
      const on =
        l === 4 || edge ? true : l === 3 ? (i + j) % 2 === 0 : l === 2 ? i % 2 === 0 && j % 2 === 0 : false;
      if (on) ink.push(dot(i, j, 0.78));
    }
  }
  return { ink: ink.join(""), holes: "", noise: "" };
}
