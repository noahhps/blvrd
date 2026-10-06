import {
  siApple,
  siAtlassian,
  siGithub,
  siGmail,
  siGoogle,
  siGooglecalendar,
  siGoogledrive,
  siGoogletasks,
  siHomeassistant,
  siHuggingface,
  siLinear,
  siModelcontextprotocol,
  siNotion,
  siSentry,
  siStripe,
  siSupabase,
  siVercel,
} from "simple-icons";

import { Icon } from "./Icon.jsx";

/* The marks connectors are known by -- bundled, from Simple Icons (CC0), so
 * they draw offline, crisp at any size, and nothing is fetched to show them.
 *
 * Each is one path in the brand's colour. A brand whose colour is near black
 * (Notion, Vercel, Apple, GitHub, MCP) is drawn in the ink instead, so it
 * stays visible on the dark theme. A server with no known mark gets a
 * monogram; a folder of files, the file glyph. */

const BRANDS = {
  google: siGoogle,
  gmail: siGmail,
  calendar: siGooglecalendar,
  drive: siGoogledrive,
  tasks: siGoogletasks,
  apple: siApple,
  homeassistant: siHomeassistant,
  mcp: siModelcontextprotocol,
  notion: siNotion,
  linear: siLinear,
  atlassian: siAtlassian,
  github: siGithub,
  sentry: siSentry,
  stripe: siStripe,
  supabase: siSupabase,
  vercel: siVercel,
  huggingface: siHuggingface,
};

function dark(hex) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
}

const monogram = (name) =>
  String(name || "?")
    .split(/[\s_\-./&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/** `id` names a brand above; `name` is used for the monogram when it doesn't. */
export function BrandLogo({ id, name, size = 18, tile = true }) {
  const brand = BRANDS[id];
  const mark = brand ? (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={brand.title}>
      <path d={brand.path} fill={dark(brand.hex) ? "var(--ink)" : `#${brand.hex}`} />
    </svg>
  ) : id === "filesystem" ? (
    <Icon name="file" size={size} />
  ) : (
    <span className="brand-monogram" style={{ fontSize: Math.round(size * (tile ? 0.66 : 0.86)), minWidth: size }} aria-label={name}>
      {monogram(name)}
    </span>
  );
  if (!tile) return mark;
  return (
    <span className="brand-logo" style={{ "--tile": `${Math.round(size * 1.75)}px` }}>
      {mark}
    </span>
  );
}
