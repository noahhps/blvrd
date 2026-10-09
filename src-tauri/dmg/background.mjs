/* The installer's background: the window you drag blvrd into Applications
 * from. The agents' characters bounce along the bottom, pleased about it,
 * and blvrd's own arch hops the dotted way from the app to the folder.
 *
 * Finder shows a still picture, so the jumping is drawn: some in the air with
 * a trail behind and a shadow below, some landing with a squash and a puff.
 * The shapes are Mascot.jsx's, at the same 100-unit size, so the characters
 * here are the ones in the app.
 *
 *   node src-tauri/dmg/background.mjs
 *
 * writes background.svg, then background.png and background@2x.png (drawn
 * by a Chromium browser through computer/'s playwright-core: BLVRD_CHROMIUM,
 * or the first one found), and background.tiff, both sizes in one, which is
 * what tauri.conf.json points the dmg at. The icons sit where that file puts
 * them: the app at (180, 170), Applications at (480, 170). */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { draw } from "../art/draw.mjs";
import { C, mascot, sparkle } from "../art/mascots.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const W = 660;
const H = 400;
const GROUND = 372;


/* The ground's shadow under a character `height` px up: smaller and fainter
 * the higher it goes. */
function shadow(x, size, height) {
  const t = Math.max(0.35, 1 - height / 140);
  return `<ellipse cx="${x}" cy="${GROUND + 3}" rx="${(size * 0.34 * t).toFixed(1)}" ry="${(4.2 * t).toFixed(1)}" fill="#1a1a1a" opacity="${(0.1 * t).toFixed(3)}"/>`;
}

// The dotted way it came: from a landing spot behind, up to where it is.
const trail = (d) => `<path d="${d}" fill="none" stroke="#c4c4bf" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0 7"/>`;

// A landing's puff of dust either side.
const puff = (x) =>
  [-1, 1]
    .map((side) =>
      [0, 1, 2].map((i) => `<circle cx="${x + side * (26 + i * 9)}" cy="${GROUND - 3 - i * 4}" r="${3.6 - i}" fill="#d9d9d4"/>`).join(""),
    )
    .join("");

/* The way in: one curve from beside the app to beside the folder, even about
 * the middle between them -- its top under blvrd -- with the arrow's head at
 * its end, pointing the way the curve is going there. The dots are spaced
 * evenly along each stretch, a dot at each end of it: they part under blvrd
 * and stop just short of the tip, so none shows through either. */
const HOP = { from: [250, 150], top: [330, 50], to: [410, 150] };
const DOT_GAP = 6.5;

// The point on the curve at t, and the part of it from a to b as its own
// quadratic (its control point by blossoming).
const lerp3 = (a, b, c, wa, wb, wc) => [a[0] * wa + b[0] * wb + c[0] * wc, a[1] * wa + b[1] * wb + c[1] * wc];
const at = (t) => lerp3(HOP.from, HOP.top, HOP.to, (1 - t) ** 2, 2 * (1 - t) * t, t * t);
const control = (a, b) => lerp3(HOP.from, HOP.top, HOP.to, (1 - a) * (1 - b), (1 - a) * b + a * (1 - b), a * b);

function length(a, b, steps = 200) {
  let total = 0;
  let last = at(a);
  for (let i = 1; i <= steps; i++) {
    const next = at(a + ((b - a) * i) / steps);
    total += Math.hypot(next[0] - last[0], next[1] - last[1]);
    last = next;
  }
  return total;
}

// The stretch from a to b in evenly spaced dots, as near DOT_GAP apart as
// fits a whole number of them: pathLength counts the gaps.
function dots(a, b) {
  const gaps = Math.max(1, Math.round(length(a, b) / DOT_GAP));
  const [sx, sy] = at(a);
  const [cx, cy] = control(a, b);
  const [ex, ey] = at(b);
  const f = (n) => n.toFixed(2);
  return `<path d="M${f(sx)} ${f(sy)}Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}" pathLength="${gaps}" fill="none" stroke="#b9b9b3" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 1"/>`;
}

function hop() {
  const [x1, y1] = HOP.top;
  const [x2, y2] = HOP.to;
  // At its end a quadratic heads from its control point to its end.
  return dots(0, 0.4) + dots(0.6, 0.93) + arrowhead(x2, y2, x2 - x1, y2 - y1);
}

// An arrow's head at (x, y), pointing along (dx, dy).
function arrowhead(x, y, dx, dy, length = 14, spread = 30) {
  const back = Math.atan2(-dy, -dx);
  const arm = (side) => {
    const a = back + (side * spread * Math.PI) / 180;
    return `${(x + length * Math.cos(a)).toFixed(1)} ${(y + length * Math.sin(a)).toFixed(1)}`;
  };
  return `<path d="M${arm(-1)}L${x} ${y}L${arm(1)}" fill="none" stroke="#b9b9b3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}


/* The characters along the bottom, left to right, and two up top at the
 * height of a jump. Kept off the icons (128px about (180, 170) and
 * (480, 170), their names under them). */
const crowd = [
  // Up top, mid-leap.
  { shape: "heart", colour: C.red, x: 70, bottom: 104, size: 54, tilt: -12, cheeks: true, trailFrom: "M22 168Q34 92 60 100" },
  { shape: "book", colour: C.blue, x: 596, bottom: 106, size: 52, tilt: 10, eyes: ["happy", "wink"], trailFrom: "M640 170Q628 96 606 102" },
  // Along the ground.
  { shape: "magnifier", colour: C.blue, x: 52, bottom: GROUND, size: 58, squash: 0.1, cheeks: true, land: true },
  { shape: "pencil", colour: C.violet, x: 132, bottom: 322, size: 62, tilt: 14, eyes: ["happy", "wink"], trailFrom: "M92 370Q104 300 126 318" },
  { shape: "calendar", colour: C.orange, x: 226, bottom: GROUND, size: 58, eyes: ["open", "open"], look: [1.4, -2.2], cheeks: true },
  { shape: "star", colour: C.yellow, x: 330, bottom: 300, size: 64, tilt: -14, eyes: ["happy", "wink"], trailFrom: "M278 370Q290 270 322 296", sparkles: true },
  { shape: "envelope", colour: C.green, x: 428, bottom: 338, size: 60, tilt: 8, cheeks: true, trailFrom: "M392 370Q400 322 420 334" },
  { shape: "palette", colour: C.violet, x: 520, bottom: GROUND, size: 56, squash: 0.08, eyes: ["open", "open"], look: [-1.6, -2], land: true },
  { shape: "chart", colour: C.green, x: 608, bottom: 326, size: 54, tilt: -10, eyes: ["wink", "happy"], cheeks: true, trailFrom: "M650 370Q640 316 616 322" },
];

function svg() {
  const parts = [];
  // Ground: a soft floor the bottom row stands on.
  parts.push(`<rect width="${W}" height="${H}" fill="url(#ground)"/>`);
  parts.push(`<path d="M0 ${GROUND + 2}H${W}" stroke="#e4e4e0" stroke-width="1"/>`);

  // The way in: a dotted hop from the app to the folder, an arrow at its end.
  parts.push(hop());
  // blvrd, at the top of the hop.
  parts.push(mascot({ shape: "arc", colour: C.accent, x: 330, bottom: 99, size: 50, tilt: 8, eyes: ["happy", "happy"], cheeks: true }));
  parts.push(sparkle(294, 62, 6, C.yellow), sparkle(366, 56, 4.5, C.accent), sparkle(374, 80, 3, C.yellow));

  for (const m of crowd) {
    const height = GROUND - m.bottom;
    if (m.trailFrom) parts.push(trail(m.trailFrom));
    if (m.bottom > 200) parts.push(shadow(m.x, m.size, height));
    if (m.land) parts.push(puff(m.x));
    parts.push(mascot(m));
    if (m.sparkles) parts.push(sparkle(m.x - 40, m.bottom - 64, 6, C.yellow), sparkle(m.x + 38, m.bottom - 54, 4.5, C.orange), sparkle(m.x + 30, m.bottom - 82, 3.2, C.yellow));
  }

  parts.push(
    `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-family="'Times New Roman', Times, serif" font-size="13" fill="#8e8e8a">Drag blvrd onto Applications</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="0.72" stop-color="#fbfbfa"/>
    <stop offset="1" stop-color="#f3f3f1"/>
  </linearGradient>
</defs>
${parts.join("\n")}
</svg>
`;
}

const art = svg();
writeFileSync(join(here, "background.svg"), art);

// The caption is set in Times New Roman, on every Mac (and Windows).
await draw(
  [[1, "background.png"], [2, "background@2x.png"]].map(([scale, name]) => ({ html: art, width: W, height: H, scale, path: join(here, name) })),
);
// One file, both sizes: Finder picks the sharp one on a Retina screen.
execFileSync("tiffutil", ["-cathidpicheck", join(here, "background.png"), join(here, "background@2x.png"), "-out", join(here, "background.tiff")]);
console.log("wrote background.svg, .png, @2x.png and .tiff");
