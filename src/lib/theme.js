/* Light or dark: the Mac's own setting ("system", the default), or one the
 * reader picked in Settings. Kept in the app's state (`theme`); shown through
 * html data-theme (styles/app.css), and on the window itself so its buttons
 * and scroll bars match. */

import { useSyncExternalStore } from "react";

import { inDesktop } from "./http.js";
import { load } from "./store.js";

export const THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
export const themeOf = (state) => (THEMES.some((t) => t.id === state?.theme) ? state.theme : "system");

export function applyTheme(theme) {
  const root = document.documentElement;
  const now = root.dataset.theme || "system";
  if (now !== theme) {
    // All at once: without this each button and row fades over at its own
    // pace, and for a moment the app is half one look, half the other.
    root.dataset.themeSwitching = "";
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.offsetHeight; // the new colours, applied with transitions off
    requestAnimationFrame(() => delete root.dataset.themeSwitching);
  }
  if (!inDesktop()) return;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme === "system" ? null : theme))
    .catch(() => {});
}

/** Whether the app looks dark right now: picked so, or following a Mac that
 *  is (and changing with it). */
const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const onSystem = (change) => {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
export function useDark(theme) {
  const system = useSyncExternalStore(onSystem, systemDark, () => false);
  return theme === "dark" || (theme === "system" && system);
}

/** At start, before the first paint: the saved choice -- and, in the
 *  quickview, any change the main window saves later. */
export function startTheme() {
  applyTheme(themeOf(load()));
  addEventListener("storage", (e) => {
    if (e.key === null || e.key === "blvrd.v1") applyTheme(themeOf(load()));
  });
}
