import { isLocalUrl } from "./catalog.js";
import { httpFetch } from "./http.js";

/* Finding where an OpenAI-compatible server really answers, from an address
 * as a person types or copies it: with or without http://, with or without
 * /v1. Each likely spelling is tried against its /models until one answers,
 * so a server is never added at an address that can't work. */

/** The addresses worth trying for `input`, most likely first. */
export function candidates(input) {
  const raw = String(input || "").trim().replace(/\/+$/, "");
  if (!raw) return [];
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let url;
  try {
    url = new URL(hasScheme ? raw : `http://${raw}`);
  } catch {
    return [];
  }
  const local = isLocalUrl(url.href);
  // A server on this computer or the network almost always speaks plain http;
  // one out on the internet, https. What was typed comes first either way.
  const schemes = hasScheme ? [url.protocol] : local ? ["http:"] : ["https:"];
  if (local) for (const s of ["http:", "https:"]) if (!schemes.includes(s)) schemes.push(s);
  const path = url.pathname.replace(/\/+$/, "");
  const paths = path ? [path] : ["/v1", ""];
  const out = [];
  for (const scheme of schemes)
    for (const p of paths) {
      const c = `${scheme}//${url.host}${p}`;
      if (!out.includes(c)) out.push(c);
    }
  return out;
}

/** { base } where the server answers -- or { base, problem } when it answers
 *  but turns the key down -- or { problem } when nothing answered. */
export async function findBase(input, key) {
  const tries = candidates(input);
  if (!tries.length) return { problem: "That isn't an address — it should look like 192.168.1.20:8080 or http://192.168.1.20:8080/v1" };
  let refused = null;
  for (const base of tries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await httpFetch(`${base}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      if (response.ok) return { base };
      if (response.status === 401 || response.status === 403) refused ||= base;
    } catch {
      // Not here; try the next spelling.
    } finally {
      clearTimeout(timer);
    }
  }
  if (refused) return { base: refused, problem: key ? "The server is there, but it turned the key down." : "The server is there, but it needs a key." };
  return { problem: "Nothing answered at that address. Check the server is running, and on a Mac that blvrd may use your network (System Settings → Privacy & Security → Local Network)." };
}
