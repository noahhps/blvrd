import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { colourOf, dotsOf } from "../lib/agents.js";
import { FORMATIONS, formation } from "../lib/formations.js";

/* An agent, drawn: dots on the circumference of a circle -- 2 to 12 of them,
 * four by default -- or a picture of the reader's choosing.
 *
 * At rest it is still -- something you can stop noticing in a list of agents.
 * While the agent is answering (`spinning`) the dots run round the ring and
 * the ring tumbles in 3D, so each dot foreshortens into an ellipse as its side
 * turns away. Two nested layers, one job each: `.orbit-tumble` turns the
 * plane, `.orbit-spin` turns the dots within it. A picture doesn't spin (a
 * face going round reads as a fault); a few small dots orbit it instead.
 *
 * Changing the count is shown rather than swapped: the dots that stay glide
 * round to their new spacing, a new dot grows out of the top one, and a dot
 * that goes slides back into it and fades. Only dots added after the avatar
 * appeared animate in, so a list of agents doesn't burst open on every load.
 *
 * Stopping the spin does not snap. The running transforms are read, frozen
 * inline and eased home, so a ring caught mid-tumble settles flat rather than
 * jumping there -- a transition can't start from an animated value, so the
 * value is handed over by hand.
 *
 * While it works, the dots also walk through formations (lib/formations.js):
 * ring, triangle, wave, square, infinity, star, grid, gathered in -- each held
 * for a beat, then moved into the next. The step comes from the clock, so
 * every avatar of the same agent (sidebar, header, answer) shows the same
 * shape at the same moment; the agent's name offsets where it starts, so two
 * agents working at once are not in lockstep. Not with reduced motion.
 *
 * `intro` gives the large greeting avatar one slow turn when it appears. */

const HOLD_MS = 900; // a formation is held this long...
const MORPH_MS = 400; // ...then the dots move to the next (orbit.css)
const STEP_MS = HOLD_MS + MORPH_MS;

function offsetOf(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) | 0;
  return Math.abs(h) % FORMATIONS.length;
}

/* Which formation is showing, stepping on the clock while `on`. Null when
   off -- the dots are then the plain ring. */
function useFormation(on, name) {
  const [step, setStep] = useState(null);
  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!on || calm.matches) {
      setStep(null);
      return undefined;
    }
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      setStep(Math.floor(now / STEP_MS) + offsetOf(name));
      timer = setTimeout(tick, STEP_MS - (now % STEP_MS));
    };
    tick();
    return () => clearTimeout(timer);
  }, [on, name]);
  return step;
}

const LEAVE_MS = 260;
let keySeed = 0;

/* The dots on screen: those that are staying or arriving, then those on
   their way out. Keys are stable, so a dot that stays is the same element and
   its move is a transition, not a remount. */
function useDots(count) {
  const [slots, setSlots] = useState(() =>
    Array.from({ length: count }, () => ({ key: ++keySeed, state: "in" })),
  );
  useEffect(() => {
    setSlots((prev) => {
      const live = prev.filter((s) => s.state !== "out");
      if (live.length === count) return prev;
      if (live.length < count) {
        const added = Array.from({ length: count - live.length }, () => ({ key: ++keySeed, state: "enter" }));
        return [...live, ...added, ...prev.filter((s) => s.state === "out")];
      }
      const leaving = live.slice(count).map((s) => ({ ...s, state: "out" }));
      return [...live.slice(0, count), ...leaving, ...prev.filter((s) => s.state === "out")];
    });
  }, [count]);
  // A dot that has finished leaving is dropped.
  useEffect(() => {
    if (!slots.some((s) => s.state === "out")) return undefined;
    const timer = setTimeout(() => setSlots((prev) => prev.filter((s) => s.state !== "out")), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [slots]);
  return slots;
}

export function AgentAvatar({ look, name = "", size = 40, spinning = false, intro = false, className }) {
  const image = look?.image || null;
  const count = dotsOf(look);
  const slots = useDots(count);
  const tumble = useRef(null);
  const spin = useRef(null);
  const [running, setRunning] = useState(spinning);
  const step = useFormation(spinning && !image, name);
  const shape = step === null ? null : formation(step, count);

  useLayoutEffect(() => {
    if (spinning) {
      setRunning(true);
      return;
    }
    if (!running) return;
    const layers = [tumble.current, spin.current].filter(Boolean);
    for (const el of layers) {
      el.style.transform = getComputedStyle(el).transform;
      el.style.transition = "none";
    }
    setRunning(false);
    requestAnimationFrame(() => {
      for (const el of layers) {
        void getComputedStyle(el).transform;
        el.style.transition = "transform var(--orbit-settle) var(--ease-out)";
        el.style.transform = "";
        el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true });
      }
    });
    // `running` is read, not watched: this runs when the signal changes.
  }, [spinning]);

  let place = 0;
  return (
    <span
      className={className ? `orbit ${className}` : "orbit"}
      style={{ "--size": `${size}px`, "--dot": colourOf(look, name), "--n": count }}
      data-spinning={running ? "" : undefined}
      data-intro={intro ? "" : undefined}
      data-picture={image ? "" : undefined}
      data-shape={shape ? FORMATIONS[step % FORMATIONS.length].id : undefined}
      aria-hidden="true"
    >
      {image ? (
        <>
          {/* Keyed by the picture, so a new one crossfades in rather than
              swapping under the reader's eye. */}
          <img key={image} className="orbit-photo" src={image} alt="" draggable={false} />
          {running ? (
            <span className="orbit-halo">
              <i style={{ "--a": "0deg" }} />
              <i style={{ "--a": "120deg" }} />
              <i style={{ "--a": "240deg" }} />
            </span>
          ) : null}
        </>
      ) : (
        <span className="orbit-tumble" ref={tumble}>
          <span className="orbit-spin" ref={spin}>
            {slots.map((slot) => {
              // Staying and arriving dots share the circle evenly; a leaving
              // one heads for the top, back into the first dot.
              const index = slot.state === "out" ? 0 : place++;
              const angle = slot.state === "out" ? 360 : (index * 360) / count;
              // In a formation a dot is placed by x and y instead; a leaving
              // one still heads for the top.
              const [fx, fy] = shape && slot.state !== "out" ? shape[index] || [0, 0] : [0, -1];
              return (
                <i
                  key={slot.key}
                  style={{ "--a": `${angle}deg`, "--i": index, "--fx": fx.toFixed(3), "--fy": fy.toFixed(3) }}
                  data-entering={slot.state === "enter" ? "" : undefined}
                  data-leaving={slot.state === "out" ? "" : undefined}
                />
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
