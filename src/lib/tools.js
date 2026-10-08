/* What an agent can do besides talk: its abilities.
 *
 * Kept small and local on purpose. Four run entirely on this machine; two,
 * `web_search` and `read_page`, reach the internet and say so (`network:
 * true`), so the editor can mark them and a reader who wants an agent that
 * never leaves the machine can switch them off. An agent is offered only the tools it is allowed
 * (`agent.tools`, null meaning all), and a call to any other is refused.
 */

import { calculate } from "./calc.js";
import { httpFetch } from "./http.js";
import { formatResults, search } from "./search.js";

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
    name: "web_search",
    label: "Search the web",
    network: true,
    description:
      "Search the web and get back a ranked list of results: title, URL and a short excerpt each. Use it for anything current, or that you are not sure of, then read_page the most promising results before you rely on them.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for, as you would type it into a search engine." },
        count: { type: "integer", description: "How many results, 1 to 10. Default 5." },
      },
      required: ["query"],
    },
    run: async ({ query, count }, ctx) => {
      const found = await search(query, { limit: count ?? 5, settings: ctx.search?.(), signal: ctx.signal });
      return formatResults(String(query).trim(), found);
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
      return clip(text);
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** The tools an agent may use: all of `available`, or those on its own list.
 *  A list entry `group:<id>` stands for every tool of that connector, so an
 *  agent given "Google Workspace" also gets tools added to it later. */
export function toolsFor(agent, available = TOOLS) {
  if (!agent || agent.tools == null) return available;
  const allowed = new Set(agent.tools);
  return available.filter((tool) => allowed.has(tool.name) || (tool.group && allowed.has(`group:${tool.group}`)));
}

/* A long page cut to `limit` characters: the first three quarters of the
 * budget from the top, the last quarter from the end -- where conclusions,
 * dates and references tend to be -- each cut at a line break, with a marker
 * saying how much of the middle was left out. */
export function clip(text, limit = 15000) {
  if (text.length <= limit) return text;
  const headBudget = Math.floor(limit * 0.75);
  const tailBudget = limit - headBudget;
  // Back to the last line break within the budget, if there is one not too far back.
  const headCut = text.lastIndexOf("\n", headBudget);
  const head = text.slice(0, headCut > headBudget / 2 ? headCut : headBudget);
  const tailFrom = text.length - tailBudget;
  const tailCut = text.indexOf("\n", tailFrom);
  const tail = text.slice(tailCut !== -1 && tailCut < tailFrom + tailBudget / 2 ? tailCut + 1 : tailFrom);
  const left = text.length - head.length - tail.length;
  return `${head}\n\n[... ${left} characters from the middle of the page left out, of ${text.length} ...]\n\n${tail}`;
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
