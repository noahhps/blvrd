import { useEffect, useRef, useState } from "react";

import { colourOf, shapeOf } from "../lib/agents.js";
import { Mascot } from "./Mascot.jsx";

/* An agent, drawn: its character (components/Mascot.jsx) -- a shape that
 * says what it does, in its own colour, with eyes -- or a picture of the
 * reader's choosing. blvrd itself is one of these characters, the arch.
 *
 * At rest it is still but for the odd blink and glance, something you can
 * stop noticing in a list. Working (`spinning`) it reads; `mood` names any
 * other mood outright (speaking while its words arrive). When the work stops
 * it hops and winks rather than snapping still, and `intro` gives the
 * greeting avatar that hop as it appears. Small copies (under 30px: one per
 * message in a chat) keep their eyes still unless they're doing something.
 * `follow`: the eyes follow the pointer while it rests (the open chat's).
 * `poke`: clicking it gets a reaction (components/Mascot.jsx).
 *
 * A picture doesn't move (a face going round reads as a fault); a few small
 * dots in the agent's colour orbit it while it works. */

const SETTLE_MS = 700; // the character's hop (mascot.css)

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

export function AgentAvatar({ look, name = "", size = 40, spinning = false, intro = false, mood = null, alive = size >= 30, follow = false, poke = false, className }) {
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
    <Mascot
      className={className ? `agent-mascot ${className}` : "agent-mascot"}
      shape={shapeOf(look, name)}
      colour={colour}
      size={size}
      alive={alive}
      follow={follow}
      poke={poke ? `Poke ${name || "your agent"}` : null}
      mood={mood || (spinning ? "thinking" : settling ? "done" : "still")}
    />
  );
}
