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
