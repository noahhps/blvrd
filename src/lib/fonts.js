/* The faces the reader picked in Settings: one for the app, and three for the
 * Notebook -- the words written on the page, each section's title, and what
 * a widget holds. Kept in the app's state (`fonts`, by id) and shown through
 * CSS variables on html (styles/app.css), in every window. */

import { load } from "./store.js";

// Bundled (public/fonts) or on every Mac; each falls back to the system's own.
export const FONTS = [
  { id: "inter", label: "Inter", group: "Sans serif", stack: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  { id: "system", label: "San Francisco", group: "Sans serif", stack: "system-ui, -apple-system, sans-serif" },
  { id: "rounded", label: "SF Rounded", group: "Sans serif", stack: "ui-rounded, system-ui, sans-serif" },
  { id: "helvetica", label: "Helvetica Neue", group: "Sans serif", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "avenir", label: "Avenir Next", group: "Sans serif", stack: '"Avenir Next", Avenir, system-ui, sans-serif' },
  { id: "gill", label: "Gill Sans", group: "Sans serif", stack: '"Gill Sans", "Gill Sans MT", system-ui, sans-serif' },
  { id: "futura", label: "Futura", group: "Sans serif", stack: "Futura, system-ui, sans-serif" },
  { id: "optima", label: "Optima", group: "Sans serif", stack: "Optima, system-ui, sans-serif" },
  { id: "bricolage", label: "Bricolage Grotesque", group: "Sans serif", stack: '"Bricolage Grotesque", system-ui, sans-serif' },
  { id: "newyork", label: "New York", group: "Serif", stack: 'ui-serif, "New York", Georgia, serif' },
  { id: "charter", label: "Charter", group: "Serif", stack: 'Charter, "Bitstream Charter", Georgia, serif' },
  { id: "iowan", label: "Iowan Old Style", group: "Serif", stack: '"Iowan Old Style", Georgia, serif' },
  { id: "georgia", label: "Georgia", group: "Serif", stack: "Georgia, serif" },
  { id: "palatino", label: "Palatino", group: "Serif", stack: 'Palatino, "Palatino Linotype", Georgia, serif' },
  { id: "baskerville", label: "Baskerville", group: "Serif", stack: 'Baskerville, "Baskerville Old Face", Georgia, serif' },
  { id: "typewriter", label: "American Typewriter", group: "Serif", stack: '"American Typewriter", Courier, serif' },
  { id: "mono", label: "SF Mono", group: "Monospace", stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
  { id: "menlo", label: "Menlo", group: "Monospace", stack: "Menlo, Monaco, ui-monospace, monospace" },
];

// What each is for, and what it is unless picked. "app" in a notebook slot:
// whatever the app is set to. `short`: its name under the Notebook heading.
export const FONT_SLOTS = [
  { id: "app", label: "App", short: "App", hint: "Menus, the sidebar, Settings", fallback: "inter" },
  { id: "text", label: "Notebook text", short: "Text", hint: "Words written on the page, and notes", fallback: "helvetica" },
  { id: "sections", label: "Notebook section titles", short: "Section titles", hint: "The name over each section", fallback: "app" },
  { id: "widgets", label: "Notebook widgets", short: "Widgets", hint: "Facts, lists, and the app’s own widgets", fallback: "app" },
];

const byId = new Map(FONTS.map((f) => [f.id, f]));

/** Each slot's font id: the saved one if it's still offered, else its default. */
export function fontsOf(state) {
  const saved = state?.fonts || {};
  const out = {};
  for (const slot of FONT_SLOTS) {
    const id = saved[slot.id];
    out[slot.id] = byId.has(id) || (id === "app" && slot.id !== "app") ? id : slot.fallback;
  }
  return out;
}

/** The CSS font stack a slot's font stands for. */
export function stackOf(fonts, slot) {
  const id = fonts[slot] === "app" ? fonts.app : fonts[slot];
  return (byId.get(id) || byId.get("inter")).stack;
}

const VARS = { app: "--font", text: "--nb-font-text", sections: "--nb-font-section", widgets: "--nb-font-widget" };

export function applyFonts(fonts) {
  const style = document.documentElement.style;
  for (const [slot, name] of Object.entries(VARS)) style.setProperty(name, stackOf(fonts, slot));
}

/** At start, before the first paint: the saved faces -- and, in the
 *  quickview, any change the main window saves later. */
export function startFonts() {
  applyFonts(fontsOf(load()));
  addEventListener("storage", (e) => {
    if (e.key === null || e.key === "blvrd.v1") applyFonts(fontsOf(load()));
  });
}
