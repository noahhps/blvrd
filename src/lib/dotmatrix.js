/* Dot matrix: an agent's emblem (lib/emblems) as a runner terminal prints
 * it, in the UESC and Sekiguchi looks (components/Emblem.jsx). The emblem
 * is drawn on a canvas, sampled onto a square grid of cells, and set in
 * dots the way the Marathon prints Durandal -- a statue in a model viewer:
 *
 *   uesc       halftone: the mass solid black, its mid-tones broken by a
 *              lattice of knocked-out dots, its light parts a scatter of
 *              dots; stray dots round the edges and a scan streak or two
 *              across the screen
 *   sekiguchi  a specimen scan: separate square pixels, the outline solid,
 *              the body in a checker, the light parts left open
 *
 * An emblem is plain data: paths in a 100-unit square, front last, each
 * with a tone from 0 (open: the screen shows through) to 1 (solid ink):
 *
 *   { parts: [{ d, tone, stroke? }], halo: { x, y, r }, view?: [x0, x1] }
 *
 * `view` lets one run wider than its square, x0 to x1 (Wayland's wings):
 * the whole screen shows all of it, an icon only the square.
 *
 * `stroke` draws the path as a line that wide (round ends) instead of
 * filling it. The halo -- the ring of diamonds over the emblem's mind, as
 * over Durandal's rider -- is drawn on top by the component, so it can turn.
 *
 * rasterise() needs a canvas (the browser); halftone() is plain arithmetic
 * on the grid it returns. */

const sampled = new WeakMap(); // emblem -> Map(resolution and turn -> darkness per pixel)

/** How many cells across an emblem `size` px wide is printed in: a cell
 *  every 1.5px (3 device pixels on a Retina screen), 20 to 64 of them. */
export function cellsFor(size) {
  return Math.max(20, Math.min(64, Math.round(size / 1.5)));
}

/** The emblem's darkness (0-1) in each of n x n cells; null where there is
 *  no canvas to draw on. `turn` (-1..1, the cosine of the angle it's turned
 *  through) narrows it about its middle, and mirrors it past a quarter turn,
 *  as a figure on a turntable does seen from the front. */
export function rasterise(emblem, n, turn = 1) {
  return grid(emblem, n, turn, [0, 100]).cells;
}

/** The whole of a wide emblem (its `view`), n cells high: { cells, w }. */
export function rasteriseView(emblem, n, turn = 1) {
  return grid(emblem, n, turn, emblem.view || [0, 100]);
}

function grid(emblem, n, turn, [v0, v1]) {
  const res = n > 64 ? 1024 : 256;
  const span = (v1 - v0) / 100;
  const sampledHere = sample(emblem, res, turn, v0, v1);
  const w = Math.round(n * span);
  if (!sampledHere) return { cells: null, w };
  const { dark, width } = sampledHere;
  const cells = new Float32Array(w * n);
  const step = res / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < w; i++) {
      const x0 = Math.floor(i * step), x1 = Math.min(width, Math.max(x0 + 1, Math.floor((i + 1) * step)));
      const y0 = Math.floor(j * step), y1 = Math.max(y0 + 1, Math.floor((j + 1) * step));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += dark[y * width + x];
      cells[j * w + i] = sum / Math.max(1, (x1 - x0) * (y1 - y0));
    }
  }
  return { cells, w };
}

function sample(emblem, res, turn, v0 = 0, v1 = 100) {
  const key = `${res}|${turn.toFixed(3)}|${v0}|${v1}`;
  let cache = sampled.get(emblem);
  if (!cache) sampled.set(emblem, (cache = new Map()));
  if (cache.has(key)) return cache.get(key);
  if (typeof document === "undefined" || typeof Path2D !== "function") return null;
  const width = Math.round((res * (v1 - v0)) / 100);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = res;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(res / 100, res / 100);
  ctx.translate(-v0, 0);
  ctx.translate(50, 0);
  ctx.scale(turn, 1);
  ctx.translate(-50, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Each part, in order, in a grey that is its tone: a later part covers
  // an earlier one, as on screen.
  for (const part of emblem.parts || []) {
    let path;
    try {
      path = new Path2D(part.d);
    } catch {
      continue;
    }
    const v = Math.round(255 * (1 - Math.min(1, Math.max(0, part.tone ?? 1))));
    ctx.fillStyle = ctx.strokeStyle = `rgb(${v},${v},${v})`;
    if (part.stroke) {
      ctx.lineWidth = part.stroke;
      ctx.stroke(path);
    } else ctx.fill(path);
  }
  const { data } = ctx.getImageData(0, 0, width, res);
  const dark = new Float32Array(width * res);
  for (let k = 0; k < dark.length; k++) dark[k] = (data[k * 4 + 3] / 255) * (1 - data[k * 4] / 255);
  // A turntable's worth of turns, at most, kept.
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  const out = { dark, width };
  cache.set(key, out);
  return out;
}

// The same stray dots for the same emblem every time.
export function hash(i, j, seed) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 1000;
}

// An ordered dither: where in each 4x4 block a dot goes first.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const order = (i, j) => BAYER[(j % 4) * 4 + (i % 4)];

const fix = (v) => +v.toFixed(2);
const dot = (i, j, s) => `M${fix(i + (1 - s) / 2)} ${fix(j + (1 - s) / 2)}h${fix(s)}v${fix(s)}h-${fix(s)}z`;

/** The grid (w cells wide, h high; square unless h is given) in dots, as
 *  SVG path data in cell units: `ink`, the dots and solid runs; `holes`,
 *  the dots knocked out of the mass (drawn in the screen's colour);
 *  `noise`, the strays around it. */
export function halftone(cells, w, look = "uesc", seed = 0, h = w) {
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : cells[j * w + i]);
  return look === "sekiguchi" ? specimen(at, w, h) : uesc(at, w, h, seed);
}

/* From mid-grey up a cell is part of the mass -- solid, with light knocked
 * out of it in small dots, the fewer the darker; below that it's open
 * screen with dots of ink, the more the darker; both in the dither's order,
 * so the dots fall in a regular lattice, as the Marathon prints them. */
function uesc(at, w, h, seed) {
  const ink = [];
  const holes = [];
  const noise = [];
  // Scan streaks: a few rows across the middle, dashed out to the edges,
  // as on the Marathon's own screens.
  const streaks = new Set();
  for (let k = 0; k < Math.max(3, Math.round(h / 40)); k++) streaks.add(Math.floor(h * (0.42 + (hash(k, 7, seed) % 300) / 1000)));
  const massy = (i, j) => at(i, j) >= 0.3;
  for (let j = 0; j < h; j++) {
    let run = -1;
    for (let i = 0; i <= w; i++) {
      const t = i < w ? at(i, j) : 0;
      if (t >= 0.45) {
        if (run < 0) run = i;
        if (order(i, j) < (1 - t) * 0.9) holes.push(dot(i, j, 0.45));
        continue;
      }
      if (run >= 0) {
        ink.push(`M${run} ${j}h${i - run}v1h-${i - run}z`);
        run = -1;
      }
      if (i === w) break;
      if (t >= 0.08) {
        if (order(i, j) < t * 1.1) ink.push(dot(i, j, 0.5 + 0.4 * (t / 0.45)));
        continue;
      }
      const near = [-2, -1, 1, 2].some((d) => massy(i + d, j) || massy(i, j + d));
      const roll = hash(i, j, seed);
      if (near && roll < 110) noise.push(dot(i, j, 0.4));
      else if (streaks.has(j) && roll < 260 && (i < w * 0.22 || i > w * 0.78 || roll < 60)) noise.push(dot(i, j, roll % 3 ? 0.4 : 0.7));
    }
  }
  return { ink: ink.join(""), holes: holes.join(""), noise: noise.join("") };
}

/* Separate square pixels: the outline of the mass solid, inside it and in
 * the lighter parts on or off in the dither's order. */
function specimen(at, w, h) {
  const ink = [];
  const mass = (i, j) => at(i, j) >= 0.45;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = at(i, j);
      if (t < 0.08) continue;
      const edge = mass(i, j) && (!mass(i - 1, j) || !mass(i + 1, j) || !mass(i, j - 1) || !mass(i, j + 1));
      if (t >= 0.9 || edge || order(i, j) < t * 0.75) ink.push(dot(i, j, 0.78));
    }
  }
  return { ink: ink.join(""), holes: "", noise: "" };
}

/** The halo's diamonds: `count` of them round (x, y) at radius r, in the
 *  emblem's 100-unit square, each turned along the ring; as polygon points,
 *  in cell units. */
export function haloDiamonds({ x, y, r }, n, count = 7, size = null) {
  const u = n / 100;
  // Its half-diagonal: at least a cell, so a small one still reads as a
  // diamond, and no more than a third of the way to the next, so a small
  // ring doesn't close up into a blob.
  const gap = (2 * Math.PI * r * u) / count;
  const s = Math.max(1, Math.min(gap / 3, ((size ?? r * 0.42) * u) / 2));
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / count;
    const cx = (x + r * Math.cos(a)) * u;
    const cy = (y + r * Math.sin(a)) * u;
    // A square turned 45 degrees from the ring's tangent.
    const t = a + Math.PI / 4;
    const pts = [0, 1, 2, 3].map((q) => {
      const b = t + (q * Math.PI) / 2;
      return `${fix(cx + s * Math.cos(b))},${fix(cy + s * Math.sin(b))}`;
    });
    out.push({ points: pts.join(" "), cx: fix(cx), cy: fix(cy), s: fix(s) });
  }
  return out;
}
