import { useEffect, useRef, useState } from "react";

import { colourOf } from "../lib/agents.js";
import { Arc } from "./Arc.jsx";

/* An agent, drawn: the Arc (components/Arc.jsx) in the agent's own colour --
 * the same mascot as the app's, so every agent is one of the family -- or a
 * picture of the reader's choosing.
 *
 * At rest it is still, something you can stop noticing in a list of agents.
 * Working (`spinning`) it thinks, sweeping round its square; `mood` names any
 * other of the Arc's moods outright (speaking while its words arrive). When
 * the work stops it settles home with the Arc's small bounce rather than
 * snapping still, and `intro` gives the greeting avatar that bounce as it
 * appears.
 *
 * A picture doesn't move (a face going round reads as a fault); a few small
 * dots in the agent's colour orbit it while it works. */

const SETTLE_MS = 700; // the Arc's bounce (arc.css)

/* "done" for a moment after `on` turns off, or from the start with `intro`. */
function useSettle(on, intro) {
  const [settling, setSettling] = useState(intro);
  const was = useRef(on);
  useEffect(() => {
    if (was.current && !on) setSettling(true);
    was.current = on;
  }, [on]);
  useEffect(() => {
    if (!settling) return undefined;
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling]);
  return settling && !on;
}

export function AgentAvatar({ look, name = "", size = 40, spinning = false, intro = false, mood = null, className }) {
  const image = look?.image || null;
  const colour = colourOf(look, name);
  const working = spinning || Boolean(mood);
  const settling = useSettle(working, intro);

  if (image) {
    return (
      <span
        className={className ? `orbit ${className}` : "orbit"}
        style={{ "--size": `${size}px`, "--dot": colour }}
        data-picture=""
        aria-hidden="true"
      >
        {/* Keyed by the picture, so a new one crossfades in rather than
            swapping under the reader's eye. */}
        <img key={image} className="orbit-photo" src={image} alt="" draggable={false} />
        {working ? (
          <span className="orbit-halo">
            <i style={{ "--a": "0deg" }} />
            <i style={{ "--a": "120deg" }} />
            <i style={{ "--a": "240deg" }} />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Arc
      className={className ? `agent-arc ${className}` : "agent-arc"}
      colour={colour}
      size={size}
      mood={mood || (spinning ? "thinking" : settling ? "done" : "still")}
    />
  );
}
