/* What a model can do, as tools and the computer need to know it -- see
 * docs/computer-providers.md.
 *
 *   window      tokens it can really take (its context), or null if unknown
 *   vision      whether it reads pictures
 *   tools       "native" -- the server's own tool calls work
 *               "prompted" -- tools are described in the prompt and calls read
 *                 from the reply (lib/prompted.js)
 *               "none" -- neither worked when it was tested
 *               null -- not known yet: native is tried first
 *   ids         "any" | "alnum9" -- the tool call ids its server accepts
 *   emptyContent  send "" rather than null for a reply that is only calls
 *   plainSchemas  send tool parameters without anything but types, names and
 *                 descriptions
 *
 * Each comes from, in order, each overriding the one before: a default for
 * the server, what the server says about the model (`discover`), what was
 * learned while talking to it (a refusal, `learn`), the probe (lib/probe.js),
 * and what the reader set on the Models screen. Kept in this machine's
 * storage, apart from the rest of the app's (it is about servers, not
 * people), so it survives launches. */

import { isLocalUrl } from "./catalog.js";
import { httpFetch } from "./http.js";

export const DEFAULT_WINDOW = 8192;
// Ollama loads a model with room for this many tokens at most, whatever the
// model could take: a bigger window costs memory the model itself needs.
export const OLLAMA_MAX_CONTEXT = 32768;

const KEY = "blvrd.profiles";
const LAYERS = ["learned", "probe", "reader"];

const store = new Map(); // key -> { server, learned, probe, reader }
const jobs = new Map(); // key -> Promise (discovery under way)
const listeners = new Set();

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
function loadAll() {
  try {
    const raw = storage()?.getItem(KEY);
    for (const [key, value] of Object.entries(raw ? JSON.parse(raw) : {})) store.set(key, value);
  } catch {
    // Unreadable: start again; it is all asked for again on use.
  }
}
function saveAll() {
  try {
    storage()?.setItem(KEY, JSON.stringify(Object.fromEntries(store)));
  } catch {
    // Not kept between launches; still known now.
  }
}
loadAll();

const tell = () => {
  for (const fn of listeners) fn();
};

/** Hear when any profile changes (the Models screen). */
export function onProfiles(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const profileKey = (provider, model) => `${provider?.id}|${String(provider?.base || "").replace(/\/+$/, "")}|${model}`;

/* What a server is known to want before anything is asked. */
function defaultsFor(provider) {
  const mistral = provider?.id === "mistral" || /(^|\.)mistral\.ai/.test(hostname(provider?.base));
  return { window: null, vision: false, tools: null, ids: mistral ? "alnum9" : "any", emptyContent: false, plainSchemas: false };
}
function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The model's profile as it stands, with where its window came from. */
export function getProfile(provider, model) {
  const entry = store.get(profileKey(provider, model)) || {};
  const out = { ...defaultsFor(provider), windowFrom: null, toolsFrom: null };
  for (const [from, layer] of [["server", entry.server], ...LAYERS.map((l) => [l, entry[l]])]) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || v === null || k === "at") continue;
      out[k] = v;
      if (k === "window") out.windowFrom = from;
      if (k === "tools") out.toolsFrom = from;
    }
  }
  out.probedAt = entry.probe?.at || null;
  out.probeNote = entry.probe?.note || "";
  out.steps = entry.probe?.steps || null;
  return out;
}

function patchLayer(provider, model, layer, patch) {
  const key = profileKey(provider, model);
  const entry = { ...(store.get(key) || {}) };
  entry[layer] = patch === null ? undefined : { ...(entry[layer] || {}), ...patch, at: Date.now() };
  store.set(key, entry);
  saveAll();
  tell();
}

/** Something found out while talking to the model: a refusal of its tools,
 *  of null content, of the ids sent. */
export const learn = (provider, model, patch) => patchLayer(provider, model, "learned", patch);
/** What the probe found (lib/probe.js). */
export const setProbe = (provider, model, result) => patchLayer(provider, model, "probe", result);
/** What the reader set; null for a field goes back to automatic. */
export function setReader(provider, model, patch) {
  const key = profileKey(provider, model);
  const entry = { ...(store.get(key) || {}) };
  const reader = { ...(entry.reader || {}), ...patch };
  for (const [k, v] of Object.entries(reader)) if (v === null || v === "") delete reader[k];
  entry.reader = Object.keys(reader).length ? reader : undefined;
  store.set(key, entry);
  saveAll();
  tell();
}

/** Forget everything about every model (the tests). */
export function resetProfiles() {
  store.clear();
  jobs.clear();
  saveAll();
}

/** The window to plan with: what's known, or a careful default. */
export const windowOf = (profile) => profile?.window || DEFAULT_WINDOW;

/** The context Ollama is asked to load a model with. */
export const ollamaContext = (profile) => Math.min(windowOf(profile), OLLAMA_MAX_CONTEXT);

/** What a chat can really fill: for Ollama, what the model is loaded with
 *  (not what it was trained to take); elsewhere the window the server or the
 *  reader said, or null when nobody has. */
export const usableWindow = (provider, profile) => (provider?.kind === "ollama" ? ollamaContext(profile) : profile?.window || null);

/** Ask the server about the model, once per launch, and keep what it says.
 *  Never throws and never waits long: a server that doesn't say leaves the
 *  profile as it was. Resolves to the profile. */
export function discover(provider, model, { adapters = null, timeout = 4000 } = {}) {
  const key = profileKey(provider, model);
  if (!jobs.has(key)) {
    const job = withTimeout(ask(provider, model, adapters), timeout)
      .then((found) => {
        const clean = Object.fromEntries(Object.entries(found || {}).filter(([, v]) => v !== undefined && v !== null));
        if (Object.keys(clean).length) patchLayer(provider, model, "server", clean);
      })
      .catch(() => {});
    jobs.set(key, job);
  }
  return jobs.get(key).then(() => getProfile(provider, model));
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("no answer")), ms)))]).finally(() => clearTimeout(timer));
}

const trimBase = (base) => String(base || "").replace(/\/+$/, "");
const numberIn = (...values) => values.map(Number).find((n) => Number.isFinite(n) && n > 0) || null;

async function getJson(url, headers = {}) {
  const response = await httpFetch(url, { headers });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

async function ask(provider, model, adapters) {
  if (provider.kind === "ollama") return askOllama(provider, model);
  if (provider.kind === "anthropic") return adapters?.anthropic?.info ? adapters.anthropic.info(provider, model) : null;
  if (provider.kind === "openai") return askOpenAI(provider, model);
  return null;
}

/* Ollama: /api/show has the trained context length among the model's
 * details, and what it can do -- tools, vision -- among its capabilities. */
async function askOllama(provider, model) {
  const response = await httpFetch(`${trimBase(provider.base)}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const info = data.model_info || {};
  const lengthKey = Object.keys(info).find((k) => k.endsWith(".context_length"));
  // A context set in the Modelfile is what the model was made to run with.
  const set = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(data.parameters || "")?.[1];
  const caps = data.capabilities || null;
  return {
    window: numberIn(set, lengthKey && info[lengthKey]),
    vision: caps ? caps.includes("vision") : undefined,
    // No "tools" capability: its template has no way to make a call.
    tools: caps && !caps.includes("tools") ? "prompted" : undefined,
  };
}

/* OpenAI-compatible servers say it in different places, when they say it at
 * all: llama.cpp in /props, LM Studio in its own /api/v0/models, and the
 * others -- vLLM, OpenRouter, Groq, Together, Mistral -- in fields of their
 * /models entries. */
async function askOpenAI(provider, model) {
  const base = trimBase(provider.base);
  const root = base.replace(/\/v1$/, "");
  const headers = provider.key ? { Authorization: `Bearer ${provider.key}` } : {};
  const found = {};
  if (isLocalUrl(base)) {
    try {
      const props = await getJson(`${root}/props`, headers);
      found.window = numberIn(props.default_generation_settings?.n_ctx, props.n_ctx);
      if (props.modalities) found.vision = Boolean(props.modalities.vision);
    } catch {
      // Not llama.cpp.
    }
    if (!found.window) {
      try {
        const list = await getJson(`${root}/api/v0/models`, headers);
        const entry = (list.data || []).find((m) => m.id === model);
        if (entry) {
          found.window = numberIn(entry.loaded_context_length, entry.max_context_length);
          found.vision = entry.type === "vlm";
        }
      } catch {
        // Not LM Studio.
      }
    }
  }
  if (!found.window) {
    try {
      const data = await getJson(`${base}/models`, headers);
      const list = Array.isArray(data) ? data : data.data || data.models || [];
      const entry = list.find((m) => (m.id || m.name) === model) || list.find((m) => String(m.id || m.name || "").endsWith(`/${model}`));
      if (entry) {
        found.window = numberIn(
          entry.context_length,
          entry.context_window,
          entry.max_context_length,
          entry.max_model_len,
          entry.max_input_tokens,
          entry.inputTokenLimit,
          entry.top_provider?.context_length,
        );
        const modalities = entry.architecture?.input_modalities;
        if (modalities) found.vision = modalities.includes("image");
        else if (entry.capabilities?.vision != null) found.vision = Boolean(entry.capabilities.vision);
        // A server that says which parameters a model takes, and tools aren't
        // among them (OpenRouter), or that it can't call functions (Mistral).
        if (Array.isArray(entry.supported_parameters) && !entry.supported_parameters.includes("tools")) found.tools = "prompted";
        if (entry.capabilities?.function_calling === false) found.tools = "prompted";
      }
    } catch {
      // Says nothing; the reader or the probe can.
    }
  }
  return found;
}
