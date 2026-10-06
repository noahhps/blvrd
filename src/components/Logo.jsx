/* blvrd's mark: a red quarter circle in the bottom-left corner of a white
 * square. The same drawing as public/logo.svg and the app icons
 * (src-tauri/icons, generated from logo-1024.png). */
export function Logo({ size = 28 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="#ffffff" />
      <path d="M0 32 A68 68 0 0 1 68 100 L0 100 Z" fill="var(--red)" />
    </svg>
  );
}
