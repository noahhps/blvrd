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
 *   { parts: [{ d, tone, stroke? }], halo: { x, y, r } }
 *
 * `stroke` draws the path as a line that wide (round ends) instead of
 * filling it. The halo -- the ring of diamonds over the emblem's mind, as
 * over Durandal's rider -- is drawn on top by the component, so it can turn.
 *
 * rasterise() needs a canvas (the browser); halftone() is plain arithmetic
 * on the grid it returns. */

const RES = 256; // the sampling canvas, for the emblem's 100-unit square
const sampled = new WeakMap(); // emblem -> darkness per canvas pixel

/** How many cells across an emblem `size` px wide is printed in: a cell
 *  every 1.5px (3 device pixels on a Retina screen), 20 to 64 of them. */
export function cellsFor(size) {
  return Math.max(20, Math.min(64, Math.round(size / 1.5)));
}

/** The emblem's darkness (0-1) in each of n x n cells; null where there is
 *  no canvas to draw on. */
export function rasterise(emblem, n) {
  const dark = sample(emblem);
  if (!dark) return null;
  const cells = new Float32Array(n * n);
  const step = RES / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = Math.floor(i * step), x1 = Math.max(x0 + 1, Math.floor((i + 1) * step));
      const y0 = Math.floor(j * step), y1 = Math.max(y0 + 1, Math.floor((j + 1) * step));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += dark[y * RES + x];
      cells[j * n + i] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return cells;
}

function sample(emblem) {
  if (sampled.has(emblem)) return sampled.get(emblem);
  if (typeof document === "undefined" || typeof Path2D !== "function") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RES;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(RES / 100, RES / 100);
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
  const { data } = ctx.getImageData(0, 0, RES, RES);
  const dark = new Float32Array(RES * RES);
  for (let k = 0; k < dark.length; k++) dark[k] = (data[k * 4 + 3] / 255) * (1 - data[k * 4] / 255);
  sampled.set(emblem, dark);
  return dark;
}

/* Five levels, from the cell's darkness. */
const levelOf = (t) => (t >= 0.86 ? 4 : t >= 0.55 ? 3 : t >= 0.3 ? 2 : t >= 0.1 ? 1 : 0);

// The same stray dots for the same emblem every time.
export function hash(i, j, seed) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 1000;
}

const fix = (v) => +v.toFixed(2);
const dot = (i, j, s) => `M${fix(i + (1 - s) / 2)} ${fix(j + (1 - s) / 2)}h${s}v${s}h-${s}z`;

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
  // Scan streaks: a few rows across the middle, dashed out to the edges,
  // as on the Marathon's own screens.
  const streaks = new Set();
  for (let k = 0; k < 3; k++) streaks.add(Math.floor(n * (0.42 + (hash(k, 7, seed) % 300) / 1000)));
  for (let j = 0; j < n; j++) {
    let run = -1;
    for (let i = 0; i <= n; i++) {
      const l = i < n ? level(i, j) : 0;
      if (l >= 3) {
        if (run < 0) run = i;
        if (l === 3 && i % 2 === 1 && j % 2 === 1) holes.push(dot(i, j, 0.45));
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
        if (near && roll < 110) noise.push(dot(i, j, 0.4));
        else if (streaks.has(j) && roll < 260 && (i < n * 0.22 || i > n * 0.78 || roll < 60)) noise.push(dot(i, j, roll % 3 ? 0.4 : 0.7));
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
      const on = l === 4 || edge ? true : l === 3 ? (i + j) % 2 === 0 : l === 2 ? i % 2 === 0 && j % 2 === 0 : false;
      if (on) ink.push(dot(i, j, 0.78));
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
