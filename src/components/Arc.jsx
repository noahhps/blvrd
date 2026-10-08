/* The Arc: blvrd's mascot, alive. A red arch -- the outline of a soft
 * dome, open at the floor, the boulevard's gateway -- on a white square, moving
 * with what the app is doing. The app and every agent wear it.
 *
 *   idle       breathes, slowly
 *   listening  stands taller, and gives a little with each keystroke
 *   thinking   a light runs up one leg, over the top and down the other
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

// The arch: the outline of a soft dome -- broad, rounded shoulders and sides
// that swell a little before tucking in -- drawn as one stroke, with its
// floor left open. The same line carries thinking's light, and its ripples.
const LINE = "M24 86 C17 62 18 22 50 22 C82 22 83 62 76 86";

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
