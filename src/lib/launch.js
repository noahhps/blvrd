import { useLayoutEffect } from "react";

/* A message on its way from the composer to the thread. On send, the text's
 * place in the box is noted (launchFrom); when its bubble mounts, the bubble
 * starts exactly there -- the words haven't moved -- and glides into its own
 * place, its background filling in as it lands. So what was typed visibly
 * becomes what was sent, rather than vanishing from one spot and appearing in
 * another.
 *
 * useLaunch runs after the thread's own scroll-to-bottom (declare it after
 * that effect), so the bubble is measured where it will actually rest. */

let pending = null;

export function launchFrom(textarea) {
  if (!textarea) return;
  const box = textarea.getBoundingClientRect();
  const pad = getComputedStyle(textarea);
  pending = { x: box.left + parseFloat(pad.paddingLeft), y: box.top + parseFloat(pad.paddingTop), at: Date.now() };
}

export function useLaunch(thread, count) {
  useLayoutEffect(() => {
    const from = pending;
    pending = null;
    // A send that never landed (refused, or a chat switched away) is dropped.
    if (!from || Date.now() - from.at > 1000 || !thread.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const turns = thread.current.querySelectorAll(".turn.user");
    const turn = turns[turns.length - 1];
    if (!turn) return;
    const bubble = turn.querySelector(".bubble");
    const root = getComputedStyle(document.documentElement);
    const easing = root.getPropertyValue("--ease-out").trim();
    // Line the bubble's text up with where the text sat in the box.
    const target = bubble || turn;
    const at = target.getBoundingClientRect();
    const inset = bubble ? getComputedStyle(bubble) : null;
    const dx = from.x - (at.left + (inset ? parseFloat(inset.paddingLeft) : 0));
    const dy = from.y - (at.top + (inset ? parseFloat(inset.paddingTop) : 0));
    turn.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing });
    if (bubble) {
      const fill = getComputedStyle(bubble).backgroundColor;
      bubble.animate([{ backgroundColor: "transparent" }, { backgroundColor: fill }], { duration: 260, easing });
    }
  }, [count]);
}
