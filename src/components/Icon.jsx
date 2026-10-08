/* The handful of glyphs the app uses, drawn on a 24px grid in currentColor. */

const PATHS = {
  plus: "M12 5v14M5 12h14",
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  pen: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 7.5l3 3",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
  play: "M8 5.5v13l10.5-6.5L8 5.5Z",
  pause: "M8.5 5v14M15.5 5v14",
  next: "M6 6l9 6-9 6V6Z M18 6v12",
  back: "M18 6l-9 6 9 6V6Z M6 6v12",
  undo: "M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  history: "M12 8v4l2.5 1.5 M3.5 12a8.5 8.5 0 1 0 2.5-6 M3 4v4h4",
  props: "M4 7h3 M11 7h9 M4 12h3 M11 12h9 M4 17h3 M11 17h9",
  todo: "M4 5h5v5H4z M5.5 7.5l1 1 2-2 M13 7.5h7 M4 14h5v5H4z M13 16.5h7",
  text: "M4 6h16 M4 11h16 M4 16h10",
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5V4.5Z M5 19.5A1.5 1.5 0 0 0 6.5 21H19 M9 7.5h6",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  open: "M14 5h5v5 M19 5l-8 8 M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4",
  close: "M6 6l12 12M18 6 6 18",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18",
  chip: "M7 7h10v10H7z M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4",
  tool: "M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.6-.4-.4-2.6 2.5-2.5Z",
  chevron: "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  paperclip: "M20.5 11.5 12 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5",
  sidebar: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M9 5v14",
  "sidebar-filled": "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M9 5v14",
  more: "M12 5.5v.01M12 12v.01M12 18.5v.01",
  // Two corners drawn in: a chat folded up.
  compact: "M4 14h6v6 M3 21l7-7 M20 10h-6V4 M21 3l-7 7",
  pin: "M9 4h6l-1 6 3 3H7l3-3-1-6Z M12 13v7",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8Z M12 17v4",
  check: "M5 12.5l4.5 4.5L19 7",
  camera: "M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
};

/* Solid shapes drawn under a glyph's lines: the filled sidebar's panel. */
const FILLS = {
  "sidebar-filled": "M4 5h5v14H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
};

export function Icon({ name, size = 18 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {FILLS[name] ? <path d={FILLS[name]} fill="currentColor" stroke="none" /> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
