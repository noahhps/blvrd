/* Small preferences that follow the reader across the whole app.
 *
 * `toolsOpen`: whether a tool call -- or a chain of calls made back to back
 * -- is drawn expanded. Collapsed to begin with; after that it is whatever
 * the reader last left one as -- open one and the next one arrives open,
 * close one and the next arrives closed.
 * One value for every agent's chat, kept between launches. A tool call
 * already on screen keeps the state it was drawn with, so expanding one does
 * not throw open every other one in the thread. */

const KEY = "blvrd.tools-open";

let toolsOpen = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

export function getToolsOpen() {
  return toolsOpen;
}

export function setToolsOpen(open) {
  toolsOpen = Boolean(open);
  try {
    localStorage.setItem(KEY, toolsOpen ? "1" : "0");
  } catch {
    // Not remembered between launches, but still followed for this one.
  }
}
