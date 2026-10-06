/* Which models each server has, asked for once and remembered for the session.
 *
 * Local servers are asked with a short timeout: one that is not running
 * should read as "not running" in a second or two, not hang the picker. */

import { adapterFor } from "./providers.js";
import { CLAUDE_MODELS } from "./providers.js";

const cache = new Map(); // provider id -> Promise<{ models, error }>

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("no answer")), ms)),
  ]);
}

export function modelsOf(provider, { fresh = false } = {}) {
  const key = `${provider.id}|${provider.base}|${provider.key ? "k" : ""}`;
  if (!fresh && cache.has(key)) return cache.get(key);
  const local = !provider.keys;
  const job = withTimeout(adapterFor(provider).listModels(provider), local ? 2500 : 10000)
    .then((models) => ({ models: models.map((m) => m.id).sort(), error: null }))
    .catch((problem) => {
      // Claude's list needs a key; without one, offer the known models so the
      // picker is not empty, and let the first request say what is wrong.
      if (provider.kind === "anthropic") return { models: CLAUDE_MODELS, error: null };
      return { models: [], error: problem.message || String(problem) };
    });
  cache.set(key, job);
  return job;
}

export function forget(provider) {
  for (const key of cache.keys()) if (key.startsWith(`${provider.id}|`)) cache.delete(key);
}
