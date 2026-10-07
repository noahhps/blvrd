/* The quickview: a box that comes up over any app on a shortcut, where you @
 * an agent and write to it. It is its own window ("quick", index.html#quick);
 * the main window holds the shortcut and does the sending, so a message from
 * the quickview lands in the agent's chat like any other.
 *
 * The shortcut is kept in the app's state (`quickShortcut`) in the form the
 * global-shortcut plugin reads -- "Alt+Space", "Super+Shift+KeyK" -- with
 * `null` for off. fn can't be part of it: macOS doesn't offer fn to app
 * shortcuts at all. */

import { inDesktop } from "./http.js";

export const DEFAULT_SHORTCUT = "Alt+Space";
export const shortcutOf = (state) => (state.quickShortcut === undefined ? DEFAULT_SHORTCUT : state.quickShortcut);

// Events between the windows.
export const QUICK_OPEN = "quick-open"; // main -> quick: you've been shown
export const QUICK_SEND = "quick-send"; // quick -> main: { agentId, text }

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const GLYPHS = MAC ? { Super: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧" } : { Super: "Win", Control: "Ctrl", Alt: "Alt", Shift: "Shift" };
const ORDER = ["Control", "Alt", "Shift", "Super"];

/** A key press as a shortcut, or null while it is only modifiers -- or with
 *  none, since a bare letter would fire whenever you typed it. F-keys stand
 *  alone. */
export function shortcutFromKey(e) {
  if (["Shift", "Control", "Alt", "Meta", "Fn", "FnLock", "CapsLock"].includes(e.key)) return null;
  const mods = ORDER.filter((m) => (m === "Super" ? e.metaKey : e[`${m.toLowerCase()}Key`]));
  if (!mods.length && !/^F\d+$/.test(e.code)) return null;
  return [...mods, e.code].join("+");
}

/** "Alt+Space" as it reads on the keyboard: "⌥ Space". */
export function shortcutLabel(shortcut) {
  if (!shortcut) return "Off";
  const parts = shortcut.split("+").map((part) => GLYPHS[part] || part.replace(/^(Key|Digit|Arrow)/, ""));
  if (!MAC) return parts.join("+");
  const key = parts.pop();
  return parts.join("") + (parts.length && key.length > 1 ? " " : "") + key;
}

// Register and unregister one after another: a cleanup's unregister must land
// before the next register, or the next one finds the key still taken.
let chain = Promise.resolve();
const serially = (fn) => (chain = chain.then(fn, fn));

/** Hold `shortcut` for as long as the main window lives; it calls `onPress`.
 *  Resolves to a reason when the shortcut couldn't be had, else null. Returns
 *  the release. */
export function holdShortcut(shortcut, onPress, onProblem) {
  if (!inDesktop() || !shortcut) return () => {};
  let held = false;
  serially(async () => {
    const { register, unregister, isRegistered } = await import("@tauri-apps/plugin-global-shortcut");
    try {
      // Left over from before a reload of this window: the page that held it is gone.
      if (await isRegistered(shortcut)) await unregister(shortcut);
      await register(shortcut, (event) => {
        if (event.state === "Pressed") onPress();
      });
      held = true;
      onProblem(null);
    } catch (problem) {
      onProblem(String(problem?.message || problem));
    }
  });
  return () =>
    serially(async () => {
      if (!held) return;
      const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
      await unregister(shortcut).catch(() => {});
    });
}

/** Show the quickview, or put it away if it is up. */
export async function toggleQuick() {
  const { Window } = await import("@tauri-apps/api/window");
  const { emitTo } = await import("@tauri-apps/api/event");
  const quick = await Window.getByLabel("quick");
  if (!quick) return;
  if (await quick.isVisible()) return quick.hide();
  await quick.show();
  await quick.setFocus();
  await emitTo("quick", QUICK_OPEN);
}

/** Bring the main window forward -- the quickview handing it a message. */
export async function showMain() {
  const { Window } = await import("@tauri-apps/api/window");
  const main = await Window.getByLabel("main");
  if (!main) return;
  await main.unminimize();
  await main.show();
  await main.setFocus();
}
