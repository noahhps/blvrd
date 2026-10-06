/* Signing in with OAuth from a desktop app: PKCE, a loopback redirect, and
 * the token exchange.
 *
 * The flow: Rust opens a one-shot listener on 127.0.0.1 (oauth_listen), the
 * reader's browser is sent to the sign-in page with that address as the
 * redirect, and the code comes back to the listener. No client secret is
 * relied on -- PKCE is what proves the code is ours -- though Google's
 * desktop clients still send theirs.
 *
 * Also the discovery MCP servers use (RFC 9728 and RFC 8414) and dynamic
 * client registration (RFC 7591), so a hosted MCP server can be connected
 * with nothing but its URL. */

import { invoke, listen, openInBrowser } from "./desktop.js";
import { failure, httpFetch } from "./http.js";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function randomString(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkce() {
  const verifier = randomString(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest), method: "S256" };
}

/* A listener for one sign-in, and the address to send the browser back to. */
export async function loopback() {
  const port = await invoke("oauth_listen", {}, "Signing in");
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  let stop = () => {};
  const result = new Promise((resolve, reject) => {
    listen("oauth-callback", (payload) => {
      if (payload.port !== port) return;
      stop();
      if (payload.error) return reject(new Error("The sign-in wasn't finished in time."));
      resolve(new URLSearchParams(payload.query || ""));
    }).then((unlisten) => (stop = unlisten));
  });
  return { port, redirectUri, result };
}

/**
 * The whole browser round trip: open `authorizeUrl(redirectUri, pkce, state)`
 * and wait for the code. Returns { code, redirectUri, verifier }.
 * `authorizeUrl` may be async -- an MCP server registers blvrd for this exact
 * redirect first, which can only happen once the listener's port is known.
 */
export async function signIn(authorizeUrl) {
  const { redirectUri, result } = await loopback();
  const challenge = await pkce();
  const state = randomString(16);
  await openInBrowser(await authorizeUrl(redirectUri, challenge, state));
  const params = await result;
  if (params.get("error")) {
    throw new Error(params.get("error_description") || `The sign-in was refused (${params.get("error")}).`);
  }
  if (params.get("state") !== state) throw new Error("The sign-in came back for a different request.");
  const code = params.get("code");
  if (!code) throw new Error("The sign-in came back without a code.");
  return { code, redirectUri, verifier: challenge.verifier };
}

/* A token endpoint call (form-encoded, as the spec has it). Returns the
   tokens with `expires_at` worked out, so callers don't keep the clock. */
export async function tokenRequest(endpoint, params, label = "The sign-in") {
  const response = await httpFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString(),
  });
  if (!response.ok) throw await failure(response, label);
  const tokens = await response.json();
  return {
    ...tokens,
    expires_at: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null,
  };
}

/** Whether a token needs refreshing in the next minute. */
export const isStale = (tokens) => Boolean(tokens?.expires_at) && tokens.expires_at - Date.now() < 60_000;

/* -- MCP authorization discovery -------------------------------------------------- */

/** The resource-metadata URL a 401's WWW-Authenticate header points at, if any. */
export function resourceMetadataFrom(header) {
  const m = /resource_metadata="?([^",\s]+)"?/i.exec(header || "");
  return m ? m[1] : null;
}

async function getJson(url) {
  const response = await httpFetch(url, { headers: { Accept: "application/json" } });
  return response.ok ? response.json() : null;
}

/**
 * Where a server's sign-in lives: its protected-resource metadata (from the
 * 401, or the well-known path), then that authorization server's metadata.
 */
export async function discover(serverUrl, wwwAuthenticate) {
  const url = new URL(serverUrl);
  const candidates = [
    resourceMetadataFrom(wwwAuthenticate),
    `${url.origin}/.well-known/oauth-protected-resource${url.pathname.replace(/\/$/, "")}`,
    `${url.origin}/.well-known/oauth-protected-resource`,
  ].filter(Boolean);
  let resource = null;
  for (const c of candidates) {
    resource = await getJson(c).catch(() => null);
    if (resource) break;
  }
  const issuer = resource?.authorization_servers?.[0] || url.origin;
  const is = new URL(issuer);
  const path = is.pathname.replace(/\/$/, "");
  const metaUrls = [
    `${is.origin}/.well-known/oauth-authorization-server${path}`,
    `${is.origin}/.well-known/openid-configuration${path}`,
    `${is.origin}${path}/.well-known/openid-configuration`,
  ];
  let meta = null;
  for (const m of metaUrls) {
    meta = await getJson(m).catch(() => null);
    if (meta?.authorization_endpoint) break;
  }
  if (!meta?.authorization_endpoint) throw new Error(`${url.host} doesn't say how to sign in.`);
  return { resource: resource?.resource || `${url.origin}${url.pathname}`, scopes: resource?.scopes_supported, meta };
}

/** Registers blvrd as a client of an authorization server (RFC 7591). */
export async function register(meta, redirectUri) {
  if (!meta.registration_endpoint) {
    throw new Error("This server doesn't let apps register themselves, so it can't be signed in to from here yet.");
  }
  const response = await httpFetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "blvrd",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) throw await failure(response, "Registering with the server");
  return response.json();
}
