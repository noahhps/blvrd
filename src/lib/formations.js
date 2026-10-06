/* The shapes an agent's dots make while it works.
 *
 * Each formation places n dots in a unit box (x and y from -1 to 1, y down),
 * which AgentAvatar scales to the ring's radius. Polygons are sampled evenly
 * along their perimeter from the top, so any count from 2 to 12 makes the
 * shape as well as that many dots can. Pure, so the tests can check them.
 *
 * The order is a walk from round to angular to loose and back, so each step
 * changes something without the whole thing reading as random. */

const TAU = Math.PI * 2;

const ring = (n) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    return [Math.sin(a), -Math.cos(a)];
  });

/* n points spread evenly along a closed polygon's perimeter. */
function alongPerimeter(vertices, n) {
  const edges = vertices.map((v, i) => {
    const w = vertices[(i + 1) % vertices.length];
    return { from: v, to: w, length: Math.hypot(w[0] - v[0], w[1] - v[1]) };
  });
  const total = edges.reduce((sum, e) => sum + e.length, 0);
  return Array.from({ length: n }, (_, i) => {
    let at = (i / n) * total;
    for (const e of edges) {
      if (at <= e.length) {
        const t = e.length ? at / e.length : 0;
        return [e.from[0] + (e.to[0] - e.from[0]) * t, e.from[1] + (e.to[1] - e.from[1]) * t];
      }
      at -= e.length;
    }
    return edges[0].from;
  });
}

const polygon = (sides, rotate = 0) =>
  Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * TAU + rotate;
    return [Math.sin(a), -Math.cos(a)];
  });

export const FORMATIONS = [
  { id: "ring", place: ring },
  { id: "triangle", place: (n) => alongPerimeter(polygon(3), n) },
  {
    id: "wave",
    place: (n) =>
      Array.from({ length: n }, (_, i) => {
        const x = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
        return [x, 0.45 * Math.sin(x * Math.PI)];
      }),
  },
  // A square standing on its corner reads as a diamond; flat on a side, a square.
  { id: "square", place: (n) => alongPerimeter(polygon(4, Math.PI / 4), n) },
  {
    id: "infinity",
    // Bernoulli's lemniscate, widened to fill the box. The loop crosses itself
    // at t = 1/4 and 3/4 of the way round; sampled a quarter step in, no dot
    // ever lands there, so no two dots sit on top of each other.
    place: (n) =>
      Array.from({ length: n }, (_, i) => {
        const t = ((i + 0.25) / n) * TAU;
        const d = 1 + Math.sin(t) ** 2;
        return [Math.cos(t) / d, (1.6 * Math.sin(t) * Math.cos(t)) / d];
      }),
  },
  {
    id: "star",
    // Alternating long and short spokes: a star with as many points as half
    // the dots, or a spiked ring when the count is odd.
    place: (n) => ring(n).map(([x, y], i) => (i % 2 ? [x * 0.45, y * 0.45] : [x, y])),
  },
  {
    id: "grid",
    place: (n) => {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const step = cols > 1 ? 2 / (cols - 1) : 0;
      const rowStep = rows > 1 ? 2 / (rows - 1) : 0;
      return Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - row * cols : cols; // centre a short last row
        const col = i % cols;
        const offset = ((cols - inRow) * step) / 2;
        return [cols > 1 ? -1 + offset + col * step : 0, rows > 1 ? -1 + row * rowStep : 0].map((v) => v * 0.8);
      });
    },
  },
  // Drawn in close, then the next step lets them out again.
  { id: "gather", place: (n) => ring(n).map(([x, y]) => [x * 0.35, y * 0.35]) },
];

/** The dots' positions for formation `index` (wrapping), in units of the radius. */
export function formation(index, n) {
  const f = FORMATIONS[((index % FORMATIONS.length) + FORMATIONS.length) % FORMATIONS.length];
  return f.place(n);
}
