import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/* Reordering a column by dragging, with the column's own motion: the piece in
 * hand follows the pointer exactly, the others slide aside to show where it
 * will land, and on release it settles into that place from wherever it was
 * let go. Nothing in the DOM moves until the drop, so a column that re-renders
 * mid-drag (an answer streaming in) doesn't disturb it.
 *
 *   const { list, handle } = useSortable(ids, onOrder);
 *   <div ref={list}>{ids.map((id) => <section data-sort={id}>
 *     <button {...handle(id)}>…</button> …</section>)}</div>
 *
 * Each child of `list` is one piece (marked data-sort); `handle(id)` goes on
 * what it is picked up by. The arrow keys move it too -- at once, since a key
 * press wants the result, not a show. */

// How far the pointer travels before a press becomes a drag.
const SLOP = 4;

export function moveTo(list, from, to) {
  const out = [...list];
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
}

/* Where the piece at `from` lands with its centre at `centre`: past every
   piece whose middle it has crossed. `boxes` are the pieces' { top, height }
   as they stood when the drag began. */
export function slotFor(boxes, from, centre) {
  let to = from;
  for (let j = from + 1; j < boxes.length; j++) if (centre > boxes[j].top + boxes[j].height / 2) to = j;
  for (let j = from - 1; j >= 0; j--) if (centre < boxes[j].top + boxes[j].height / 2) to = j;
  return to;
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useSortable(ids, onOrder) {
  const list = useRef(null);
  const drag = useRef(null);
  const latest = useRef({ ids, onOrder });
  latest.current = { ids, onOrder };

  const pieces = () => [...list.current.children].filter((el) => el.dataset.sort);

  // Moves every piece but the one in hand to make room at `to`.
  const makeRoom = (d, to) => {
    if (d.to === to) return;
    d.to = to;
    const shift = d.boxes[d.from].height + d.gap;
    d.els.forEach((el, j) => {
      if (j === d.from) return;
      const by = d.from < j && j <= to ? -shift : to <= j && j < d.from ? shift : 0;
      el.style.transform = by ? `translateY(${by}px)` : "";
    });
  };

  // Lets go: the order is committed, then the piece eases from where it was
  // dropped into its new place (or home again, if the drag was called off).
  const finish = (commit) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.started) return;
    removeEventListener("keydown", d.onKey);
    const el = d.els[d.from];
    const before = el.getBoundingClientRect().top;
    const ease = getComputedStyle(el).getPropertyValue("--ease-out").trim();
    if (commit && d.to !== d.from) {
      // The others already stand where the new order puts them, so they are
      // let go without a transition and nothing visibly jumps.
      d.els.forEach((p) => {
        p.style.transition = "none";
        p.style.transform = "";
      });
      flushSync(() => latest.current.onOrder(moveTo(latest.current.ids, d.from, d.to)));
      list.current?.offsetHeight;
      d.els.forEach((p) => (p.style.transition = ""));
    } else {
      // Called off: the others slide back on their own transition.
      d.els.forEach((p) => {
        if (p !== el) p.style.transform = "";
      });
      el.style.transform = "";
    }
    delete el.dataset.dragging;
    delete list.current?.dataset.sorting;
    const by = before - el.getBoundingClientRect().top;
    if (by && !still()) el.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }], { duration: 200, easing: ease || "ease-out" });
  };

  const handle = (id) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || drag.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id, startY: e.clientY, started: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      if (!d.started) {
        if (Math.abs(dy) < SLOP) return;
        const els = pieces();
        const from = els.findIndex((el) => el.dataset.sort === d.id);
        if (from === -1) return;
        const boxes = els.map((el) => el.getBoundingClientRect());
        d.started = true;
        d.els = els;
        d.from = d.to = from;
        d.boxes = boxes;
        d.gap = parseFloat(getComputedStyle(list.current).rowGap) || 0;
        d.onKey = (k) => k.key === "Escape" && finish(false);
        addEventListener("keydown", d.onKey);
        els[from].dataset.dragging = "";
        list.current.dataset.sorting = "";
      }
      // Straight under the pointer: direct manipulation, never eased.
      d.els[d.from].style.transform = `translateY(${dy}px)`;
      const box = d.boxes[d.from];
      makeRoom(d, slotFor(d.boxes, d.from, box.top + box.height / 2 + dy));
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => drag.current?.started && finish(true),
    onKeyDown: (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const { ids: now, onOrder: set } = latest.current;
      const from = now.indexOf(id);
      const to = from + (e.key === "ArrowUp" ? -1 : 1);
      if (from !== -1 && to >= 0 && to < now.length) set(moveTo(now, from, to));
    },
  });

  // A drag cut short by the column going away leaves no listener behind.
  useEffect(() => () => drag.current?.onKey && removeEventListener("keydown", drag.current.onKey), []);

  return { list, handle };
}
