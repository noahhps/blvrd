/* blvrd's characters, drawn as SVG for pictures made outside the app: the
 * installer's background (../dmg/background.mjs) and the app icons
 * (../icons/variants.mjs). The shapes are components/Mascot.jsx's, at the
 * same 100-unit size, so the characters are the ones in the app. */

// lib/agents.js COLOURS, and the logo's blue (styles/app.css --accent).
export const C = { red: "#e5392b", orange: "#ef8a2b", yellow: "#e3b21f", green: "#33a061", blue: "#3a7bdc", violet: "#8758d6", accent: "#007cff" };
export const INK = "#1a1a1a";

// color-mix(in srgb, c p%, #000), as mascot.css darkens a shape's parts.
export const shade = (hex, p) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * p).toString(16).padStart(2, "0")).join("");

function star(cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (-90 + i * 36) * (Math.PI / 180);
    points.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${points.join("L")}Z`;
}

// Mascot.jsx SHAPES: the art in a 100-unit square, the eyes' centres, and
// `foot`, how far down the square the shape stands (for its shadow).
export const SHAPES = {
  arc: {
    eyes: [[41, 29], [59, 29]],
    foot: 88,
    art: (c) => `<path d="M15 85V52A35 35 0 0 1 85 52V85H64V52A14 14 0 0 0 36 52V85Z" fill="${c}" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>`,
  },
  magnifier: {
    eyes: [[38, 44], [54, 44]],
    foot: 84,
    art: (c) => `<path d="M64 64L81 81" fill="none" stroke="${shade(c, 0.45)}" stroke-width="11" stroke-linecap="round"/><circle cx="46" cy="46" r="27" fill="${c}"/>`,
  },
  pencil: {
    eyes: [[43, 52], [57, 52]],
    foot: 90,
    art: (c) =>
      `<path d="M34 70L50 90L66 70Z" fill="#f2d3a0"/><path d="M45 84L50 90L55 84Z" fill="#333"/><rect x="34" y="34" width="32" height="37" fill="${c}"/><rect x="34" y="16" width="32" height="16" rx="6" fill="#f28fb0"/><rect x="34" y="30" width="32" height="6" fill="#c9c9c9"/>`,
  },
  calendar: {
    eyes: [[42, 59], [58, 59]],
    foot: 81,
    art: (c) =>
      `<rect x="35" y="18" width="5" height="14" rx="2.5" fill="${shade(c, 0.68)}"/><rect x="60" y="18" width="5" height="14" rx="2.5" fill="${shade(c, 0.68)}"/><rect x="22" y="25" width="56" height="56" rx="9" fill="${c}"/><path d="M22 34a9 9 0 0 1 9-9h38a9 9 0 0 1 9 9v8H22Z" fill="${shade(c, 0.68)}"/>`,
  },
  envelope: {
    eyes: [[40, 54], [60, 54]], // either side of the fold's point
    foot: 78,
    edge: `<rect x="17" y="30" width="66" height="48" rx="7"/>`,
    art: (c) =>
      `<rect x="17" y="30" width="66" height="48" rx="7" fill="${c}"/><path d="M20 34L50 57L80 34" fill="none" stroke="${shade(c, 0.68)}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`,
  },
  book: {
    eyes: [[48, 46], [62, 46]],
    foot: 82,
    art: (c) =>
      `<rect x="24" y="22" width="52" height="60" rx="6" fill="${c}"/><rect x="24" y="22" width="10" height="60" rx="4" fill="${shade(c, 0.68)}"/><rect x="34" y="74" width="42" height="5" fill="#fff"/>`,
  },
  chart: {
    eyes: [[40, 38], [60, 38]],
    foot: 80,
    art: (c) =>
      `<rect x="20" y="20" width="60" height="60" rx="11" fill="${c}"/><rect x="29" y="61" width="9" height="11" rx="2" fill="#fff"/><rect x="45.5" y="55" width="9" height="17" rx="2" fill="#fff"/><rect x="62" y="50" width="9" height="22" rx="2" fill="#fff"/>`,
  },
  palette: {
    eyes: [[46, 38], [62, 38]],
    foot: 84,
    art: (c) =>
      `<path d="M50 18C72 18 86 32 86 50C86 62 78 66 70 64C63 62 58 66 60 73C62 80 57 84 50 84C30 84 14 70 14 50C14 32 30 18 50 18Z" fill="${c}"/><circle cx="27" cy="48" r="5" fill="#ef5350"/><circle cx="34" cy="64" r="5" fill="#f5c518"/><circle cx="48" cy="73" r="4.5" fill="#3a7bdc"/>`,
  },
  heart: {
    eyes: [[40, 48], [60, 48]],
    foot: 84,
    art: (c) => `<path d="M50 84C35 74 18 63 18 45C18 34 27 26 37 26C43 26 47.5 29 50 34C52.5 29 57 26 63 26C73 26 82 34 82 45C82 63 65 74 50 84Z" fill="${c}"/>`,
  },
  star: {
    eyes: [[43, 54], [57, 54]],
    foot: 84,
    art: (c) => `<path d="${star(50, 55, 34, 16)}" fill="${c}" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>`,
  },
  drop: {
    eyes: [[43, 62], [57, 62]],
    foot: 86,
    art: (c) => `<path d="M50 16C50 16 76 45 76 63C76 77 64 86 50 86C36 86 24 77 24 63C24 45 50 16 50 16Z" fill="${c}"/>`,
  },
};

/* An eye, in one of three moods: "happy" (closed in a smile, ^), "wink"
 * (Mascot.jsx's own), or open and looking toward `look` [dx, dy]. */
function eye(kind, look = [0, 0]) {
  if (kind === "happy") return `<path d="M-5.2 2.6Q0 -5.4 5.2 2.6" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
  if (kind === "wink") return `<path d="M3 -5L-3 0L3 5" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<ellipse rx="6.4" ry="7.4" fill="#fff" stroke="${INK}" stroke-width="2.4"/><circle cx="${look[0]}" cy="${1.8 + look[1]}" r="3.6" fill="${INK}"/>`;
}

/* One character. x: its centre; bottom: where its feet are (GROUND when
 * standing); size in px; tilt in degrees; squash on landing; eyes [left,
 * right]; cheeks: a blush under each eye. */
export function mascot({ shape, colour, x, bottom, size, tilt = 0, squash = 0, eyes = ["happy", "happy"], look, cheeks = false, outline = null }) {
  const s = SHAPES[shape];
  const k = size / 100;
  const sx = 1 + squash;
  const sy = 1 - squash;
  const lids = s.eyes
    .map(([ex, ey], i) => `<g transform="translate(${ex} ${ey})">${eye(eyes[i], look)}</g>`)
    .join("");
  const blush = cheeks
    ? s.eyes.map(([ex, ey]) => `<ellipse cx="${ex + (ex < 50 ? -4 : 4)}" cy="${ey + 9}" rx="4.6" ry="2.6" fill="#ff7a8a" opacity="0.55"/>`).join("")
    : "";
  // `outline`: the shape's edge drawn round it, in that colour, as thick as
  // an eye's -- a white one on white needs it (a shape with an `edge`).
  const edge = outline && s.edge ? `<g fill="none" stroke="${outline}" stroke-width="3" stroke-linejoin="round">${s.edge}</g>` : "";
  // Feet at `bottom`: the square's foot line lands there, turning and
  // squashing about it.
  return `<g transform="translate(${x} ${bottom}) rotate(${tilt}) scale(${sx * k} ${sy * k}) translate(-50 ${-s.foot})">${s.art(colour)}${edge}${blush}${lids}</g>`;
}


// A four-pointed sparkle.
export const sparkle = (x, y, r, fill) =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}"/>`;
