/* The Arc: blvrd's mark, alive. The same red quarter circle in the corner of
 * a white square as the logo (components/Logo.jsx), moving with what the app
 * is doing -- the app's presence, as an agent's dots are the agent's.
 *
 *   idle       breathes, slowly
 *   listening  leans out of its corner, and gives a little with each keystroke
 *   thinking   sweeps round the square's corners, a faint trail behind
 *   speaking   ripples out from its edge as an answer comes in
 *   asking     holds full and blinks, waiting for your Allow
 *   done       settles back with a small bounce
 *   error      shakes once and dims
 *
 * All of it is transforms and opacity (styles/arc.css), so it keeps moving
 * while an answer streams. `tick` changes with each keystroke while
 * listening, and replays the give. */

export const ARC_MOODS = ["idle", "listening", "thinking", "speaking", "asking", "done", "error"];

const BODY = "M0 32 A68 68 0 0 1 68 100 L0 100 Z";
const EDGE = "M0 32 A68 68 0 0 1 68 100";

export function Arc({ mood = "idle", size = 28, tick = 0, label = null }) {
  return (
    <svg
      className="logo arc"
      data-mood={mood}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    >
      <rect width="100" height="100" fill="#ffffff" />
      <g className="arc-turn">
        <g className="arc-trail">
          <path d={BODY} />
        </g>
        <g className="arc-body">
          <g className="arc-give" key={mood === "listening" ? tick : 0}>
            <path d={BODY} />
          </g>
        </g>
        <path className="arc-ripple" d={EDGE} />
        <path className="arc-ripple arc-ripple-late" d={EDGE} />
      </g>
    </svg>
  );
}
