/* One fetch for everything that leaves the webview.
 *
 * Inside the desktop app requests go through the Tauri HTTP plugin, which runs
 * them in Rust: no CORS, so a llama.cpp or LM Studio server that never sends
 * Access-Control headers still answers, and the body still streams. In a plain
 * browser (the Vite dev server) it is the page's own fetch, which is enough for
 * Ollama -- it allows browser origins by default -- and for development.
 */

let pluginFetch = null;

export function inDesktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function httpFetch(input, init) {
  if (inDesktop()) {
    if (!pluginFetch) pluginFetch = (await import("@tauri-apps/plugin-http")).fetch;
    return pluginFetch(input, init);
  }
  return fetch(input, init);
}

const BUSY = new Set([429, 503]);

function sleep(ms, signal) {
  return new Promise((done, fail) => {
    if (signal?.aborted) return fail(signal.reason || new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), fail(signal.reason || new DOMException("Aborted", "AbortError"))), { once: true });
  });
}

/** How long a busy server asked to be left: Retry-After in seconds or as a
 *  date, or a wait that doubles with each try. */
export function waitFor(response, attempt) {
  const after = response.headers?.get?.("retry-after");
  let ms = after == null ? NaN : /^\d+(\.\d+)?$/.test(after.trim()) ? Number(after) * 1000 : Date.parse(after) - Date.now();
  if (!Number.isFinite(ms) || ms < 0) ms = 2000 * 2 ** attempt;
  return ms;
}

/** A request sent again when the server says it is busy (429, 503) -- a free
 *  tier's per-minute limit, a local server still loading -- after the wait it
 *  asks for, up to `tries` more times. A wait longer than `maxWait` isn't
 *  sat through: the busy answer is returned and reported. */
export async function fetchPatiently(url, init = {}, { tries = 3, maxWait = 60_000, onWait = null } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await httpFetch(url, init);
    if (!BUSY.has(response.status) || attempt >= tries) return response;
    const ms = waitFor(response, attempt);
    if (ms > maxWait) return response;
    try {
      await response.body?.cancel?.();
    } catch {
      // Nothing to let go of.
    }
    onWait?.(ms);
    await sleep(ms, init.signal);
  }
}

/** The body of a failed response, as one readable line. */
export async function failure(response, label) {
  let detail = "";
  try {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      detail = data.error?.message || data.error || data.message || text;
    } catch {
      detail = text;
    }
  } catch {
    // An unreadable body still has a status worth reporting.
  }
  detail = String(detail || "").trim().slice(0, 300);
  return new Error(`${label} answered ${response.status}${detail ? `: ${detail}` : ""}`);
}
