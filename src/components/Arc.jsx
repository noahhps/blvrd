/* The Arc: blvrd's mascot, alive. A red arch -- two-thirds of a circle,
 * open at the bottom like a sun on the horizon -- on a white square, moving
 * with what the app is doing. The app and every agent wear it.
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
 * shouldn't all be breathing at you. */

export const ARC_MOODS = ["idle", "listening", "thinking", "speaking", "asking", "done", "error"];

// The arch: two-thirds of a circle, open at the bottom -- a rising sun's
// outline with the horizon left out. The arc runs 240 degrees, from the
// lower left over the top to the lower right, drawn as one stroke with
// square-cut ends. The same
// line carries thinking's light, and its ripples.
const LINE = "M20.56 75 A34 34 0 1 1 79.44 75";

export function Arc({ mood = "idle", size = 28, tick = 0, label = null, colour = null, className = "" }) {
  return (
    <svg
      className={`logo arc ${className}`.trim()}
      data-mood={mood}
      width={size}
      height={size}
      style={{ borderRadius: Math.max(3, Math.round(size * 0.22)), ...(colour ? { "--arc": colour } : null) }}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    >
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
