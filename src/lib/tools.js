/* What an agent can do besides talk: its abilities.
 *
 * Kept small and local on purpose. Four run entirely on this machine; one,
 * `read_page`, reaches the internet and says so (`network: true`), so the
 * editor can mark it and a reader who wants an agent that never leaves the
 * machine can switch it off. An agent is offered only the tools it is allowed
 * (`agent.tools`, null meaning all), and a call to any other is refused.
 */

import { calculate } from "./calc.js";
import { httpFetch } from "./http.js";

export const TOOLS = [
  {
    name: "current_time",
    label: "Clock",
    description: "The current local date, time and time zone. Use it whenever the answer depends on today's date or the time.",
    parameters: { type: "object", properties: {}, required: [] },
    run: () => {
      const now = new Date();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return `${now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })} (${zone}; ISO ${now.toISOString()})`;
    },
  },
  {
    name: "calculate",
    label: "Calculator",
    description:
      "Evaluate an arithmetic expression exactly: + - * / % ^, parentheses, pi, e, and sqrt, abs, round, floor, ceil, ln, log, log2, exp, sin, cos, tan, min, max. Use it for any arithmetic rather than working it out in your head.",
    parameters: {
      type: "object",
      properties: { expression: { type: "string", description: "e.g. (1450 * 24) + 2 * 1450" } },
      required: ["expression"],
    },
    run: ({ expression }) => {
      const value = calculate(expression);
      return `${expression} = ${+value.toPrecision(15)}`;
    },
  },
  {
    name: "remember",
    label: "Notes: remember",
    description: "Save a short note to this agent's own notebook, kept between conversations -- a preference, a fact about the user, a decision. One fact per note.",
    parameters: {
      type: "object",
      properties: { note: { type: "string", description: "The fact to keep, in one sentence." } },
      required: ["note"],
    },
    run: ({ note }, ctx) => {
      const text = String(note).trim();
      if (!text) throw new Error("the note is empty");
      ctx.addNote(text);
      return `Saved: ${text}`;
    },
  },
  {
    name: "recall",
    label: "Notes: recall",
    description: "Look through this agent's notebook. With a query, only notes containing those words; without one, all of them.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for (optional)." } },
      required: [],
    },
    run: ({ query }, ctx) => {
      const notes = ctx.notes();
      const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = words.length
        ? notes.filter((n) => words.some((w) => n.text.toLowerCase().includes(w)))
        : notes;
      if (!hits.length) return notes.length ? "No notes match." : "The notebook is empty.";
      return hits.map((n) => `- ${n.text} (${new Date(n.at).toLocaleDateString()})`).join("\n");
    },
  },
  {
    name: "read_page",
    label: "Read a web page",
    network: true,
    description: "Fetch a web page or text file by URL and return its readable text. Only for a URL the user gave or that you are sure exists.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "A full http(s) URL." } },
      required: ["url"],
    },
    run: async ({ url }, ctx) => {
      let target;
      try {
        target = new URL(url);
      } catch {
        throw new Error(`"${url}" is not a URL`);
      }
      if (!/^https?:$/.test(target.protocol)) throw new Error("only http and https pages can be read");
      const response = await httpFetch(target.href, { signal: ctx.signal, headers: { Accept: "text/html,text/plain,*/*" } });
      if (!response.ok) throw new Error(`the page answered ${response.status}`);
      const type = response.headers.get("content-type") || "";
      const body = await response.text();
      const text = /html/i.test(type) || /^\s*</.test(body) ? htmlToText(body) : body;
      const limit = 12000;
      return text.length > limit ? `${text.slice(0, limit)}\n\n[...cut at ${limit} characters of ${text.length}]` : text;
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** The tools an agent may use: all of them, or its own list. */
export function toolsFor(agent) {
  if (!agent || agent.tools == null) return TOOLS;
  const allowed = new Set(agent.tools);
  return TOOLS.filter((tool) => allowed.has(tool.name));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const text = html
    .replace(/<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, code) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? `${title.trim()}\n\n${text}` : text;
}
