/* Compaction: a chat that has grown too long for its model is folded up.
 *
 * The older part is summarized -- by the agent's own model -- and a
 * { role: "summary" } message is put into the chat where the summary ends.
 * The chat still shows everything, the summary as a divider; what goes to
 * the model is the summary (in the system prompt, `summaryContext`) and only
 * the messages after it (`sinceSummary`). Compacting again summarizes the
 * last summary together with what came after it.
 *
 * A cut always falls just before a message from the reader, so a tool call
 * and its result are never split, and what the model is sent still starts
 * with the reader speaking. */

import { adapterFor } from "./providers.js";

export const DEFAULT_COMPACT_AT = 32000; // tokens, roughly
export const COMPACT_CHOICES = [8000, 16000, 32000, 64000, 128000];
export const compactAtOf = (state) => (state.compactAt === undefined ? DEFAULT_COMPACT_AT : state.compactAt);

/** About how many tokens messages come to: four characters a token, and a
 *  flat amount for each picture. */
export function sizeOf(messages) {
  let chars = 0;
  for (const m of messages) {
    if (m.failure || m.role === "summary") continue;
    chars += (m.content || "").length;
    for (const c of m.calls || []) chars += JSON.stringify(c.args || {}).length + (c.name || "").length;
    for (const f of m.files || []) chars += f.kind === "image" ? 4000 : (f.text || "").length;
  }
  return Math.ceil(chars / 4);
}

/** The last summary, and the messages after it. */
export function sinceSummary(messages) {
  const at = messages.findLastIndex((m) => m.role === "summary");
  return at === -1 ? { summary: null, rest: messages } : { summary: messages[at], rest: messages.slice(at + 1) };
}

/** What an agent is told of the part of the chat it no longer sees. */
export function summaryContext(messages) {
  const { summary } = sinceSummary(messages);
  if (!summary?.content) return "";
  return `This conversation has been going for a while. Its earlier part, which you no longer see, is summarized here:\n\n${summary.content}`;
}

/** Where to cut `messages` so that what is kept comes to `keep` tokens or
 *  less -- but always at least the reader's last message and what followed
 *  it. Null when there is nothing before that to fold up. */
export function cutFor(messages, keep) {
  const starts = messages.map((m, i) => (m.role === "user" && i > 0 ? i : -1)).filter((i) => i > 0);
  if (!starts.length) return null;
  return starts.find((i) => sizeOf(messages.slice(i)) <= keep) ?? starts[starts.length - 1];
}

/** Whether there is anything to fold: a message from the reader after the
 *  first since the last summary. The same as `cutFor(rest, 0) !== null`, in
 *  one pass -- cheap enough to ask of every chat in the sidebar. */
export function canFold(messages) {
  return sinceSummary(messages).rest.some((m, i) => i > 0 && m.role === "user");
}

/** Whether a chat, with `next` about to be added, has outgrown `limit`. */
export function tooLong(messages, next, limit) {
  if (!limit) return false;
  return sizeOf([...sinceSummary(messages).rest, ...(next ? [next] : [])]) > limit;
}

/** The chat as plain lines, for the summarizer. */
export function transcriptOf(messages, nameOf) {
  const lines = [];
  for (const m of messages) {
    if (m.failure || m.role === "summary") continue;
    if (m.role === "user") {
      const files = (m.files || []).map((f) => f.name).join(", ");
      lines.push(`[User]: ${m.content || ""}${files ? ` (attached: ${files})` : ""}`);
    } else if (m.role === "assistant") {
      const calls = (m.calls || []).map((c) => c.name).join(", ");
      if (m.content?.trim() || calls) lines.push(`[${nameOf(m.agentId)}]: ${m.content?.trim() || ""}${calls ? ` (used ${calls})` : ""}`);
    } else if (m.role === "scheduled") {
      if (m.content?.trim()) lines.push(`[${nameOf(m.agentId)}, scheduled task “${m.scheduled?.title || "a task"}”]: ${m.content.trim()}`);
    } else if (m.role === "tool") {
      const result = String(m.content || "");
      lines.push(`[${m.name} result]: ${result.length > 600 ? `${result.slice(0, 600)}…` : result}`);
    }
  }
  return lines.join("\n\n");
}

const SUMMARIZER = [
  "You compress conversations so they can continue without the original.",
  "Write a summary of the conversation you are given that keeps everything needed to carry on: what the user wants,",
  "facts and figures established, decisions made, names, files, links, preferences the user stated, open questions,",
  "and what was being worked on at the end. Say who said what where it matters.",
  "Write it in the language the conversation is in. Use short plain sentences or bullets, under 400 words.",
  "Write only the summary.",
].join(" ");

/** Summarize `messages` (after `previous`, an earlier summary) with `model`. */
export async function summarize({ provider, model, previous = null, messages, nameOf, signal }) {
  const transcript = transcriptOf(messages, nameOf);
  const content = [
    previous ? `Summary of what came before:\n${previous}\n\nWhat came after:` : "The conversation:",
    transcript,
  ].join("\n\n");
  const result = await adapterFor(provider).turn({
    provider,
    model,
    system: SUMMARIZER,
    messages: [{ role: "user", content }],
    tools: [],
    signal,
    onText: () => {},
  });
  const text = (result.text || "").trim();
  if (!text) throw new Error("The model gave back an empty summary.");
  return text;
}

/** Fold up `messages`, keeping about `keep` tokens of the most recent. Returns
 *  the summary message and the id of the message it goes before, or null if
 *  there is nothing to fold. */
export async function compact({ messages, keep, provider, model, nameOf, signal }) {
  const { summary, rest } = sinceSummary(messages);
  const cut = cutFor(rest, keep);
  if (cut === null) return null;
  const older = rest.slice(0, cut);
  const content = await summarize({ provider, model, previous: summary?.content, messages: older, nameOf, signal });
  const covers = (summary?.covers || 0) + older.filter((m) => !m.failure).length;
  return { before: rest[cut].id, summary: { role: "summary", content, covers } };
}

/** `messages` with `summary` put in just before the message `before`. */
export function withSummary(messages, before, summary) {
  const at = messages.findIndex((m) => m.id === before);
  if (at === -1) return messages;
  return [...messages.slice(0, at), summary, ...messages.slice(at)];
}
