/* The app icons the reader can pick from in Settings (Appearance → App icon):
 * blvrd's own -- the wordmark, with the arch peeking up from the bottom edge,
 * eyes on the name -- with any of the characters in the arch's place, each
 * in a light and a dark version.
 *
 *   node src-tauri/icons/variants.mjs
 *
 * writes variants/<mascot>-<light|dark>.png (512px, the Dock's largest) for
 * src-tauri/src/icon.rs, which sets the Dock icon from them while blvrd runs,
 * and the list of them, variants/index.json, which lib/appIcon.js mirrors.
 * The tile follows Apple's grid: 824 of 1024, corners about 22%.
 *
 * It also writes app-icon.png, blvrd's own light one at 1024px: the icon the
 * app is built with. After changing it, make the bundle's icons from it --
 *
 *   npx tauri icon src-tauri/icons/app-icon.png -o <a scratch folder>
 *
 * -- and copy 32x32.png, 128x128.png, 128x128@2x.png, icon.icns, icon.ico
 * and icon.png from there into src-tauri/icons (the rest it makes are for
 * Windows' store and phones). */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { draw } from "../art/draw.mjs";
import { C, SHAPES, mascot } from "../art/mascots.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "variants");
mkdirSync(here, { recursive: true });

// The characters, in the order Settings shows them; the first is blvrd's own.
export const ICONS = [
  // blvrd's arch in the app's own blue (styles/app.css --accent), light and dark.
  { id: "arc", label: "blvrd", colour: { light: "#007cff", dark: "#3392ff" } },
  { id: "heart", label: "Heart", colour: "#ef5a7e" },
  { id: "star", label: "Star", colour: C.yellow },
  { id: "magnifier", label: "Magnifier", colour: C.blue },
  { id: "pencil", label: "Pencil", colour: C.violet },
  { id: "book", label: "Book", colour: C.green },
  { id: "palette", label: "Palette", colour: C.orange },
  // White paper in both: on the light tile, drawn round with an outline.
  { id: "envelope", label: "Envelope", colour: "#fbfbfa", paper: true },
];

const LOOKS = {
  light: { top: "#ffffff", bottom: "#f3f3f1", rim: "rgba(0,0,0,0.07)", word: "#141414", ink: "#141414" },
  dark: { top: "#2a2a2a", bottom: "#121212", rim: "rgba(255,255,255,0.09)", word: "#f2f2f0", ink: "#f2f2f0" },
};

// How far each shape reaches across its square, so each fills the tile
// about as much as the arch (a pencil is narrow, a palette wide).
const WIDTH = { arc: 70, heart: 64, star: 68, magnifier: 66, pencil: 32, book: 52, palette: 72, envelope: 66 };
// And where its top is, so each starts just under the name, as the arch does.
const TOP = { arc: 14, heart: 26, star: 18, magnifier: 19, pencil: 16, book: 22, palette: 18, envelope: 30 };
// By eye, on top of that: a round one floats unless it sits down into the edge.
const ON_OUTLINE = new Set(["book", "palette"]);
const LOWER = { magnifier: 34, envelope: 56 };

const TILE = { x: 100, y: 100, size: 824, r: 185 };
const TOP_AT = 520; // where every character's top sits, on the canvas: under the name

function icon({ id, colour, paper = false }, look) {
  const l = LOOKS[look];
  const s = SHAPES[id];
  const size = Math.min(760, 540 / (WIDTH[id] / 100));
  // Most go on past the tile's edge: they peek up, the way the arch does.
  const bottom = TOP_AT + (LOWER[id] || 0) + ((s.foot - TOP[id]) / 100) * size;
  const outline = paper && look === "light" ? "#1a1a1a" : null;
  // Centred on its eyes, not on its outline: they're what you look at. (The
  // book and the palette look right on their outlines: their eyes are off to
  // one side of a shape that isn't even.)
  const eyesX = ON_OUTLINE.has(id) ? 50 : s.eyes.reduce((sum, [ex]) => sum + ex, 0) / s.eyes.length;
  const centre = 512 + ((50 - eyesX) / 100) * size;
  const figure = mascot({ shape: id, colour: (typeof colour === "object" ? colour[look] : colour) || l.ink, x: centre, bottom, size, eyes: ["open", "open"], look: [0, -2.4], outline });
  const { x, y, size: t, r } = TILE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.top}"/><stop offset="1" stop-color="${l.bottom}"/></linearGradient>
  <clipPath id="inside"><rect x="${x}" y="${y}" width="${t}" height="${t}" rx="${r}"/></clipPath>
  <filter id="lift" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.22"/></filter>
</defs>
<rect x="${x}" y="${y}" width="${t}" height="${t}" rx="${r}" fill="url(#tile)" filter="url(#lift)"/>
<g clip-path="url(#inside)">
  <text x="512" y="430" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="700" font-size="212" letter-spacing="-7" fill="${l.word}">Blvrd</text>
  ${figure}
</g>
<rect x="${x + 1}" y="${y + 1}" width="${t - 2}" height="${t - 2}" rx="${r - 1}" fill="none" stroke="${l.rim}" stroke-width="2"/>
</svg>`;
}

const shots = [];
for (const entry of ICONS) {
  for (const look of Object.keys(LOOKS)) {
    shots.push({ html: icon(entry, look), width: 512, height: 512, path: join(here, `${entry.id}-${look}.png`), transparent: true });
  }
}
// blvrd's own, light, at full size too: the icon the app is built with
// (made into icon.icns and the rest by `tauri icon`, see the end).
shots.push({ ...shots[0], scale: 2, path: join(here, "..", "app-icon.png") });
await draw(shots);
writeFileSync(join(here, "index.json"), JSON.stringify(ICONS.map(({ id, label }) => ({ id, label })), null, 2) + "\n");

// A contact sheet, to look them over (not bundled).
const byLook = [...shots.filter((s) => s.path.endsWith("-light.png")), ...shots.filter((s) => s.path.endsWith("-dark.png"))];
const sheet = `<div style="display:grid;grid-template-columns:repeat(8,128px);gap:8px;padding:16px;background:#888">${byLook
  .map((s) => `<img src="data:image/svg+xml;base64,${Buffer.from(s.html).toString("base64")}" width="128" height="128">`)
  .join("")}</div>`;
await draw([{ html: sheet, width: 8 * 128 + 7 * 8 + 32, height: 2 * 128 + 8 + 32, path: join(here, "..", "variants-sheet.png") }]);
console.log(`wrote ${shots.length} icons to ${here}`);
