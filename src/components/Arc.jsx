/* The Arc: blvrd's mascot, alive. A red ring, open just at the bottom, on
 * a white square, moving with what the app is doing. The app and every agent wear it.
 *
 *   idle       breathes, slowly
 *   listening  stands taller, and gives a little with each keystroke
 *   thinking   a light runs up one side, over the top and down the other
 *   speaking   ripples out from its curve as an answer comes in
 *   asking     grows, holds, and blinks, waiting for your Allow
 *   done       settles with a small squash and bounce
 *   error      shakes once and dims
 *
 * All of it is transforms and opacity (styles/arc.css), so it keeps moving
 * while an answer streams. `tick` changes with each keystroke while
 * listening, and replays the give.
 *
 * Agents wear it too (components/AgentAvatar.jsx), each in its own `colour`
 * rather than the brand red, and `still` while they rest -- a list of agents
 * shouldn't all be breathing at you.
 *
 * It's painted with a gradient made from that one colour (arc.css): lighter
 * and warmer at the top left, deeper at the feet -- a sunrise for the brand
 * red, and its own blend for every agent's colour. */

import { useId } from "react";

export const ARC_MOODS = ["idle", "listening", "thinking", "speaking", "asking", "done", "error"];

// The arch: nearly a full circle, open only at the bottom -- 300 degrees,
// from the lower left over the top to the lower right, drawn as a thick stroke with round
// ends (arc.css) -- so it's smooth all round, feet included. Thinking's
// light and the ripples follow the same line.
const LINE = "M34.50 78.85 A31 31 0 1 1 65.50 78.85";

export function Arc({ mood = "idle", size = 28, tick = 0, label = null, colour = null, className = "" }) {
  // One gradient per Arc (there are many on screen), in the tile's own units
  // so the body, its stroke and the ripples all take the same colours.
  const paint = `arc-paint-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={`logo arc ${className}`.trim()}
      data-mood={mood}
      width={size}
      height={size}
      style={{ borderRadius: Math.max(3, Math.round(size * 0.22)), "--arc-paint": `url(#${paint})`, ...(colour ? { "--arc": colour } : null) }}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    >
      <defs>
        <linearGradient id={paint} gradientUnits="userSpaceOnUse" x1="20" y1="16" x2="80" y2="90">
          <stop className="arc-stop-from" offset="0" />
          <stop className="arc-stop-to" offset="1" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="#ffffff" />
      <g className="arc-shake">
        <g className="arc-body">
          <g className="arc-give" key={mood === "listening" ? tick : 0}>
            <path className="arc-fill" d={LINE} />
            <path className="arc-light" d={LINE} pathLength="100" />
          </g>
        </g>
        <path className="arc-ripple" d={LINE} />
        <path className="arc-ripple arc-ripple-late" d={LINE} />
      </g>
    </svg>
  );
}
