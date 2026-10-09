/* The app icon: a character and a look, picked in Settings (Appearance) and
 * kept in the app's state (`appIcon`). The Dock shows it while blvrd runs
 * (src-tauri/src/icon.rs, from the pictures icons/variants.mjs draws -- the
 * same characters and colours as ICONS here). blvrd's own arch, light, is the
 * icon the app was built with. */

import { invoke } from "./desktop.js";
import { inDesktop } from "./http.js";

export const ICONS = [
  { id: "arc", label: "blvrd", colour: { light: "#007cff", dark: "#3392ff" } }, // the app's blue
  { id: "heart", label: "Heart", colour: "#ef5a7e" },
  { id: "star", label: "Star", colour: "#e3b21f" },
  { id: "magnifier", label: "Magnifier", colour: "#3a7bdc" },
  { id: "pencil", label: "Pencil", colour: "#8758d6" },
  { id: "book", label: "Book", colour: "#33a061" },
  { id: "palette", label: "Palette", colour: "#ef8a2b" },
  { id: "envelope", label: "Envelope", colour: "#fbfbfa" },
];

/* Where each character sits on its icon, for the small copies in Settings:
 * icons/variants.mjs's numbers, on a tile `tile` px across. Its width across
 * its square, where its top is, how much lower it was put by eye, and the
 * middle of its eyes -- which go in the middle of the tile. */
const FIT = {
  arc: [70, 14, 0, 50],
  heart: [64, 26, 0, 50],
  star: [68, 18, 0, 50],
  magnifier: [66, 19, 34, 46],
  pencil: [32, 16, 0, 50],
  book: [52, 22, 0, 50], // on its outline, as the palette: eyes off to one side
  palette: [72, 18, 0, 50],
  envelope: [66, 30, 56, 50],
};
/** { size, top, shift }: its square's size and top on the tile, and how far
 *  right of centre the square goes so its eyes are centred. */
export function figureOn(id, tile) {
  const [width, top, lower, eyesX] = FIT[id] || FIT.arc;
  const k = tile / 824; // the tile is 824 of the icon's 1024
  const size = Math.min(760, 540 / (width / 100));
  return { size: size * k, top: (420 + lower - (top / 100) * size) * k, shift: ((50 - eyesX) / 100) * size * k };
}

export const ICON_LOOKS = [
  { id: "auto", label: "Match" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** { mascot, look } as saved, or blvrd's own, light. */
export function appIconOf(state) {
  const saved = state?.appIcon || {};
  return {
    mascot: ICONS.some((i) => i.id === saved.mascot) ? saved.mascot : "arc",
    look: ICON_LOOKS.some((l) => l.id === saved.look) ? saved.look : "light",
  };
}

/** light or dark, once "Match" has been decided by how the app looks now. */
export const lookOf = (icon, dark) => (icon.look === "auto" ? (dark ? "dark" : "light") : icon.look);

/** The picture to show: "default" for the one blvrd was built with. */
export function iconName(icon, dark) {
  const look = lookOf(icon, dark);
  return icon.mascot === "arc" && look === "light" ? "default" : `${icon.mascot}-${look}`;
}

let shown = "default";
/** The Dock's icon, if it isn't already this one. */
export function applyAppIcon(name) {
  if (!inDesktop() || name === shown) return;
  shown = name;
  invoke("app_icon", { name }, "The app icon").catch(() => (shown = null));
}
