/* At-a-glance readings for an agent: which kind of model it runs on, how hot
 * it is running, how many tokens it has gone through, and how much context
 * it has left. All from what the app already keeps -- the chat and the model
 * chosen -- so nothing here asks a server anything.
 *
 *   kind     "llm" (a language model: it reads and writes, and holds a
 *            conversation) or "s1" (a System 1 model: fast and reflexive,
 *            no conversation -- it embeds, ranks, classifies, tags,
 *            transcribes or detects, one input at a time), read from the
 *            model's family. Null when no model is chosen.
 *   tokens   every token the chat has used, summarized parts included --
 *            estimated, four characters a token (lib/compact.js sizeOf).
 *   heat     load: tokens through the chat in the last ten minutes against
 *            what its kind takes comfortably, 0-100; at least 70 while it
 *            is answering.
 *   context  for an LLM, what is left of the budget before the chat is
 *            compacted (the "sanity" counter); for a System 1 model, what
 *            the last input left of its window, since it reads one at a
 *            time. 0-100, or null when there's nothing to count against. */

import { sinceSummary, sizeOf } from "./compact.js";

const HEAT_WINDOW = 10 * 60 * 1000;
// Tokens in the window that count as running flat out, per kind: a System 1
// model is built to be hammered; an LLM is hot far sooner.
const HEAT_FULL = { s1: 60000, llm: 12000 };

/** The model's size in billions of parameters, when its name says
 *  ("qwen2.5:0.5b", "llama-3.1-70b-instruct", "gemma3:4b", "mixtral-8x7b"). */
export function paramsOf(model) {
  const name = String(model || "").toLowerCase();
  const moe = name.match(/(\d+)x(\d+(?:\.\d+)?)b\b/);
  if (moe) return Number(moe[1]) * Number(moe[2]);
  const plain = name.match(/(?:^|[^a-z0-9.])e?(\d+(?:\.\d+)?)b\b/);
  return plain ? Number(plain[1]) : null;
}

/* System 1 families, and the input window each reads at once (tokens).
   Ollama runs the embedding ones; the rest are named so they are recognised
   on other servers. */
const S1 = [
  { re: /nomic-embed|bge-m3|snowflake-arctic-embed2|jina-embeddings|text-embedding|granite-embedding|qwen3-embedding|embeddinggemma/, task: "embed", window: 8192 },
  { re: /mxbai-embed|snowflake-arctic-embed|bge-(small|base|large)|\bgte-|\be5-/, task: "embed", window: 512 },
  { re: /all-minilm|minilm|paraphrase-multilingual/, task: "embed", window: 256 },
  { re: /embed/, task: "embed", window: 2048 },
  { re: /rerank|cross-encoder|colbert/, task: "rank", window: 512 },
  { re: /gliner|\bner\b|spacy/, task: "tag", window: 512 },
  { re: /bert|roberta|deberta|electra|zeroshot|zero-shot|sst2|\bnli\b|classifier/, task: "classify", window: 512 },
  { re: /whisper|wav2vec|parakeet|canary|speech|\basr\b|vosk/, task: "listen", window: 448 },
  { re: /yolo|detr|clip|siglip|sam\b|segment-anything|dino|resnet|vit-|efficientnet/, task: "see", window: null },
];

export function s1Of(model) {
  const name = String(model || "").toLowerCase();
  return S1.find((f) => f.re.test(name)) || null;
}

/** "llm", "s1", or null when there's no model. `known` -- what the agent
 *  was set to, or what the server said of the model -- wins over the name. */
export function kindOf(model, known = null) {
  if (!model) return null;
  if (known === "s1" || known === "llm") return known;
  return s1Of(model) ? "s1" : "llm";
}

/** Every token the chat has used, before and after any summary. */
export function tokensOf(messages) {
  return sizeOf(messages || []);
}

/** The chat's last few turns, as token counts, oldest first -- for a
 *  sparkline. */
export function sparkOf(messages, count = 16) {
  return (messages || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-count)
    .map((m) => sizeOf([m]));
}

/** Load, 0-100. */
export function heatOf(messages, { kind = "llm", answering = false, now = Date.now() } = {}) {
  const recent = (messages || []).filter((m) => m.at && now - m.at < HEAT_WINDOW);
  const load = Math.round((100 * sizeOf(recent)) / (HEAT_FULL[kind] || HEAT_FULL.llm));
  return Math.min(100, Math.max(answering ? 70 : 0, load));
}

/** What is left of `limit` tokens before the chat is compacted, counting
 *  what the model is sent -- the messages since the last summary, and an
 *  answer still arriving. */
export function contextOf(messages, limit, liveText = "") {
  if (!limit) return null;
  const used = sizeOf(sinceSummary(messages || []).rest) + Math.ceil((liveText || "").length / 4);
  return { used, limit, left: Math.max(0, Math.min(100, Math.round(100 * (1 - used / limit)))) };
}

/** A token count, short: 940, 12.4K, 1.2M. */
export function shortTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}K`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** Everything at once, for one agent's chat. `limit` is the LLM's
 *  compaction budget; a System 1 model uses its own window instead. */
export function readingsOf({ messages = [], model = null, kind: known = null, task = null, window = null, limit = null, live = null, now = Date.now() }) {
  const kind = kindOf(model, known);
  const family = kind === "s1" ? { task: "embed", window: 2048, ...(s1Of(model) || {}), ...(task ? { task } : {}), ...(window ? { window } : {}) } : null;
  const liveText = live ? (live.parts?.length ? live.parts.map((p) => p.text || "").join("") : live.text || "") : "";
  const tokens = tokensOf(messages) + Math.ceil(liveText.length / 4);
  const lastInput = [...(messages || [])].reverse().find((m) => m.role === "user");
  return {
    kind,
    task: family?.task || null,
    params: paramsOf(model),
    tokens,
    spark: sparkOf(messages),
    heat: heatOf(messages, { kind: kind || "llm", answering: Boolean(live), now }),
    context: kind === "s1" ? (family.window && lastInput ? contextOf([lastInput], family.window) : family.window ? contextOf([], family.window) : null) : contextOf(messages, limit, liveText),
    answering: Boolean(live),
  };
}
