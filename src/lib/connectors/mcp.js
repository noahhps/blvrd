/* MCP: other apps' tools, through the Model Context Protocol.
 *
 * Two transports. A hosted server is spoken to over Streamable HTTP: each
 * JSON-RPC request is a POST, the answer comes back as JSON or as a short
 * server-sent-event stream, and the server may hand out a session id on
 * `initialize` that every later request carries. A local server is a command
 * the desktop app runs (src-tauri/src/mcp.rs) and talks to over stdin/stdout,
 * one JSON message per line.
 *
 * Hosted servers sign in one of three ways: not at all, with a token pasted
 * into Settings, or with OAuth -- discovered from the server itself, with
 * blvrd registering as its own client (lib/oauth.js). The tools a server
 * offers are listed once on connecting and kept, so agents can be given them
 * without the server being asked again until the reader refreshes. */

import { invoke, listen } from "../desktop.js";
import { failure, httpFetch } from "../http.js";
import { discover, isStale, register, signIn, tokenRequest } from "../oauth.js";
import { chunks, sse } from "../stream.js";

export const PROTOCOL = "2025-06-18";

export const MCP_PRESETS = [
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth", note: "Pages, databases and comments." },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth", note: "Issues, projects and cycles." },
  { id: "atlassian", name: "Jira & Confluence", url: "https://mcp.atlassian.com/v1/mcp", auth: "oauth", note: "Atlassian Cloud: issues and pages." },
  { id: "github", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", auth: "bearer", note: "Repositories, issues and pull requests.", tokenLabel: "Personal access token", tokenUrl: "https://github.com/settings/personal-access-tokens" },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth", note: "Errors and issues." },
  { id: "stripe", name: "Stripe", url: "https://mcp.stripe.com", auth: "oauth", note: "Payments, customers and invoices." },
  { id: "supabase", name: "Supabase", url: "https://mcp.supabase.com/mcp", auth: "oauth", note: "Databases and projects." },
  { id: "vercel", name: "Vercel", url: "https://mcp.vercel.com", auth: "oauth", note: "Deployments and projects." },
  { id: "huggingface", name: "Hugging Face", url: "https://huggingface.co/mcp", auth: "bearer", note: "Models, datasets and Spaces.", tokenLabel: "Access token (optional)", tokenUrl: "https://huggingface.co/settings/tokens", tokenOptional: true },
  { id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", auth: "none", note: "Questions about public GitHub repositories." },
  {
    id: "filesystem",
    name: "Files in a folder",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    needsFolder: true,
    note: "Read and write files in one folder you choose. Needs Node.js.",
  },
];

/* Tool names an agent sees: the server's name and the tool's, made safe for
   every provider (letters, digits, _ and -, at most 64 characters). */
export function toolNameFor(server, tool) {
  const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${clean(server.name || server.id)}__${clean(tool)}`.slice(0, 64);
}

class RpcError extends Error {
  constructor(error) {
    super(error?.message || "The server returned an error.");
    this.code = error?.code;
  }
}

export class NeedsSignIn extends Error {
  constructor(server, wwwAuthenticate) {
    super(`${server.name} needs you to sign in.`);
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

/* -- HTTP ---------------------------------------------------------------------------- */

class HttpClient {
  constructor(server, { getTokens, saveTokens }) {
    this.server = server;
    this.getTokens = getTokens;
    this.saveTokens = saveTokens;
    this.session = null;
    this.nextId = 1;
  }

  async authHeader() {
    const s = this.server;
    if (s.auth === "bearer" && s.token) return { Authorization: `Bearer ${s.token}` };
    if (s.auth !== "oauth") return {};
    let tokens = this.getTokens();
    if (!tokens?.access_token) throw new NeedsSignIn(s);
    if (isStale(tokens) && tokens.refresh_token && s.oauth?.tokenEndpoint) {
      tokens = await tokenRequest(
        s.oauth.tokenEndpoint,
        { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: s.oauth.clientId, resource: s.oauth.resource },
        `Refreshing ${s.name}`,
      ).then((t) => ({ refresh_token: tokens.refresh_token, ...t }));
      this.saveTokens(tokens);
    }
    return { Authorization: `Bearer ${tokens.access_token}` };
  }

  async post(message) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
      ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      ...(await this.authHeader()),
    };
    const response = await httpFetch(this.server.url, { method: "POST", headers, body: JSON.stringify(message) });
    if (response.status === 401) throw new NeedsSignIn(this.server, response.headers.get("www-authenticate"));
    if (!response.ok && response.status !== 202) throw await failure(response, this.server.name);
    const session = response.headers.get("mcp-session-id");
    if (session) this.session = session;
    return response;
  }

  async request(method, params) {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/event-stream")) {
      for await (const { data } of sse(chunks(response.body))) {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          continue;
        }
        if (msg.id === id) {
          if (msg.error) throw new RpcError(msg.error);
          return msg.result;
        }
      }
      throw new Error(`${this.server.name} closed the stream without answering.`);
    }
    const msg = await response.json();
    const reply = Array.isArray(msg) ? msg.find((m) => m.id === id) : msg;
    if (reply?.error) throw new RpcError(reply.error);
    return reply?.result;
  }

  async notify(method, params) {
    await this.post({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  close() {
    this.session = null;
  }
}

/* -- stdio --------------------------------------------------------------------------- */

/* A local server. Each start is a run of its own (`run`), and only that run's
 * lines and exit are heard: a server started again under the same id stops
 * the one before, whose exit is no news to this one. `onExit` hears when it
 * really has gone, so the connection is opened afresh next time. */
class StdioClient {
  constructor(server) {
    this.server = server;
    this.run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.nextId = 1;
    this.pending = new Map();
    this.log = [];
    this.unlisten = [];
    this.gone = null; // why it stopped, once it has
    this.onExit = null;
  }

  async start() {
    const id = this.server.id;
    const mine = (from, run) => from === id && run === this.run;
    this.unlisten.push(
      await listen("mcp-stdio", ({ id: from, run, line }) => {
        if (!mine(from, run)) return;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // a server printing something that isn't JSON-RPC
        }
        const waiter = msg.id != null ? this.pending.get(msg.id) : null;
        if (waiter) {
          this.pending.delete(msg.id);
          msg.error ? waiter.reject(new RpcError(msg.error)) : waiter.resolve(msg.result);
        } else if (msg.id != null && msg.method) {
          // A request from the server (sampling, roots...): politely decline.
          this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Not supported by blvrd" } });
        }
      }),
      await listen("mcp-stdio-log", ({ id: from, run, line }) => {
        if (mine(from, run)) this.log = [...this.log.slice(-20), line];
      }),
      await listen("mcp-stdio-exit", ({ id: from, run }) => {
        if (!mine(from, run)) return;
        // A Node crash ends "}", "", "Node.js v…": say its error line instead.
        const why = (this.log.findLast((l) => /^\w*Error\b.*:/.test(l.trim())) || this.log.slice(-3).join(" ")).trim();
        this.gone = new Error(`${this.server.name} stopped${why ? `: ${why}` : "."}`);
        for (const w of this.pending.values()) w.reject(this.gone);
        this.pending.clear();
        this.unlisten.forEach((u) => u());
        this.onExit?.();
      }),
    );
    await invoke(
      "mcp_spawn",
      { id, run: this.run, command: this.server.command, args: this.server.args || [], env: this.server.env || {} },
      "A local MCP server",
    );
  }

  send(message) {
    return invoke("mcp_send", { id: this.server.id, line: JSON.stringify(message) });
  }

  request(method, params, timeoutMs = 60_000) {
    if (this.gone) return Promise.reject(this.gone);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.server.name} didn't answer ${method}.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }).catch((e) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      });
    });
  }

  notify(method, params) {
    return this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  close() {
    this.unlisten.forEach((u) => u());
    // Only this run: the same id may already be a newer one.
    invoke("mcp_stop", { id: this.server.id, run: this.run }).catch(() => {});
  }
}

/* -- connections ----------------------------------------------------------------------- */

const open = new Map(); // server id -> Promise<client>

/* `onExit`: a local server's process ended -- the connection is dead, and
   the next use should start it again rather than talk to nothing. */
async function connect(server, store, onExit = null) {
  const client =
    server.transport === "stdio"
      ? new StdioClient(server)
      : new HttpClient(server, {
          getTokens: () => store.get(server.id)?.oauth?.tokens,
          saveTokens: (tokens) => store.patch(server.id, (s) => ({ oauth: { ...s.oauth, tokens } })),
        });
  client.onExit = onExit;
  try {
    if (client.start) await client.start();
    client.info = await handshake(client);
  } catch (problem) {
    // Nothing left running that the next try would have to stop.
    client.close?.();
    throw problem;
  }
  return client;
}

async function handshake(client) {
  const info = await client.request("initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "blvrd", version: "0.1.0" },
  });
  await client.notify("notifications/initialized");
  return info;
}

/** A live connection to `server`, opened on first use and kept. */
export function clientFor(server, store) {
  const key = `${server.id}|${server.url || server.command}|${server.token || ""}`;
  if (!open.has(key)) {
    const forget = () => open.get(key) === job && open.delete(key);
    const job = connect(server, store, forget).catch((e) => {
      forget();
      throw e;
    });
    open.set(key, job);
  }
  return open.get(key);
}

export function disconnect(serverId) {
  for (const [key, job] of open) {
    if (!key.startsWith(`${serverId}|`)) continue;
    open.delete(key);
    job.then((c) => c.close()).catch(() => {});
  }
}

/** Every tool the server offers, following pagination. */
export async function listTools(server, store) {
  const client = await clientFor(server, store);
  const tools = [];
  let cursor;
  do {
    const page = await client.request("tools/list", cursor ? { cursor } : {});
    tools.push(...(page?.tools || []));
    cursor = page?.nextCursor;
  } while (cursor);
  return tools.map((t) => ({
    name: t.name,
    title: t.title || t.annotations?.title || t.name,
    description: t.description || "",
    inputSchema: t.inputSchema || { type: "object", properties: {} },
    readOnly: Boolean(t.annotations?.readOnlyHint),
  }));
}

/** A tool's result as text a model can read. */
export function resultText(result) {
  const parts = (result?.content || []).map((c) => {
    if (c.type === "text") return c.text;
    if (c.type === "resource") return c.resource?.text || `[resource ${c.resource?.uri}]`;
    if (c.type === "resource_link") return `[${c.name || c.uri}](${c.uri})`;
    if (c.type === "image") return "[an image]";
    return `[${c.type}]`;
  });
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n").trim() || "(no output)";
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[...cut at 20,000 characters]` : text;
}

export async function callTool(server, store, name, args) {
  const client = await clientFor(server, store);
  const result = await client.request("tools/call", { name, arguments: args || {} });
  if (result?.isError) throw new Error(resultText(result));
  return resultText(result);
}

/* -- signing in ------------------------------------------------------------------------- */

/** OAuth for a hosted server: discover, register, sign in, keep the tokens. */
export async function signInTo(server, store) {
  // Ask once without a token, so the server can say where its sign-in lives.
  let wwwAuthenticate = null;
  try {
    const probe = await httpFetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "blvrd", version: "0.1.0" } } }),
    });
    wwwAuthenticate = probe.headers.get("www-authenticate");
  } catch {
    // Discovery falls back to the well-known paths.
  }
  const { resource, scopes, meta } = await discover(server.url, wwwAuthenticate);
  let clientId = null;
  const { code, redirectUri, verifier } = await signIn(async (redirect, challenge, state) => {
    const client = await register(meta, redirect);
    clientId = client.client_id;
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challenge.challenge,
      code_challenge_method: challenge.method,
      state,
      resource,
      ...(scopes?.length ? { scope: scopes.join(" ") } : {}),
    }).toString();
    return url.toString();
  });
  const tokens = await tokenRequest(
    meta.token_endpoint,
    { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource },
    `Signing in to ${server.name}`,
  );
  disconnect(server.id);
  return { clientId, tokenEndpoint: meta.token_endpoint, resource, tokens };
}

// Exported for the tests.
export const _internals = { HttpClient };
