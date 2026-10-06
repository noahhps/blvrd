import { useLayoutEffect, useRef, useState } from "react";

import { colourOf } from "../lib/agents.js";

/* An agent, drawn: four dots on the circumference of a circle.
 *
 * At rest it is still -- a ring you can stop noticing in a list of agents.
 * While the agent is answering (`spinning`) the dots run round the ring and
 * the ring tumbles in 3D, so each dot foreshortens into an ellipse as its side
 * turns away. Two nested layers, one job each: `.orbit-tumble` turns the
 * plane, `.orbit-spin` turns the dots within it.
 *
 * Stopping does not snap. The running transforms are read, frozen inline and
 * eased home, so a ring caught mid-tumble settles flat rather than jumping
 * there -- a transition can't start from an animated value, so the value is
 * handed over by hand.
 *
 * `intro` gives the large greeting avatar one slow turn when it appears. */

const DOTS = 4;

export function AgentAvatar({ look, name = "", size = 40, spinning = false, intro = false, className }) {
  const tumble = useRef(null);
  const spin = useRef(null);
  const [running, setRunning] = useState(spinning);

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

  return (
    <span
      className={className ? `orbit ${className}` : "orbit"}
      style={{ "--size": `${size}px`, "--dot": colourOf(look, name) }}
      data-spinning={running ? "" : undefined}
      data-intro={intro ? "" : undefined}
      aria-hidden="true"
    >
      <span className="orbit-tumble" ref={tumble}>
        <span className="orbit-spin" ref={spin}>
          {Array.from({ length: DOTS }, (_, i) => (
            <i key={i} style={{ "--i": i }} />
          ))}
        </span>
      </span>
    </span>
  );
}
