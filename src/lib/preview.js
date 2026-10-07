/* What the sidebar says about a conversation: the line under its name, who
 * said it in a group, when, and how many agents a group has. */

import { renderMarkdown } from "./markdown.js";

const BLOCK = /<\/?(p|h[1-6]|li|ul|ol|blockquote|table|thead|tbody|tr|td|th|div|hr|br)\b[^>]*>/gi;
const cache = new Map();

/** Markdown as the plain text it reads as in the chat -- the same renderer
 *  (lib/markdown.js), its tags taken off -- so markup goes and nothing else
 *  does: "C#", "List<T>", "2 > 1" and "snake_case.csv" stay as written.
 *  A code block is "[code]". */
export function plainText(markdown) {
  const source = String(markdown || "");
  const known = cache.get(source);
  if (known !== undefined) return known;
  const text = renderMarkdown(source)
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, " [code] ")
    .replace(BLOCK, " ")
    .replace(/<[^>]+>/g, "")
    // Every < > " & in the text was escaped by the renderer, so a tag above
    // is always markup; now the text gets its characters back. &amp; last.
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(source, text);
  return text;
}

/** One message as a line of text; "" when it has nothing to show. */
export function previewOf(message) {
  if (!message || message.role === "summary") return "";
  if (message.failure) return "Something went wrong";
  if (message.role === "tool") return message.name ? `Used ${message.name}` : "";
  const text = plainText(message.content || message.note || "");
  if (message.role !== "user") return text;
  if (text) return `You: ${text}`;
  const files = message.files || [];
  return files.length ? `You: ${files.map((f) => f.name).join(", ")}` : "";
}

/** The line a conversation shows under its name: its latest message that has
 *  something to show -- so a turn that ended in a tool call and no words
 *  shows the tool rather than nothing. Null for a chat with nothing to show. */
export function lastLine(chat = []) {
  for (let i = chat.length - 1; i >= 0; i--) {
    const text = previewOf(chat[i]);
    if (text) return { message: chat[i], text };
  }
  return null;
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = (s) => (segmenter ? [...segmenter.segment(s)].map((g) => g.segment) : [...s]);
const firstWord = (name) => String(name || "").trim().split(/\s+/)[0];

/** A group member's name short enough to leave room for what they said:
 *  whole when short; else its first word, if that is a real word (three
 *  letters or more) no other member's name also starts with; else cut to 12
 *  characters. `others`: the other members' names. */
export function speakerName(name, others = []) {
  const full = String(name || "").trim();
  const chars = graphemes(full);
  if (chars.length <= 14) return full;
  const first = firstWord(full);
  if (/\p{L}{3,}/u.test(first) && !others.some((o) => firstWord(o) === first)) return first;
  return `${chars.slice(0, 12).join("").trimEnd()}…`;
}

/** How many agents a group has, as the sidebar says it. */
export function agentCount(n) {
  if (!n) return "No agents left";
  return n === 1 ? "1 agent" : `${n} agents`;
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** When a conversation was last active: the time today, the date this year,
 *  and the date with its year before that -- "Oct 3" alone would read as
 *  this year's. */
export function shortWhen(at, now = Date.now()) {
  if (!at) return "";
  const when = new Date(at);
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) return TIME.format(when);
  return (when.getFullYear() === today.getFullYear() ? DAY : DAY_YEAR).format(when);
}
