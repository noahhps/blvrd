/* What tells one agent from another: its character, its colour, and a line
 * under its name.
 *
 * An agent is drawn as a character of its own (components/Mascot.jsx): a
 * shape that says what it does -- a magnifier, a pencil, a calendar -- with
 * a pair of eyes, stored as `look.shape`, in one of these colours, stored as
 * `look.colour`. Or as a picture of the reader's own, `look.image`. (A
 * `look.dots` from when agents were rings of dots is kept but no longer
 * drawn.) An agent saved before characters or colours existed -- or with
 * Bom's old hat-and-item look -- gets one picked from its name, so it is
 * never blank and always the same. */

export const COLOURS = [
  { id: "red", label: "Red", value: "#e5392b" },
  { id: "orange", label: "Orange", value: "#ef8a2b" },
  { id: "yellow", label: "Yellow", value: "#e3b21f" },
  { id: "green", label: "Green", value: "#33a061" },
  { id: "blue", label: "Blue", value: "#3a7bdc" },
  { id: "violet", label: "Violet", value: "#8758d6" },
  { id: "ink", label: "Ink", value: "var(--ink)" },
];

const BY_ID = new Map(COLOURS.map((c) => [c.id, c]));

function hashed(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return COLOURS[(h >>> 0) % (COLOURS.length - 1)];
}

/** The CSS colour an agent is drawn in. `look` may be null. */
export function colourOf(look, seed = "") {
  return (BY_ID.get(look?.colour) || hashed(seed || look?.name || "")).value;
}

/** The colour id an agent wears, for the editor's swatches. */
export function colourIdOf(agent) {
  return BY_ID.has(agent?.look?.colour) ? agent.look.colour : hashed(agent?.name).id;
}

/* The characters an agent can be, in the order the editor offers them. */
export const SHAPES = [
  { id: "arc", label: "blvrd" },
  { id: "magnifier", label: "Magnifier" },
  { id: "pencil", label: "Pencil" },
  { id: "book", label: "Book" },
  { id: "calendar", label: "Calendar" },
  { id: "envelope", label: "Envelope" },
  { id: "phone", label: "Phone" },
  { id: "laptop", label: "Laptop" },
  { id: "chart", label: "Chart" },
  { id: "palette", label: "Palette" },
  { id: "briefcase", label: "Briefcase" },
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
  { id: "drop", label: "Drop" },
  { id: "circle", label: "Circle" },
];

const SHAPE_IDS = new Set(SHAPES.map((s) => s.id));

// A name that says what the agent does picks the character that does it.
const HINTS = [
  [/blvrd|boulevard/i, "arc"],
  [/research|search|find|investig/i, "magnifier"],
  [/writ|edit|draft|copy|author/i, "pencil"],
  [/plan|schedul|calendar|organi[sz]/i, "calendar"],
  [/mail|inbox|letter|post/i, "envelope"],
  [/call|phone|ring/i, "phone"],
  [/cod(e|er|ing)|dev|engineer|program/i, "laptop"],
  [/analy|data|number|financ|account/i, "chart"],
  [/design|art|draw|paint|illustrat/i, "palette"],
  [/tutor|teach|learn|read|study|book/i, "book"],
  [/assist|business|office|work/i, "briefcase"],
  [/companion|friend|buddy|talk/i, "heart"],
];
const PLAIN = ["circle", "star", "drop", "heart"];

/** The character an agent is drawn as: its own, else one its name suggests,
 *  else one picked from its name. `look` may be null. */
export function shapeOf(look, name = "") {
  if (SHAPE_IDS.has(look?.shape)) return look.shape;
  const hint = HINTS.find(([pattern]) => pattern.test(name || ""));
  if (hint) return hint[1];
  let h = 2166136261;
  for (const ch of String(name || "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return PLAIN[(h >>> 0) % PLAIN.length];
}

/* The line under an agent's name: a preset's tagline for one made from a
 * preset and left as it was, otherwise the first sentence of its
 * instructions. */
export function taglineOf(agent, presets = []) {
  if (!agent) return "";
  const name = (agent.name || "").trim().toLowerCase();
  const match = presets.find((p) => p.id === name || (p.name || "").toLowerCase() === name);
  if (match?.tagline && (!agent.instructions || agent.instructions === match.instructions)) return match.tagline;
  const text = (agent.instructions || "").trim();
  if (!text) return "No instructions yet.";
  const first = text.match(/^[^.!?]*[.!?]/);
  const line = first ? first[0] : text;
  return line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line;
}
