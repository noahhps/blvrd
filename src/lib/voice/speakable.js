/* What of an answer is said aloud, and in what pieces (docs/voice.md).
 *
 * An answer is read out while it is still arriving, a sentence at a time, so
 * the first words are heard as soon as the first sentence is whole. The text
 * is the model's Markdown; what's spoken is the plain sentences in it:
 * emphasis and links reduced to their words, headings and list items each a
 * sentence of their own, code blocks and tables left on the screen.
 *
 * `segments` is asked again with the whole text each time more arrives, and
 * gives the same pieces for what it had before, plus any new whole ones -- so
 * the speaker only has to say the ones past where it got to. Nothing is cut
 * at a full stop until the space after it has arrived (it might be "3.14"),
 * and thinking (<think>), a call written as text, and whatever follows them
 * are never spoken at all. */

// A call written into the reply as text (lib/heal.js callsInText): the rest
// of this reply is the call, not words for the reader.
const CALL = /<tool_call>|\[TOOL_CALLS\]|<\|python_tag\|>|<function=/;

// A full stop after these is not the end of a sentence. Kept short: "No." and
// "etc." end sentences more often than not.
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "e.g", "i.e", "cf", "approx", "dept", "est", "fig", "inc", "ltd", "mt"]);

// A sentence longer than this is said in parts, at its commas.
const LONGEST = 240;

/** What the reader would hear of `text` so far: its pieces, in order. With
 *  `final`, the text is complete and its last piece is said too. */
export function segments(text, { final = false } = {}) {
  const lines = speakablePart(String(text || ""), final).split("\n");
  // The last line may still be arriving: only its finished sentences count.
  const partial = final ? null : lines.pop();
  const out = [];
  let fence = false;
  for (const line of lines) {
    const kind = lineKind(line, fence);
    if (kind.fence) fence = !fence;
    if (kind.text) out.push(...sentences(kind.text, true));
  }
  if (partial !== null && !fence) {
    const kind = lineKind(partial, false);
    // A heading or list item is a sentence of its own once its line ends.
    // The space after a last full stop is what says it ended; keep it.
    if (kind.text && !kind.whole) out.push(...sentences(/\s$/.test(partial) ? `${kind.text} ` : kind.text, false));
  }
  return out;
}

/** All of `text` as it would be said, for a test or a preview. */
export const spokenOf = (text) => segments(text, { final: true }).join(" ");

/* The text up to what can't be said: no thinking, nothing from a call written
   as text on. An unfinished <think> holds everything after it back. */
function speakablePart(text, final) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Thinking whose opening tag was in the model's template, not its reply.
  const closed = t.lastIndexOf("</think>");
  if (closed !== -1) t = t.slice(closed + "</think>".length);
  const open = t.indexOf("<think>");
  if (open !== -1) t = t.slice(0, open);
  const call = t.search(CALL);
  if (call !== -1) t = t.slice(0, call);
  // While streaming, a trailing "<" may be the start of one of the above.
  if (!final) t = t.replace(/<[^>\s]*$|\[TOOL_?C?A?L?L?S?$/, "");
  return t;
}

/* What one line is: a code fence, something left on the screen, or words --
   and whether those words are a sentence of their own (`whole`) whatever
   their punctuation. */
function lineKind(raw, inFence) {
  const line = raw.trim();
  if (/^(```|~~~)/.test(line)) return { fence: true };
  if (inFence || !line) return {};
  // Tables and rules stay on the screen.
  if (line.startsWith("|") || /^([-*_]\s*){3,}$/.test(line)) return {};
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return { text: ended(inline(heading[1])), whole: true };
  const quote = line.replace(/^(>\s?)+/, "");
  const item = /^([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(quote);
  if (item) return { text: ended(inline(item[3])), whole: true };
  return { text: inline(quote) };
}

/* A heading or list item read as a sentence: a full stop if it has no mark
   of its own, so a voice falls at its end rather than running on. */
const ended = (s) => (/[\p{L}\p{N}%)"'”’]$/u.test(s) ? `${s}.` : s);

/* Markdown within a line, down to its words. */
function inline(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => siteOf(url))
    .replace(/\bhttps?:\/\/[^\s)<>\]]+/g, (url) => siteOf(url))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    // Markers left over from emphasis not yet closed while it streams.
    .replace(/\*\*+|__+/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1")
    // Emoji are read out by name ("grinning face") or not at all.
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* A link is said as where it goes. */
function siteOf(url) {
  try {
    return new URL(url.replace(/[.,;:!?]+$/, "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/* A line's sentences. A line that has ended (`whole`) gives its last words
   too, however they end; one still arriving keeps them until their sentence
   ends. */
function sentences(text, whole) {
  const out = [];
  let from = 0;
  const end = /([.!?…]+)(["'”’)\]]*)(\s+)/g;
  for (let m; (m = end.exec(text)); ) {
    const stop = m.index + m[1].length + m[2].length;
    if (m[1] === "." && !m[2] && notAnEnd(text.slice(from, m.index))) continue;
    out.push(...parts(text.slice(from, stop).trim()));
    from = stop + m[3].length;
  }
  const rest = text.slice(from).trim();
  if (rest && whole) out.push(...parts(rest));
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/* Whether a full stop after `before` belongs to an abbreviation or an
   initial ("Dr.", "e.g.", "J. R. R.") rather than ending a sentence. */
function notAnEnd(before) {
  const word = /(\S+)$/.exec(before)?.[1] || "";
  const bare = word.replace(/^[("'“‘[]+/, "").toLowerCase();
  // A single letter, or letters with stops between them ("p.m", "U.S").
  return ABBREVIATIONS.has(bare) || /^(\p{L}\.)*\p{L}$/u.test(bare);
}

/* A long sentence in parts no longer than LONGEST, cut after a comma,
   semicolon or dash where it can be, else at a space. */
function parts(sentence) {
  const out = [];
  let rest = sentence;
  while (rest.length > LONGEST) {
    const head = rest.slice(0, LONGEST);
    let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(" — "), head.lastIndexOf(" – "));
    if (cut < LONGEST / 3) cut = head.lastIndexOf(" ");
    if (cut < 1) cut = LONGEST - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Said to the model with a spoken message (lib/run.js `note`): the reader
 *  is listening, not reading, and was heard rather than typed. */
export const SPOKEN_NOTE =
  "(The user said this aloud, and your answer will be read out to them. Answer as you would say it: " +
  "plainly and briefly -- a few sentences unless they ask for more -- without headings, tables or lists " +
  "of more than a few items, and with numbers, times and units as they're said. Anything that only works " +
  "written down, like code or a long link, goes after what you say; it stays on their screen and isn't read out. " +
  "Their words were transcribed and may be misheard: if something doesn't make sense, ask.)";
