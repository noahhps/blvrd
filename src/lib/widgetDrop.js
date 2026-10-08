import { useSyncExternalStore } from "react";

/* Dragging a widget between the Notebook page and the sidebar: what's being
 * carried, where it would land, and which widget just arrived (so only that
 * one plays its arrival). Shared by the page (components/NotebookView.jsx),
 * the sidebar (components/widgets/index.jsx) and the chip that follows the
 * pointer (components/DragChip.jsx). */

let state = { chip: null, sidebarAt: null, removing: false, arrived: null };
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export const widgetDrop = {
  get: () => state,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set,
  clear: () => set({ chip: null, sidebarAt: null, removing: false }),
};

export const useWidgetDrop = () => useSyncExternalStore(widgetDrop.subscribe, widgetDrop.get);

const within = (el, { x, y }) => {
  const box = el?.getBoundingClientRect();
  return Boolean(box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
};

/** Where in the sidebar a widget dropped at `point` would go (its index among
 *  the widgets there), or null when the point isn't over the sidebar. */
export function sidebarIndexAt(point) {
  if (!within(document.querySelector(".side"), point)) return null;
  const slots = [...document.querySelectorAll(".widgets > .widget-slot")];
  return slots.filter((el) => {
    const box = el.getBoundingClientRect();
    return point.y > box.top + box.height / 2;
  }).length;
}

/** Whether `point` is over the main area (off the sidebar). */
export const overMain = (point) => within(document.querySelector(".main"), point);

/** Whether `point` has left the element `el` (so the chip should show). */
export const outside = (el, point) => !within(el, point);
