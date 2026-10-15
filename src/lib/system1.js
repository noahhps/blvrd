/* System 1 agents: fast, reflexive models with no conversation. Ollama runs
 * one kind of them -- embedding models (nomic-embed-text, mxbai-embed-large,
 * bge-m3, all-minilm, snowflake-arctic-embed...). /api/show lists their
 * capabilities as ["embedding"], with no "completion", which is why
 * /api/chat refuses them ("does not support chat"). What Ollama expects
 * instead is
 *
 *   POST /api/embed  { model, input: [text, ...], truncate: true,
 *                      dimensions?, keep_alive? }
 *   ->  { model, embeddings: [[...], ...], prompt_eval_count, total_duration }
 *
 * and every job here is built on that one call: an embedding, and cosine
 * similarity between embeddings. An OpenAI-compatible server is asked the
 * same at /embeddings ({ model, input } -> { data: [{ embedding }], usage }).
 *
 *   embed     one text -> its vector (dimensions, norm, the first values)
 *   classify  a text against your labels -> each label's similarity
 *   rank      a query and passages -> the passages, most relevant first
 *   match     two texts -> how alike they are
 *   dedupe    a list -> the pairs that say the same thing
 *
 * Some embedding models were trained with a prefix that says what a text is
 * for (nomic: "search_query: " / "search_document: " / "classification: ";
 * mxbai and the bge family: an instruction on the query). Ollama passes text
 * as it is, so the prefix is added here. */

import { httpFetch } from "./http.js";

export const TASKS = [
  { id: "embed", label: "Embed", hint: "Turn a text into a vector, for search and memory." },
  { id: "classify", label: "Classify", hint: "Sort a text into one of your labels." },
  { id: "rank", label: "Rank", hint: "Order passages by how well they answer a query." },
  { id: "match", label: "Match", hint: "Say how alike two texts are." },
  { id: "dedupe", label: "Dedupe", hint: "Find the lines in a list that say the same thing." },
];
export const taskOf = (id) => TASKS.find((t) => t.id === id) || TASKS[0];

/** What a System 1 agent keeps besides its model: its job and settings. */
export const DEFAULT_S1 = { task: "embed", labels: [], topK: 5, threshold: 0.85, dimensions: null };
export const s1Of = (agent) => ({ ...DEFAULT_S1, ...(agent?.s1 || {}) });

/** Embedding models Ollama's library carries, for the editor's suggestions. */
export const OLLAMA_EMBEDDERS = ["nomic-embed-text", "mxbai-embed-large", "bge-m3", "snowflake-arctic-embed2", "all-minilm", "granite-embedding"];

const trim = (url) => String(url || "").replace(/\/+$/, "");

/* -- prefixes ----------------------------------------------------------------- */

const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

function prefixesFor(model) {
  const name = String(model || "").toLowerCase();
  if (name.includes("nomic-embed")) return { query: "search_query: ", doc: "search_document: ", label: "classification: ", text: "classification: ", same: "clustering: " };
  if (name.includes("mxbai-embed") || /\bbge-(small|base|large)/.test(name)) return { query: QUERY_INSTRUCTION, doc: "", label: "", text: "", same: "" };
  return { query: "", doc: "", label: "", text: "", same: "" };
}

/* -- the call ------------------------------------------------------------------- */

/** Embed `texts` with `model` on `provider`. Returns the vectors, the tokens
 *  the server counted, and how long it took. */
export async function embed({ provider, model, texts, dimensions = null, signal }) {
  const started = Date.now();
  if (provider.kind === "ollama") {
    const response = await httpFetch(`${trim(provider.base)}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts, truncate: true, ...(dimensions ? { dimensions } : {}) }),
      signal,
    });
    if (!response.ok) throw new Error(await problemOf(response, provider, model));
    const data = await response.json();
    return {
      vectors: data.embeddings || [],
      tokens: data.prompt_eval_count ?? null,
      ms: data.total_duration ? Math.round(data.total_duration / 1e6) : Date.now() - started,
    };
  }
  const headers = { "Content-Type": "application/json", ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}) };
  const response = await httpFetch(`${trim(provider.base)}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input: texts, ...(dimensions ? { dimensions } : {}) }),
    signal,
  });
  if (!response.ok) throw new Error(await problemOf(response, provider, model));
  const data = await response.json();
  return {
    vectors: (data.data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding),
    tokens: data.usage?.prompt_tokens ?? null,
    ms: Date.now() - started,
  };
}

async function problemOf(response, provider, model) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.error?.message || body.error || "";
  } catch {
    /* no body */
  }
  if (/does not support (embed|embedding)/i.test(detail) || /not an embedding model/i.test(detail)) {
    return `${model} isn't an embedding model, so it can't run as a System 1 agent. Choose an embedding model (on Ollama: ${OLLAMA_EMBEDDERS.slice(0, 3).join(", ")}…), or make this agent an LLM.`;
  }
  if (response.status === 404 && provider.kind === "ollama") return `Ollama doesn't have ${model}. Pull it first: ollama pull ${model}`;
  return `${provider.name || "The server"} answered ${response.status}${detail ? `: ${detail}` : ""}`;
}

/* -- the arithmetic -------------------------------------------------------------- */

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const lines = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/* -- the tasks ---------------------------------------------------------------- */

/** What each task needs, from the input box: returns { texts, ...shape } or
 *  throws a message saying what is missing. */
export function inputsFor(task, input, config, model) {
  const p = prefixesFor(model);
  if (task === "classify") {
    const labels = (config.labels || []).filter(Boolean);
    if (labels.length < 2) throw new Error("Give this agent at least two labels to choose between (Configure).");
    if (!input.trim()) throw new Error("Write the text to classify.");
    return { texts: [p.text + input.trim(), ...labels.map((l) => p.label + l)], labels };
  }
  if (task === "rank") {
    const [query, ...rest] = String(input).split(/\n\s*\n|\n---+\n/);
    const passages = rest.join("\n").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!query?.trim() || !passages.length) throw new Error("Write the query, a blank line, then one passage per line.");
    return { texts: [p.query + query.trim(), ...passages.map((x) => p.doc + x)], query: query.trim(), passages };
  }
  if (task === "match") {
    const [a, b] = String(input).split(/\n---+\n|\n\s*\n/);
    if (!a?.trim() || !b?.trim()) throw new Error("Write two texts, with a blank line between them.");
    return { texts: [p.same + a.trim(), p.same + b.trim()], a: a.trim(), b: b.trim() };
  }
  if (task === "dedupe") {
    const items = lines(input);
    if (items.length < 2) throw new Error("Write at least two lines to compare.");
    return { texts: items.map((x) => p.same + x), items };
  }
  if (!input.trim()) throw new Error("Write the text to embed.");
  return { texts: [p.doc + input.trim()], text: input.trim() };
}

/** Run a task: returns a result for the console, and the same as Markdown for
 *  the chat's log. */
export async function run({ provider, model, task, input, config, signal }) {
  const shaped = inputsFor(task, input, config, model);
  const { vectors, tokens, ms } = await embed({ provider, model, texts: shaped.texts, dimensions: config.dimensions, signal });
  if (vectors.length !== shaped.texts.length) throw new Error(`${model} returned ${vectors.length} embeddings for ${shaped.texts.length} texts.`);
  const meta = { task, model, tokens, ms, dims: vectors[0]?.length || 0 };
  let result;
  if (task === "classify") {
    const scores = shaped.labels.map((label, i) => ({ label, score: cosine(vectors[0], vectors[i + 1]) })).sort((a, b) => b.score - a.score);
    result = { ...meta, scores, best: scores[0] };
  } else if (task === "rank") {
    const ranked = shaped.passages.map((text, i) => ({ text, at: i + 1, score: cosine(vectors[0], vectors[i + 1]) })).sort((a, b) => b.score - a.score);
    result = { ...meta, query: shaped.query, ranked: ranked.slice(0, config.topK || ranked.length) };
  } else if (task === "match") {
    result = { ...meta, score: cosine(vectors[0], vectors[1]) };
  } else if (task === "dedupe") {
    const pairs = [];
    for (let i = 0; i < vectors.length; i++)
      for (let j = i + 1; j < vectors.length; j++) {
        const score = cosine(vectors[i], vectors[j]);
        if (score >= (config.threshold ?? 0.85)) pairs.push({ a: shaped.items[i], b: shaped.items[j], score });
      }
    result = { ...meta, pairs: pairs.sort((x, y) => y.score - x.score), count: shaped.items.length };
  } else {
    result = { ...meta, norm: norm(vectors[0]), preview: vectors[0].slice(0, 8) };
  }
  return { result, markdown: markdownOf(result) };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function markdownOf(r) {
  const foot = `\n\n\`${r.model}\` · ${r.dims} dimensions${r.tokens != null ? ` · ${r.tokens} tokens` : ""} · ${r.ms} ms`;
  if (r.task === "classify") return `**${r.best.label}** — ${pct(r.best.score)}\n\n| Label | Similarity |\n|---|---|\n${r.scores.map((s) => `| ${s.label} | ${pct(s.score)} |`).join("\n")}${foot}`;
  if (r.task === "rank") return `| # | Passage | Relevance |\n|---|---|---|\n${r.ranked.map((x, i) => `| ${i + 1} | ${x.text} | ${pct(x.score)} |`).join("\n")}${foot}`;
  if (r.task === "match") return `**${pct(r.score)}** alike${foot}`;
  if (r.task === "dedupe") return (r.pairs.length ? `| Line | Same as | Similarity |\n|---|---|---|\n${r.pairs.map((x) => `| ${x.a} | ${x.b} | ${pct(x.score)} |`).join("\n")}` : `No duplicates among ${r.count} lines.`) + foot;
  return `Embedded: **${r.dims} dimensions**, norm ${r.norm.toFixed(3)}\n\n\`[${r.preview.map((x) => x.toFixed(4)).join(", ")}, …]\`${foot}`;
}
