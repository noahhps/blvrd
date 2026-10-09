/* blvrd's mark, still: the arch -- an archway on two flat feet, in the app's
 * blue, with a pair of googly eyes on its crown -- on a white square. The same
 * drawing as public/logo.svg and the app icons (src-tauri/icons, drawn by
 * icons/variants.mjs). The moving one is components/Mascot.jsx, shape "arc". */
export function Logo({ size = 28 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="#ffffff" />
      <g transform="translate(50 51) scale(0.8) translate(-50 -51)">
        <path
          d="M15 85V52A35 35 0 0 1 85 52V85H64V52A14 14 0 0 0 36 52V85Z"
          fill="var(--accent)"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeLinejoin="round"
        />
        <g stroke="#1a1a1a" strokeWidth="2.4" fill="#ffffff">
          <ellipse cx="41" cy="29" rx="6.4" ry="7.4" />
          <ellipse cx="59" cy="29" rx="6.4" ry="7.4" />
        </g>
        <circle cx="41" cy="30.8" r="3.6" fill="#1a1a1a" />
        <circle cx="59" cy="30.8" r="3.6" fill="#1a1a1a" />
      </g>
    </svg>
  );
}
