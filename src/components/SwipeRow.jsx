import { useEffect, useRef, useState } from "react";

import { OPEN, THRESHOLD, resist, settleTo, spring, springFor, unresist } from "../lib/swipe.js";

/* A sidebar row that swipes. Right to compact -- done on letting go. Left to
 * delete -- but the swipe only opens the row: it stays out, showing a Delete
 * button, and deleting is that click. Letting go midway, swiping it back,
 * clicking the row or anywhere else, or Escape, puts it back.
 *
 * It moves the way a physical thing would (Apple's "Designing Fluid
 * Interfaces"):
 *   - It follows the fingers 1:1 -- a two-finger swipe on a trackpad
 *     (horizontal wheel) or a drag with the pointer -- from wherever it is
 *     on screen, so it can be caught mid-flight.
 *   - Letting go hands the gesture's speed to a spring, so there's no seam
 *     between the drag and the settle.
 *   - Where it settles comes from where the gesture was *going*: the release
 *     point projected forward by its velocity. A quick flick is enough;
 *     flicking back toward the middle closes it.
 *   - Past its reach it rubber-bands, resisting more the further it goes.
 *   - What letting go will do is shown underneath, growing as it slides,
 *     with a small pop once it would happen.
 * A drag never counts as a click on the row. The numbers are in lib/swipe.js. */

const SETTLE = 120; // ms with no wheel events: the fingers (and their momentum) have stopped

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* Run a spring (lib/swipe.js) from `from` to `to` on the display's frames.
   Returns its stop. */
function springTo(from, to, velocity, options, onFrame, onDone) {
  const motion = spring(from - to, velocity, options);
  let last = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    const { x, done } = motion.advance((now - last) / 1000);
    last = now;
    onFrame(to + x);
    if (done) return onDone();
    frame = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(frame);
}

/* Leaving, once a conversation is deleted: the row carries on off to the
   left -- the way a delete swipe points -- then the gap it leaves closes, so
   the rows below glide up rather than jump. Overlapped, about 320ms in all.
   With reduced motion it only fades; the rows below then simply move up. */
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// A window that isn't on screen doesn't run its animations; the delete
// mustn't wait for one that never plays.
const atMost = (ms, ...animations) =>
  Promise.race([Promise.all(animations.map((a) => a.finished)), new Promise((done) => setTimeout(done, ms))]);

async function leave(rowEl, topEl, from) {
  if (reducedMotion()) {
    await atMost(400, rowEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: token("--ease-out"), fill: "forwards" }));
    return;
  }
  const out = topEl.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: "translate3d(-100%, 0, 0)" }], {
    duration: 200,
    easing: token("--ease-out"),
    fill: "forwards",
  });
  // The gap closes as the row clears it. Height, as for an accordion: the
  // rows below have to come up, and no transform moves them.
  rowEl.style.overflow = "hidden";
  const close = rowEl.animate(
    [
      { height: `${rowEl.offsetHeight}px`, opacity: 1 },
      { height: "0px", opacity: 0 },
    ],
    { duration: 220, delay: 100, easing: token("--ease-in-out"), fill: "forwards" },
  );
  await atMost(600, out, close);
}

export function SwipeRow({ onLeft, onRight, rightDisabled = false, removing = false, children, ...li }) {
  const row = useRef(null);
  const top = useRef(null);
  const [side, setSide] = useState(null); // "left" | "right" | null: which action shows
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false); // out to the left, Delete showing
  const gone = useRef(false); // leaving: no more gestures, and onLeft once

  // The live, on-screen state -- read and written every frame, so not React state.
  const live = useRef({ x: 0, raw: 0, open: false, history: [], stopSpring: null, quietUntil: 0 });
  const drag = useRef(null); // { x, y, from, on, id }
  const settle = useRef(null);
  const handlers = useRef({});
  handlers.current = { onLeft, onRight, rightDisabled };

  const width = () => row.current?.offsetWidth || 260;

  const paint = (x) => {
    live.current.x = x;
    if (top.current) top.current.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    row.current?.style.setProperty("--progress", Math.min(1, Math.abs(x) / THRESHOLD).toFixed(3));
    const nextSide = x < -0.5 ? "left" : x > 0.5 ? "right" : null;
    setSide(nextSide);
    setArmed(nextSide === "left" ? x <= -THRESHOLD : nextSide === "right" ? x >= THRESHOLD && !handlers.current.rightDisabled : false);
  };

  // To rest (0) or open (-OPEN), from wherever it is, at speed `v`.
  const settleAt = (to, v = 0) => {
    const s = live.current;
    s.stopSpring?.();
    if (reducedMotion()) {
      s.stopSpring = null;
      paint(to);
    } else {
      s.stopSpring = springTo(s.x, to, v, springFor(v), paint, () => (s.stopSpring = null));
    }
  };

  const setOpenTo = (value) => {
    live.current.open = value;
    setOpen(value);
  };

  const close = () => {
    setOpenTo(false);
    settleAt(0);
  };

  // Where the fingers are: raw travel, shown through the rubber band. The
  // last 100ms of positions give the velocity at release.
  const follow = (raw) => {
    const s = live.current;
    s.raw = raw;
    paint(resist(raw, width()));
    const now = performance.now();
    s.history.push({ t: now, x: s.x });
    while (s.history.length > 2 && now - s.history[0].t > 100) s.history.shift();
  };

  // The speed at letting go. Fingers that rested before lifting have none,
  // however fast they moved before that.
  const velocity = () => {
    const h = live.current.history;
    if (h.length < 2) return 0;
    const a = h[0];
    const b = h[h.length - 1];
    if (performance.now() - b.t > 60) return 0;
    const dt = Math.max(0.016, (b.t - a.t) / 1000); // a burst of events in one frame isn't infinite speed
    return (b.x - a.x) / dt;
  };

  // The start of every gesture: stop any spring where it is, and carry on
  // from where the row is on screen -- never from where an earlier gesture
  // left the fingers, which would jump it there on the first frame.
  const grab = () => {
    const s = live.current;
    s.stopSpring?.();
    s.stopSpring = null;
    s.raw = unresist(s.x, width());
    s.history = [];
  };

  const release = () => {
    settle.current = null;
    const s = live.current;
    const v = velocity();
    s.history = [];
    const where = settleTo(s.x, v, { open: s.open, rightDisabled: handlers.current.rightDisabled });
    setOpenTo(where === "open");
    settleAt(where === "open" ? -OPEN : 0, v);
    if (where === "right") {
      s.quietUntil = Date.now() + 600; // a trackpad's leftover momentum mustn't swipe again
      setTimeout(handlers.current.onRight, 0);
    }
  };

  // The trackpad. Not passive, so a sideways swipe doesn't also scroll.
  useEffect(() => {
    const el = row.current;
    const wheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (gone.current) return;
      const s = live.current;
      if (Date.now() < s.quietUntil) return;
      // No swipe under way: this event starts one.
      if (!settle.current) grab();
      follow(s.raw - e.deltaX);
      clearTimeout(settle.current);
      settle.current = setTimeout(release, SETTLE);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      clearTimeout(settle.current);
      live.current.stopSpring?.();
    };
  }, []);

  // Deleting -- from its Delete button, or from elsewhere (`removing`, e.g.
  // the sidebar's menu): the row leaves, then the conversation goes.
  const remove = async () => {
    if (gone.current) return;
    gone.current = true;
    const s = live.current;
    s.stopSpring?.();
    s.stopSpring = null;
    clearTimeout(settle.current);
    try {
      await leave(row.current, top.current, s.x);
    } finally {
      handlers.current.onLeft();
    }
  };
  useEffect(() => {
    if (removing) remove();
  }, [removing]);

  // While open: a press anywhere else, or Escape, puts it back.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!row.current?.contains(e.target)) close();
    };
    const key = (e) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // Keep the drag when the pointer leaves the row. A pointer that has
  // already gone can't be captured; the drag goes on without it.
  const capture = (id) => {
    try {
      row.current.setPointerCapture?.(id);
    } catch {
      // released already
    }
  };

  // The click that ends a drag is the drag's, not the row's.
  const swallowNextClick = () => {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    row.current.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => row.current?.removeEventListener("click", swallow, { capture: true }), 0);
  };

  const pointer = {
    onPointerDown: (e) => {
      if (gone.current || e.button !== 0 || e.target.closest(".swipe-delete")) return;
      // Caught mid-spring, it stops under the pointer, where it is.
      const moving = Boolean(live.current.stopSpring);
      grab();
      drag.current = { x: e.clientX, y: e.clientY, from: live.current.raw, on: moving, id: e.pointerId };
      if (moving) capture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.on) {
        // A drag once it is clearly sideways; up and down is the list scrolling.
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
        d.on = true;
        d.x = e.clientX; // tracking starts here, so the row doesn't jump the 10px
        capture(d.id);
        return;
      }
      follow(d.from + dx);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (d?.on) {
        swallowNextClick();
        release();
      } else if (d && live.current.open) {
        // A click on an open row closes it rather than opening its chat.
        swallowNextClick();
        close();
      }
    },
    onPointerCancel: () => {
      if (drag.current?.on) release();
      drag.current = null;
    },
  };

  return (
    <li {...li} ref={row} className="swipe" data-leaving={removing ? "" : undefined} data-swiping={side || undefined} data-armed={armed ? "" : undefined} data-open={open ? "" : undefined} {...pointer}>
      <div className="swipe-under">
        <span className="swipe-compact" aria-hidden="true">
          {rightDisabled ? "Nothing to compact" : "Compact"}
        </span>
        <button
          type="button"
          className="swipe-delete"
          tabIndex={open ? 0 : -1}
          aria-hidden={open ? undefined : "true"}
          onClick={remove}
        >
          Delete
        </button>
      </div>
      <div className="swipe-top" ref={top}>
        {children}
      </div>
    </li>
  );
}
