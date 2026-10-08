/* The Arc: blvrd's mascot, alive. A red arch -- one sweeping curve, the
 * boulevard's gateway -- standing on the floor of a white square, moving
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

// The arch: one continuous curve, like a gateway arch -- legs that lean in
// as they rise and sweep into the top, with no straight run and no corner.
// Outer edge up and over, then the opening back the other way; the band is
// broader at the feet than at the crown.
const BODY = "M8 100 C14 52 28 14 50 14 C72 14 86 52 92 100 H68 C66 62 60 34 50 34 C40 34 34 62 32 100 Z";
const EDGE = "M8 100 C14 52 28 14 50 14 C72 14 86 52 92 100";
// The middle of the band, for thinking's light to run along.
const SPINE = "M20 100 C24 57 36 24 50 24 C64 24 76 57 80 100";

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
            <path className="arc-fill" d={BODY} />
            <path className="arc-light" d={SPINE} pathLength="100" />
          </g>
        </g>
        <path className="arc-ripple" d={EDGE} />
        <path className="arc-ripple arc-ripple-late" d={EDGE} />
      </g>
    </svg>
  );
}
