/* Web search for the `web_search` tool, the way Hermes Agent does it.
 *
 * With nothing set up it still works: each search goes to the next of four
 * free, anonymous endpoints -- Exa, Parallel, Firecrawl and Keenable -- and
 * one that is rate-limited, refuses or fails hands the search to the one after
 * it. No key, no account; nothing that identifies the reader is sent, only
 * the query. That free tier is the last resort: a provider the reader picks in
 * Settings (with their own key, or their own SearXNG) is asked first, and the
 * free tier only stands in when it fails -- unless that is switched off too.
 *
 * Results are kept for ten minutes, so an agent that searches the same thing
 * twice, or two agents in a group that search it at once, ask only once.
 *
 *   search(query, { limit, settings, signal }) -> { results: [{ title, url, snippet }], via }
 */

import { isStop } from "./abort.js";
import { failure, httpFetch } from "./http.js";

/* What Settings stores under `search`. */
export const DEFAULT_SEARCH = { provider: "free", keys: {}, searxng: "", fallback: true };

export const searchOf = (state) => ({ ...DEFAULT_SEARCH, ...(state?.search || {}), keys: { ...(state?.search?.keys || {}) } });

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify(body),
});

async function call(name, url, init, signal) {
  const response = await httpFetch(url, { ...init, signal });
  if (!response.ok) throw await failure(response, name);
  return response.text();
}

/* The text of an MCP `tools/call` answer: plain JSON (Parallel) or SSE
 * `data:` lines (Exa). A tool error -- Exa's rate limit comes as one -- is
 * thrown. */
export function mcpText(body, name) {
  const trimmed = body.trim();
  const candidates = [...(trimmed.startsWith("{") ? [trimmed] : []), ...body.split(/\r\n|\r|\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5))];
  for (const candidate of candidates) {
    let data;
    try {
      data = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (data.error) throw new Error(`${name}: ${data.error.message || JSON.stringify(data.error)}`);
    const texts = (data.result?.content || []).map((c) => c?.text).filter(Boolean);
    if (data.result?.isError) throw new Error(`${name}: ${texts.join(" ") || "the search failed"}`);
    if (texts.length) return texts[0];
  }
  throw new Error(`${name} sent back something that isn't a search result`);
}

const mcp = async (name, url, tool, args, signal) =>
  mcpText(await call(name, url, json({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }), signal), name);

/* Exa's MCP answer: `---`-separated blocks of Title:/URL:/Highlights: lines. */
export function parseExa(text) {
  const labels = /^(Title|URL|Highlights|Published|Author):/;
  return text.split(/\n---\n/).flatMap((block) => {
    let title = "";
    let url = "";
    let inHighlights = false;
    const highlights = [];
    for (const line of block.split("\n").map((l) => l.trim())) {
      if (line.startsWith("Title:")) title = line.slice(6).trim();
      else if (line.startsWith("URL:")) url = line.slice(4).trim();
      else if (inHighlights && line && !labels.test(line)) highlights.push(line);
      if (labels.test(line)) inHighlights = line.startsWith("Highlights:");
    }
    return url ? [{ title, url, snippet: highlights.join(" ") }] : [];
  });
}

// A random id for Parallel's rate limiting, new each launch, never stored.
const SESSION = Math.random().toString(16).slice(2) + Date.now().toString(16);

/* The free tier: one function per vendor, (query, limit, signal) -> results. */
export const FREE = {
  exa: {
    name: "Exa",
    search: async (q, limit, signal) =>
      parseExa(await mcp("Exa", "https://mcp.exa.ai/mcp", "web_search_exa", { query: q, numResults: limit }, signal)),
  },
  parallel: {
    name: "Parallel",
    search: async (q, limit, signal) => {
      const text = await mcp("Parallel", "https://search.parallel.ai/mcp", "web_search", { objective: q, search_queries: [q], session_id: SESSION }, signal);
      return (JSON.parse(text).results || []).map((r) => ({ title: r.title, url: r.url, snippet: (r.excerpts || []).join(" ") }));
    },
  },
  firecrawl: {
    name: "Firecrawl",
    search: async (q, limit, signal) => {
      const data = JSON.parse(await call("Firecrawl", "https://api.firecrawl.dev/v2/search", json({ query: q, limit }), signal));
      const list = Array.isArray(data.data) ? data.data : data.data?.web || [];
      return list.map((r) => ({ title: r.title, url: r.url, snippet: r.description || r.markdown }));
    },
  },
  keenable: {
    name: "Keenable",
    search: async (q, limit, signal) => {
      const init = json({ query: q, max_results: limit });
      init.headers["X-Keenable-Title"] = "blvrd";
      const data = JSON.parse(await call("Keenable", "https://api.keenable.ai/v1/search/public", init, signal));
      return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet || r.description }));
    },
  },
};

const RING = Object.keys(FREE);
// Where the next free search starts. Random per launch, so not every copy of
// the app leans on the same vendor first.
let cursor = Math.floor(Math.random() * RING.length);

/* The providers the reader can choose instead, with their own key (or, for
 * SearXNG, their own server). */
export const PAID = {
  brave: {
    name: "Brave Search",
    keys: "https://brave.com/search/api/",
    search: async (q, limit, signal, key) => {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`;
      const data = JSON.parse(await call("Brave Search", url, { headers: { Accept: "application/json", "X-Subscription-Token": key } }, signal));
      return (data.web?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
    },
  },
  tavily: {
    name: "Tavily",
    keys: "https://app.tavily.com/home",
    search: async (q, limit, signal, key) => {
      const init = json({ query: q, max_results: limit });
      init.headers.Authorization = `Bearer ${key}`;
      const data = JSON.parse(await call("Tavily", "https://api.tavily.com/search", init, signal));
      return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    },
  },
  exa: {
    name: "Exa",
    keys: "https://dashboard.exa.ai/api-keys",
    search: async (q, limit, signal, key) => {
      const init = json({ query: q, numResults: limit, contents: { highlights: true } });
      init.headers["x-api-key"] = key;
      const data = JSON.parse(await call("Exa", "https://api.exa.ai/search", init, signal));
      return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: (r.highlights || []).join(" ") || r.text }));
    },
  },
  searxng: {
    name: "SearXNG",
    search: async (q, limit, signal, base) => {
      const url = `${String(base).replace(/\/+$/, "")}/search?q=${encodeURIComponent(q)}&format=json`;
      const data = JSON.parse(await call("SearXNG", url, { headers: { Accept: "application/json" } }, signal));
      return (data.results || []).slice(0, limit).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    },
  },
};

const tidy = (results, limit) =>
  results
    .filter((r) => r?.url)
    .slice(0, limit)
    .map((r) => {
      const snippet = String(r.snippet || "").replace(/\s+/g, " ").trim();
      return { title: String(r.title || "").trim() || r.url, url: r.url, snippet: snippet.length > 500 ? `${snippet.slice(0, 500)}…` : snippet };
    });


/* Each free vendor in turn from the cursor, until one answers. */
async function searchFree(q, limit, signal) {
  const start = cursor;
  cursor = (cursor + 1) % RING.length;
  const order = [...RING.slice(start), ...RING.slice(0, start)];
  const problems = [];
  for (const id of order) {
    try {
      const results = await FREE[id].search(q, limit, signal);
      return { results, via: FREE[id].name };
    } catch (problem) {
      if (isStop(problem, signal)) throw problem;
      problems.push(problem.message);
    }
  }
  throw new Error(`every free search service failed (${problems.join("; ")}). Add a search key in Settings for steadier service.`);
}

async function searchWith(settings, q, limit, signal) {
  const chosen = PAID[settings.provider];
  const secret = settings.provider === "searxng" ? settings.searxng : settings.keys[settings.provider];
  if (!chosen) return searchFree(q, limit, signal);
  if (!secret) {
    if (!settings.fallback) throw new Error(`${chosen.name} is chosen for search but has no ${settings.provider === "searxng" ? "address" : "key"} in Settings`);
    return searchFree(q, limit, signal);
  }
  try {
    return { results: await chosen.search(q, limit, signal, secret), via: chosen.name };
  } catch (problem) {
    if (isStop(problem, signal) || !settings.fallback) throw problem;
    const free = await searchFree(q, limit, signal);
    return { ...free, note: `${chosen.name} failed (${problem.message}), so the free tier answered.` };
  }
}

const TTL = 10 * 60 * 1000;
const FETCH = 10; // always ask for this many, so 3 and 8 results share a cache entry
const cache = new Map(); // key -> { at, pending }

export async function search(query, { limit = 5, settings = DEFAULT_SEARCH, signal } = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("the search is empty");
  const n = Math.max(1, Math.min(FETCH, Math.round(Number(limit)) || 5));
  const key = `${settings.provider}|${q.toLowerCase().replace(/\s+/g, " ")}`;
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > TTL) {
    entry = { at: Date.now(), pending: searchWith(settings, q, FETCH, signal) };
    cache.set(key, entry);
    // Only answers are kept: a failure is asked again next time.
    entry.pending.catch(() => cache.get(key) === entry && cache.delete(key));
  }
  const found = await entry.pending;
  return { ...found, results: tidy(found.results, n) };
}

/** What the model reads. */
export function formatResults(query, { results, via, note }) {
  if (!results.length) return `No results for "${query}" (searched with ${via}).`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`);
  return [`Results for "${query}" (from ${via}):`, "", ...lines, "", "Use read_page on a result to read the whole page.", ...(note ? ["", note] : [])].join("\n");
}

// For the tests.
export const _reset = () => {
  cache.clear();
  cursor = 0;
};
