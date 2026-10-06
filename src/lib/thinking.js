/* How hard a model can be asked to think -- the composer's reasoning control.
 *
 * As in Bom, the families disagree about what "think harder" even is: an
 * effort word, an on/off switch, or nothing. The control is worked out from
 * the server and the model rather than from a list of model names where it
 * can be: Ollama says whether a model thinks (`/api/show` capabilities). For
 * the hosted APIs the model's family decides.
 *
 *   { mode: "effort", options, default, label }
 *   { mode: "switch", default, label }
 *   { mode: "none" }
 */

import { failure, httpFetch } from "./http.js";

const NONE = { mode: "none" };
const EFFORT = (fallback = "medium") => ({ mode: "effort", options: ["low", "medium", "high"], default: fallback, label: "Effort" });
const cache = new Map();

export async function controlFor(provider, model) {
  if (!provider || !model) return NONE;
  const key = `${provider.id}|${provider.base}|${model}`;
  if (!cache.has(key)) cache.set(key, work(provider, model).catch(() => NONE));
  return cache.get(key);
}

async function work(provider, model) {
  if (provider.kind === "anthropic") {
    // Haiku 4.5 rejects effort; the current Opus, Sonnet and Fable take it.
    return /^claude-(opus|sonnet-5|fable|mythos)/.test(model) ? EFFORT("medium") : NONE;
  }
  if (provider.kind === "openai") {
    if (provider.id === "openai" && /^(o\d|gpt-5)/.test(model)) return EFFORT("medium");
    if (/gpt-oss/i.test(model)) return EFFORT("medium");
    return NONE;
  }
  if (provider.kind === "ollama") {
    const response = await httpFetch(`${provider.base.replace(/\/+$/, "")}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) throw await failure(response, provider.name);
    const data = await response.json();
    if (!(data.capabilities || []).includes("thinking")) return NONE;
    // gpt-oss takes a level; every other thinking model on Ollama a switch.
    return /gpt-oss/i.test(model) ? EFFORT("medium") : { mode: "switch", default: true, label: "Think" };
  }
  return NONE;
}

/* The request fields for a chosen value, per protocol. */
export function thinkingFields(kind, control, value) {
  if (!control || control.mode === "none" || value == null) return {};
  if (kind === "ollama") return { think: value };
  if (kind === "openai") return control.mode === "effort" ? { reasoning_effort: value } : {};
  if (kind === "anthropic") return control.mode === "effort" ? { output_config: { effort: value } } : {};
  return {};
}
