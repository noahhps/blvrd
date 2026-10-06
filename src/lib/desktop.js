/* The desktop app's own commands (src-tauri/src), for the webview.
 *
 * Each is only there inside the app; in a plain browser the call says so
 * rather than failing somewhere less obvious. */

import { inDesktop } from "./http.js";

export class DesktopOnly extends Error {
  constructor(what) {
    super(`${what} needs the desktop app.`);
  }
}

export async function invoke(command, args, what = "This") {
  if (!inDesktop()) throw new DesktopOnly(what);
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call(command, args);
}

export async function listen(event, handler) {
  if (!inDesktop()) return () => {};
  const { listen: on } = await import("@tauri-apps/api/event");
  return on(event, (e) => handler(e.payload));
}

export async function openInBrowser(url) {
  if (inDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank", "noopener");
}
