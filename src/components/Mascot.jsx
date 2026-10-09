import { useCallback, useEffect, useRef } from "react";

import { PESTER_MS, pokeReaction } from "../lib/poke.js";

/* An agent's character, after Cue's: a flat shape that says what the agent
 * does -- a magnifier, a pencil, a calendar -- in the agent's colour, with a
 * pair of googly eyes (lib/agents.js lists the shapes).
 *
 * The eyes move the way eyes do. They don't glide: they jump (a saccade,
 * ~60-100ms, decelerating) and hold (a fixation, a fraction of a second to a
 * few seconds), and they blink at irregular intervals, often on a big jump.
 * After a long look to one side the body leans after it. Timing is random
 * per character, so a sidebar of them never moves in step. That part is
 * WAAPI (the targets are picked at run time); the body's moods are CSS
 * (styles/mascot.css).
 *
 *   still      at rest: the odd blink and glance, nothing else
 *   idle       looking about
 *   listening  looking down at what you're writing
 *   thinking   reading: hops along a line, a sweep back to the next
 *   speaking   looking at you, a little bob
 *   asking     eyes wide, looking at you, a hop now and then for attention
 *   done       a hop and a wink
 *   error      a shake, eyes down
 *
 * `alive` off keeps the eyes where they are -- for small copies in long
 * lists, where a hundred blinking faces would be noise. `follow` has the
 * eyes follow the pointer while the character is at rest -- smooth pursuit,
 * not saccades, the way eyes track something moving -- and go back to
 * looking about once the pointer has been still a few seconds or left the
 * window. `poke` (its label, "Poke Researcher") makes it a button that
 * reacts when clicked -- and once in ten thousand pokes, does a backflip
 * (lib/poke.js). `tick` changes with
 * each keystroke while listening, and each one gets a little give.
 *
 * blvrd itself is one of them: the arch, a red archway on legs, the way a
 * boulevard's arch stands (shape "arc"). It is the app's mark, and any agent
 * may wear it too. */

export const MASCOT_MOODS = ["still", "idle", "listening", "thinking", "speaking", "asking", "done", "error"];

const EO = "cubic-bezier(0.23, 1, 0.32, 1)";
const EIO = "cubic-bezier(0.77, 0, 0.175, 1)";

// Shapes, drawn in a 100-unit square. `eyes` are the two eye centres;
// `wink` draws the right one as a wink at rest, as Cue's mark does.
const SHAPES = {
  // blvrd: an archway on two flat feet, eyes on its crown. Stroked in its
  // own colour with round joins, which softens the corners and nothing else.
  arc: {
    eyes: [[41, 29], [59, 29]],
    art: <path className="m-body m-round" d="M15 85V52A35 35 0 0 1 85 52V85H64V52A14 14 0 0 0 36 52V85Z" />,
  },
  magnifier: {
    eyes: [[38, 44], [54, 44]],
    art: (
      <>
        <path className="m-handle" d="M64 64L81 81" />
        <circle className="m-body" cx="46" cy="46" r="27" />
      </>
    ),
  },
  pencil: {
    eyes: [[43, 52], [57, 52]],
    art: (
      <>
        <path className="m-wood" d="M34 70L50 90L66 70Z" />
        <path className="m-lead" d="M45 84L50 90L55 84Z" />
        <rect className="m-body" x="34" y="34" width="32" height="37" />
        {/* The band over the eraser's foot, holding it on. */}
        <rect className="m-eraser" x="34" y="16" width="32" height="16" rx="6" />
        <rect className="m-metal" x="34" y="30" width="32" height="6" />
      </>
    ),
  },
  book: {
    eyes: [[48, 46], [62, 46]],
    art: (
      <>
        <rect className="m-body" x="24" y="22" width="52" height="60" rx="6" />
        <rect className="m-dark" x="24" y="22" width="10" height="60" rx="4" />
        <rect className="m-paper" x="34" y="74" width="42" height="5" />
      </>
    ),
  },
  calendar: {
    eyes: [[42, 59], [58, 59]],
    art: (
      <>
        <rect className="m-dark" x="35" y="18" width="5" height="14" rx="2.5" />
        <rect className="m-dark" x="60" y="18" width="5" height="14" rx="2.5" />
        <rect className="m-body" x="22" y="25" width="56" height="56" rx="9" />
        <path className="m-dark" d="M22 34a9 9 0 0 1 9-9h38a9 9 0 0 1 9 9v8H22Z" />
      </>
    ),
  },
  envelope: {
    wink: true,
    eyes: [[40, 54], [60, 54]], // either side of the fold's point
    art: (
      <>
        <rect className="m-body" x="17" y="30" width="66" height="48" rx="7" />
        <path className="m-fold" d="M20 34L50 57L80 34" />
      </>
    ),
  },
  phone: {
    eyes: [[42, 50], [58, 50]],
    art: (
      <>
        <rect className="m-body" x="28" y="16" width="44" height="70" rx="12" />
        <rect className="m-dark" x="43" y="22" width="14" height="3.5" rx="1.75" />
      </>
    ),
  },
  laptop: {
    eyes: [[42, 42], [58, 42]],
    art: (
      <>
        <rect className="m-body" x="22" y="18" width="56" height="46" rx="7" />
        <path className="m-dark" d="M16 66H84L88 76a3 3 0 0 1-3 4H15a3 3 0 0 1-3-4Z" />
      </>
    ),
  },
  chart: {
    eyes: [[40, 38], [60, 38]],
    art: (
      <>
        <rect className="m-body" x="20" y="20" width="60" height="60" rx="11" />
        <rect className="m-paper" x="29" y="61" width="9" height="11" rx="2" />
        <rect className="m-paper" x="45.5" y="55" width="9" height="17" rx="2" />
        <rect className="m-paper" x="62" y="50" width="9" height="22" rx="2" />
      </>
    ),
  },
  palette: {
    eyes: [[46, 38], [62, 38]],
    art: (
      <>
        <path className="m-body" d="M50 18C72 18 86 32 86 50C86 62 78 66 70 64C63 62 58 66 60 73C62 80 57 84 50 84C30 84 14 70 14 50C14 32 30 18 50 18Z" />
        <circle className="m-paint1" cx="27" cy="48" r="5" />
        <circle className="m-paint2" cx="34" cy="64" r="5" />
        <circle className="m-paint3" cx="48" cy="73" r="4.5" />
      </>
    ),
  },
  briefcase: {
    eyes: [[40, 58], [60, 58]],
    art: (
      <>
        <path className="m-handle-thin" d="M38 34V27a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v7" />
        <rect className="m-body" x="16" y="33" width="68" height="48" rx="8" />
        <rect className="m-dark" x="16" y="46" width="68" height="4" />
      </>
    ),
  },
  heart: {
    eyes: [[40, 48], [60, 48]],
    art: <path className="m-body" d="M50 84C35 74 18 63 18 45C18 34 27 26 37 26C43 26 47.5 29 50 34C52.5 29 57 26 63 26C73 26 82 34 82 45C82 63 65 74 50 84Z" />,
  },
  star: {
    wink: true,
    eyes: [[43, 54], [57, 54]],
    art: <path className="m-body m-round" d={star(50, 55, 34, 16)} />,
  },
  drop: {
    eyes: [[43, 62], [57, 62]],
    art: <path className="m-body" d="M50 16C50 16 76 45 76 63C76 77 64 86 50 86C36 86 24 77 24 63C24 45 50 16 50 16Z" />,
  },
  circle: {
    eyes: [[42, 48], [58, 48]],
    art: <circle className="m-body" cx="50" cy="52" r="31" />,
  },
};

function star(cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (-90 + i * 36) * (Math.PI / 180);
    points.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${points.join("L")}Z`;
}

export function Mascot({ shape = "circle", colour = "var(--ink)", size = 28, mood = "still", alive = true, follow = false, poke = null, tick = 0, label = null, className = "" }) {
  const ref = useRef(null);
  const s = SHAPES[shape] || SHAPES.circle;
  // While a poke plays, the eyes' own life waits; `eyes` lets the poke steer them.
  const busy = useRef(0);
  const eyes = useRef(null);
  useEyes(ref, mood, alive, follow, busy, eyes, s.eyes);
  useGive(ref, tick);
  const onPoke = usePoke(ref, busy, eyes);

  return (
    <svg
      ref={ref}
      className={`mascot ${className}`.trim()}
      data-mood={mood}
      data-wink={s.wink ? "" : undefined}
      data-pokeable={poke ? "" : undefined}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ "--c": colour }}
      role={poke ? "button" : label ? "img" : undefined}
      tabIndex={poke ? 0 : undefined}
      aria-label={poke || label || undefined}
      aria-hidden={poke || label ? undefined : "true"}
      onClick={poke ? onPoke : undefined}
      onKeyDown={
        poke
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPoke();
              }
            }
          : undefined
      }
    >
      <g className="m-whole">
        <g className="m-give">
        <g className="m-flip">
        <g className="m-lean">
          {s.art}
          {s.eyes.map(([x, y], i) => (
            <g key={i} className={i ? "m-eye m-eye-r" : "m-eye"} transform={`translate(${x} ${y})`}>
              <g className="m-wide">
                <g className="m-lid">
                  <ellipse className="m-white" rx="6.4" ry="7.4" />
                  <g className="m-look">
                    <circle className="m-pupil" cy="1.8" r="3.6" />
                  </g>
                </g>
              </g>
              <path className="m-wink" d="M3 -5L-3 0L3 5" />
            </g>
          ))}
        </g>
        </g>
        </g>
      </g>
    </svg>
  );
}

/* One keystroke's give: a quick squash that springs back. */
function useGive(ref, tick) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current?.querySelector(".m-give");
    if (!el?.animate || reduced()) return;
    el.animate([{ transform: "scale(1.02, 0.93)" }, { transform: "scale(1, 1)" }], { duration: 220, easing: EO });
  }, [ref, tick]);
}

/* Poked: one of a few short reactions, never the same twice running; a
 * huff when pestered; once in ten thousand, a backflip and dizzy eyes
 * (lib/poke.js). A new poke interrupts the last. Squash and stretch on
 * .m-give (pivoting on its feet), spins on .m-flip (pivoting on its middle),
 * eyes on the lids, whites and pupils. With motion unwanted, a blink. */
const FRAMES = {
  boop: ({ give, lids }) => {
    give.animate(
      [
        { transform: "scale(1, 1)", easing: EO },
        { transform: "scale(1.12, 0.84)", offset: 0.22, easing: EIO },
        { transform: "scale(0.95, 1.07)", offset: 0.55, easing: EIO },
        { transform: "scale(1.02, 0.98)", offset: 0.8, easing: EIO },
        { transform: "scale(1, 1)" },
      ],
      { duration: 480 },
    );
    for (const el of lids)
      el.animate(
        [{ transform: "scaleY(1)" }, { transform: "scaleY(0.12)", offset: 0.15 }, { transform: "scaleY(0.12)", offset: 0.6 }, { transform: "scaleY(1)" }],
        { duration: 480, easing: EO },
      );
    return 480;
  },
  hop: ({ give, wides, eyes }) => {
    give.animate(
      [
        { transform: "translateY(0) scale(1, 1)", easing: EO },
        { transform: "translateY(0) scale(1.08, 0.9)", offset: 0.12, easing: EO },
        { transform: "translateY(-16%) scale(0.94, 1.08)", offset: 0.38, easing: EIO },
        { transform: "translateY(0) scale(1.06, 0.92)", offset: 0.72, easing: EO },
        { transform: "translateY(0) scale(1, 1)" },
      ],
      { duration: 560 },
    );
    for (const el of wides)
      el.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.3)", offset: 0.25 }, { transform: "scale(1.3)", offset: 0.6 }, { transform: "scale(1)" }],
        { duration: 560, easing: EO },
      );
    eyes?.look(0, -3.4, 60);
    return 560;
  },
  giggle: ({ give, flip, lids }) => {
    flip.animate(
      [
        { transform: "rotate(0deg)", easing: EIO },
        { transform: "rotate(-9deg)", offset: 0.15, easing: EIO },
        { transform: "rotate(8deg)", offset: 0.35, easing: EIO },
        { transform: "rotate(-6deg)", offset: 0.55, easing: EIO },
        { transform: "rotate(4deg)", offset: 0.75, easing: EIO },
        { transform: "rotate(0deg)" },
      ],
      { duration: 620 },
    );
    give.animate(
      [
        { transform: "scale(1, 1)" },
        { transform: "scale(1.04, 0.95)", offset: 0.25 },
        { transform: "scale(1, 1)", offset: 0.5 },
        { transform: "scale(1.04, 0.95)", offset: 0.75 },
        { transform: "scale(1, 1)" },
      ],
      { duration: 620, easing: EIO },
    );
    for (const el of lids)
      el.animate(
        [{ transform: "scaleY(1)" }, { transform: "scaleY(0.25)", offset: 0.12 }, { transform: "scaleY(0.25)", offset: 0.85 }, { transform: "scaleY(1)" }],
        { duration: 620, easing: EO },
      );
    return 620;
  },
  huff: ({ give, lids, eyes }) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    for (const el of lids)
      el.animate(
        [{ transform: "scaleY(1)" }, { transform: "scaleY(0.5)", offset: 0.1 }, { transform: "scaleY(0.5)", offset: 0.9 }, { transform: "scaleY(1)" }],
        { duration: 1400, easing: EO },
      );
    give.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-3%)", offset: 0.06 },
        { transform: "translateX(3%)", offset: 0.12 },
        { transform: "translateX(0)", offset: 0.18 },
        { transform: "translateX(0)" },
      ],
      { duration: 1400, easing: EIO },
    );
    // Turns away from you, eyes and all.
    eyes?.look(side * 2.3, -1.4, 120);
    eyes?.lean(side * 1.6);
    return 1400;
  },
  backflip: ({ give, flip, lids, looks, eyes }) => {
    const ms = 2900;
    give.animate(
      [
        { transform: "translateY(0) scale(1, 1)", easing: EO },
        { transform: "translateY(0) scale(1.14, 0.82)", offset: 0.1, easing: EO },
        { transform: "translateY(-55%) scale(0.92, 1.1)", offset: 0.2, easing: EO },
        { transform: "translateY(-75%) scale(1, 1)", offset: 0.3, easing: EIO },
        { transform: "translateY(0) scale(1, 1)", offset: 0.42, easing: EO },
        { transform: "translateY(0) scale(1.14, 0.84)", offset: 0.48, easing: EO },
        { transform: "translateY(0) scale(0.97, 1.04)", offset: 0.56, easing: EO },
        { transform: "translateY(0) scale(1, 1)", offset: 0.62 },
        // Shaking it off.
        { transform: "translateX(0) scale(1, 1)", offset: 0.9, easing: EIO },
        { transform: "translateX(-3%) scale(1, 1)", offset: 0.94, easing: EIO },
        { transform: "translateX(3%) scale(1, 1)", offset: 0.97, easing: EIO },
        { transform: "translateX(0) scale(1, 1)" },
      ],
      { duration: ms },
    );
    flip.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(0deg)", offset: 0.12, easing: EIO },
        { transform: "rotate(-360deg)", offset: 0.44 },
        { transform: "rotate(-360deg)" },
      ],
      { duration: ms },
    );
    // Eyes squeezed shut in the air, then dizzy: three loops round the white.
    for (const el of lids)
      el.animate(
        [{ transform: "scaleY(1)" }, { transform: "scaleY(0.12)", offset: 0.1 }, { transform: "scaleY(0.12)", offset: 0.46 }, { transform: "scaleY(1)", offset: 0.5 }, { transform: "scaleY(1)" }],
        { duration: ms, easing: EO },
      );
    const dizzy = [{ transform: "translate(0px, 0px)" }, { transform: "translate(0px, 0px)", offset: 0.5 }];
    for (let i = 1; i <= 24; i++) {
      const a = (i / 8) * Math.PI * 2;
      dizzy.push({ transform: `translate(${(2 * Math.cos(a)).toFixed(2)}px, ${(-REST + 2.6 * Math.sin(a)).toFixed(2)}px)`, offset: +(0.5 + (i / 24) * 0.42).toFixed(4) });
    }
    dizzy.push({ transform: "translate(0px, 0px)", offset: 0.96 }, { transform: "translate(0px, 0px)" });
    for (const el of looks) {
      for (const a of el.getAnimations()) a.cancel();
      el.animate(dizzy, { duration: ms, fill: "forwards" });
    }
    eyes?.at(0, 0);
    return ms;
  },
};

function usePoke(ref, busy, eyes) {
  const pokes = useRef([]);
  const last = useRef(null);
  return useCallback(() => {
    const svg = ref.current;
    if (!svg?.animate) return;
    const now = performance.now();
    pokes.current = [...pokes.current.filter((t) => now - t < PESTER_MS), now];
    const kind = pokeReaction({ recent: pokes.current.length, last: last.current });
    last.current = kind;
    if (kind === "huff") pokes.current = [];

    const all = (selector) => [...svg.querySelectorAll(selector)];
    const parts = {
      give: svg.querySelector(".m-give"),
      flip: svg.querySelector(".m-flip"),
      lids: all(".m-lid"),
      wides: all(".m-wide"),
      looks: all(".m-look"),
      eyes: eyes.current,
    };
    // A new poke interrupts the last (the mood's own CSS animations stay).
    for (const el of [parts.give, parts.flip, ...parts.lids, ...parts.wides])
      for (const a of el.getAnimations()) if (!a.animationName) a.cancel();

    if (reduced()) {
      parts.eyes?.blink();
      return;
    }
    busy.current = now + FRAMES[kind](parts);
  }, [ref, busy, eyes]);
}

/* Where a pupil may go: anywhere inside the white, right up to its rim.
   Offsets are from the pupil's resting place, which sits a little low (REST),
   so the oval it moves in is centred on the white, not on the rest. */
const REST = 1.8;
const REACH_X = 2.3;
const REACH_Y = 3.2;
const inWhite = (x, y) => {
  const k = Math.hypot(x / REACH_X, (REST + y) / REACH_Y);
  return k > 1 ? [x / k, (REST + y) / k - REST] : [x, y];
};

const between = (lo, hi) => lo + Math.random() * (hi - lo);

// Eyes can't jump again at once: after one, the next waits at least this long
// (a saccade's refractory pause). Without it, moods flipping as an answer
// streams fire jump after jump, and the eyes buzz.
const NEXT_JUMP_MS = 180;

/* A group's transform as it is on screen now, mid-animation or not. */
function transformOf(el) {
  const t = getComputedStyle(el).transform;
  return new DOMMatrixReadOnly(!t || t === "none" ? undefined : t);
}

/* Stop whatever is moving `el`, leaving it where it is now (WAAPI's
   commitStyles) -- so the next move starts from what's on screen, never from
   where the last one was headed. Starting from there snaps the eyes back and
   forth whenever a move is cut short. */
function hold(el) {
  for (const a of el.getAnimations()) {
    try {
      a.commitStyles();
    } catch {
      // Not rendered: nothing on screen to keep.
    }
    a.cancel();
  }
}
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* The eyes' life: where they look and when they blink, chosen afresh each
 * time from the current mood. One set of timers per character, gone with it. */
function useEyes(ref, mood, alive, follow, busy, control, sockets = [[50, 50]]) {
  const moodRef = useRef(mood);
  const kick = useRef(null);
  moodRef.current = mood;

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !svg.animate) return undefined;
    const timers = new Set();
    let gone = false;
    const later = (ms, fn) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!gone) fn();
      }, ms);
      timers.add(t);
    };
    const me = { x: 0, y: 0, lean: 0, col: 0, line: 0, jumpedAt: -Infinity };

    // Where the pupils and the lean are now, with whatever moved them stopped.
    const pupilsNow = () => {
      const looks = [...svg.querySelectorAll(".m-look")];
      looks.forEach(hold);
      const m = transformOf(looks[0]);
      return [m.e, m.f];
    };
    const leanNow = () => {
      const el = svg.querySelector(".m-lean");
      hold(el);
      const m = transformOf(el);
      return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    };

    // Jump both pupils to (x, y): fast, decelerating, then held -- from
    // wherever they are, even mid-jump.
    const look = (tx, ty, ms) => {
      const [x, y] = inWhite(tx, ty);
      const [fx, fy] = pupilsNow();
      for (const el of svg.querySelectorAll(".m-look")) {
        el.animate([{ transform: `translate(${fx}px, ${fy}px)` }, { transform: `translate(${x}px, ${y}px)` }], {
          duration: ms,
          easing: EO,
          fill: "forwards",
        });
      }
      me.x = x;
      me.y = y;
      me.jumpedAt = performance.now();
      return Math.hypot(x - fx, y - fy) > 2.2;
    };

    // After a long look to one side, the body follows a beat later.
    const lean = (x) => {
      const to = Math.abs(x) > 1.1 ? +(x * 1.3).toFixed(2) : 0;
      if (to === me.lean) return; // already there, or on its way
      const from = leanNow();
      const el = svg.querySelector(".m-lean");
      el.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], {
        duration: 520,
        delay: 90,
        easing: EIO,
        fill: "forwards",
      });
      me.lean = to;
    };

    // Close fast, hold a moment, open a touch slower.
    const blink = () => {
      for (const el of svg.querySelectorAll(".m-lid")) {
        el.animate(
          [
            { transform: "scaleY(1)" },
            { transform: "scaleY(0.1)", offset: 0.35 },
            { transform: "scaleY(0.1)", offset: 0.5 },
            { transform: "scaleY(1)" },
          ],
          { duration: 190 },
        );
      }
    };

    const blinks = () => {
      const m = moodRef.current;
      if ((alive || m !== "still") && performance.now() >= busy.current) {
        blink();
        if (Math.random() < 0.15) later(260, blink); // now and then, a double
      }
      // Staring at you it blinks less; at rest, less again.
      const [lo, hi] = m === "asking" ? [4500, 8500] : m === "still" ? [3500, 8000] : [2200, 5600];
      later(between(lo, hi), blinks);
    };

    // Following the pointer. Eyes track a moving thing smoothly (pursuit),
    // so this eases toward it every frame rather than jumping; the body leans
    // after it, more slowly. Only at rest, and only while the pointer is in
    // the window and has moved in the last few seconds.
    const pointer = { x: 0, y: 0, at: 0, inside: false };
    const eyeX = sockets.reduce((sum, [x]) => sum + x, 0) / sockets.length;
    const eyeY = sockets.reduce((sum, [, y]) => sum + y, 0) / sockets.length;
    let frame = 0;
    let last = 0;
    const following = () =>
      follow &&
      pointer.inside &&
      performance.now() - pointer.at < 4000 &&
      (moodRef.current === "still" || moodRef.current === "idle") &&
      performance.now() >= busy.current &&
      !reduced();
    const pursue = (now) => {
      if (gone || !following()) {
        frame = 0;
        return;
      }
      const dt = last ? Math.min(now - last, 64) : 16;
      last = now;
      // Where the eyes are: between their sockets in the drawing, placed by
      // the character's own box -- which the body's lean, bob and hop don't
      // move. Measured from the whites instead, every lean the eyes cause
      // moves their target, and they wobble.
      const box = svg.getBoundingClientRect();
      const dx = pointer.x - (box.left + (eyeX / 100) * box.width);
      const dy = pointer.y - (box.top + (eyeY / 100) * box.height);
      // Near, the eyes turn a little; far, they reach the rim of the white,
      // in whichever direction the pointer is -- up, down or round. Right on
      // the face they look ahead: there, a pixel's move swings the direction
      // all the way round.
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.tanh(Math.max(0, dist - 6) / 140);
      const tx = REACH_X * reach * (dx / dist);
      const ty = REACH_Y * reach * (dy / dist) - REST;
      const k = 1 - Math.exp(-dt / 70);
      me.x += (tx - me.x) * k;
      me.y += (ty - me.y) * k;
      const toLean = Math.abs(me.x) > 1.1 ? me.x * 1.1 : 0;
      me.lean += (toLean - me.lean) * (1 - Math.exp(-dt / 260));
      for (const el of svg.querySelectorAll(".m-look")) el.style.transform = `translate(${me.x}px, ${me.y}px)`;
      svg.querySelector(".m-lean").style.transform = `rotate(${me.lean}deg)`;
      frame = requestAnimationFrame(pursue);
    };
    const pursueNow = () => {
      if (frame || !following()) return;
      // Hand over from the looks and leans already playing, from where they
      // are on screen.
      [me.x, me.y] = pupilsNow();
      me.lean = leanNow();
      last = 0;
      frame = requestAnimationFrame(pursue);
    };
    const onMove = (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.at = performance.now();
      pointer.inside = true;
      pursueNow();
    };
    const onOut = (e) => {
      if (!e.relatedTarget) pointer.inside = false;
    };
    const onBlur = () => {
      pointer.inside = false;
    };
    if (follow) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("mouseout", onOut);
      window.addEventListener("blur", onBlur);
    }

    const gaze = () => {
      const m = moodRef.current;
      let next;
      const wait = busy.current - performance.now();
      if (wait > 0) {
        later(wait + 60, gaze);
        return;
      }
      if (following()) {
        // Watching the pointer; look about again once it goes quiet.
        later(400, gaze);
        return;
      }
      if (reduced() || (!alive && m === "still")) {
        look(0, 0, 1);
        lean(0);
        next = 2500;
      } else if (m === "thinking") {
        // Reading: small hops along a line, then a sweep back to the next.
        if (me.col >= 4) {
          me.col = 0;
          me.line = (me.line + 1) % 3;
          look(-2.2, -0.6 + me.line * 0.6, 110);
          if (Math.random() < 0.3) blink();
          next = between(220, 340);
        } else {
          look(+(-2.2 + me.col * 1.45).toFixed(2), +(-0.6 + me.line * 0.6 + between(-0.1, 0.1)).toFixed(2), 60);
          me.col += 1;
          // A reader's fixation: about a quarter of a second, rarely less.
          next = between(210, 380);
        }
        lean(0);
      } else if (m === "speaking") {
        // Talking to you: holding your eye, with small shifts.
        look(+between(-0.7, 0.7).toFixed(2), +between(-1.4, -0.4).toFixed(2), 70);
        lean(0);
        next = between(600, 1400);
      } else if (m === "asking" || m === "done") {
        look(0, -1.6, 90);
        lean(0);
        next = between(1600, 3200);
      } else if (m === "listening") {
        look(+between(-1, 1).toFixed(2), +between(1.4, 2.4).toFixed(2), 80);
        lean(0);
        next = between(700, 1800);
      } else if (m === "error") {
        look(0, 2.6, 120);
        lean(0);
        next = 2000;
      } else {
        // At rest or idle: mostly small looks near the middle, sometimes a
        // long one away. Still glances less, and further between.
        const calm = m === "still";
        const far = Math.random() < (calm ? 0.25 : 0.4);
        const x = +(far ? between(-2.4, 2.4) : between(-1, 1)).toFixed(2);
        const y = +(far ? between(-4.8, 1.2) : between(-2.6, -0.8)).toFixed(2);
        if (look(x, y, between(70, 100)) && Math.random() < 0.35) blink(); // a blink rides a big jump
        lean(x);
        next = calm ? between(2200, 6000) : between(900, 3200);
      }
      later(next, gaze);
    };

    // What a poke may do with the eyes: look, lean, blink, or say where the
    // pupils were left.
    control.current = {
      look,
      lean,
      blink,
      at: (x, y) => {
        me.x = x;
        me.y = y;
      },
    };

    // A new mood looks somewhere new straight away, rather than at the next
    // tick -- once the last jump's pause is over.
    kick.current = () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      me.col = 0;
      later(Math.max(0, me.jumpedAt + NEXT_JUMP_MS - performance.now()), gaze);
      later(between(1500, 4000), blinks);
    };

    later(between(150, 1200), gaze);
    later(between(600, 4000), blinks);
    return () => {
      gone = true;
      kick.current = null;
      control.current = null;
      for (const t of timers) clearTimeout(t);
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("mouseout", onOut);
      window.removeEventListener("blur", onBlur);
    };
  }, [ref, alive, follow, busy, control, sockets]);

  // Not on the first render: characters that appear together shouldn't all
  // look up together.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    kick.current?.();
  }, [mood]);
}
