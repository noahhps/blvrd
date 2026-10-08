/* Google Workspace: Gmail, Calendar, Drive and Tasks, through Google's own
 * REST APIs, signed in as the reader.
 *
 * Google only lets an app sign people in with a client ID registered to it,
 * and blvrd has no Google-verified app of its own, so the reader brings one: a
 * "Desktop app" OAuth client from their own Google Cloud project (Settings
 * walks through it). Sign-in is the standard installed-app flow -- browser,
 * loopback redirect, PKCE -- and the refresh token keeps it signed in.
 *
 * Reading never asks. Anything that sends, creates or changes something is a
 * `confirm` tool, so the reader approves it in the chat first. */

import { failure, httpFetch } from "../http.js";
import { isStale, signIn, tokenRequest } from "../oauth.js";
import { htmlToText } from "../tools.js";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export const GOOGLE_SERVICES = [
  { id: "gmail", label: "Gmail", scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"] },
  { id: "calendar", label: "Calendar", scopes: ["https://www.googleapis.com/auth/calendar.events"] },
  { id: "drive", label: "Drive & Docs", scopes: ["https://www.googleapis.com/auth/drive.readonly"] },
  { id: "tasks", label: "Tasks", scopes: ["https://www.googleapis.com/auth/tasks"] },
];

const scopesFor = (services) => [
  "openid",
  "email",
  ...GOOGLE_SERVICES.filter((s) => services.includes(s.id)).flatMap((s) => s.scopes),
];

/** Signs in and returns { tokens, email, services }. */
export async function signInToGoogle({ clientId, clientSecret, services }) {
  if (!clientId) throw new Error("Add your Google client ID first.");
  const scope = scopesFor(services).join(" ");
  const { code, redirectUri, verifier } = await signIn((redirect, challenge, state) => {
    const url = new URL(AUTH);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope,
      code_challenge: challenge.challenge,
      code_challenge_method: challenge.method,
      state,
      access_type: "offline",
      prompt: "consent",
    }).toString();
    return url.toString();
  });
  const tokens = await tokenRequest(
    TOKEN,
    { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret || undefined, code_verifier: verifier },
    "Signing in to Google",
  );
  const email = emailFromIdToken(tokens.id_token);
  return { tokens, email, services: [...services] };
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || null;
  } catch {
    return null;
  }
}

/* -- calling Google ---------------------------------------------------------------- */

export function googleClient(config, saveTokens) {
  let tokens = config.tokens;

  async function token() {
    if (!tokens?.access_token) throw new Error("Google isn't signed in. Sign in under Connectors.");
    if (isStale(tokens)) {
      if (!tokens.refresh_token) throw new Error("Google's sign-in has expired. Sign in again under Connectors.");
      const fresh = await tokenRequest(
        TOKEN,
        { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: config.clientId, client_secret: config.clientSecret || undefined },
        "Refreshing Google",
      );
      tokens = { ...tokens, ...fresh };
      saveTokens(tokens);
    }
    return tokens.access_token;
  }

  async function api(url, { method = "GET", body, raw = false } = {}) {
    const response = await httpFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw await failure(response, "Google");
    return raw ? response.text() : response.json();
  }

  return { api };
}

/* -- Gmail helpers (pure, tested) ---------------------------------------------------- */

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

export function decodeBase64Url(data) {
  const bin = atob(String(data || "").replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A message's readable body: the plain-text part, or the HTML one as text. */
export function bodyOf(payload) {
  const parts = [];
  const walk = (p) => {
    if (!p) return;
    if (p.parts) p.parts.forEach(walk);
    else if (p.body?.data) parts.push({ type: p.mimeType, text: decodeBase64Url(p.body.data) });
  };
  walk(payload);
  const plain = parts.find((p) => p.type === "text/plain");
  if (plain) return plain.text;
  const html = parts.find((p) => p.type === "text/html");
  return html ? htmlToText(html.text) : "";
}

/** An RFC 822 message, base64url-encoded, for Gmail's drafts and send. */
export function rawMessage({ to, cc, subject, body, inReplyTo, references }) {
  const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`);
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeader(subject || "")}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body || "",
  ].filter((l) => l !== null);
  const bytes = new TextEncoder().encode(lines.join("\r\n"));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* -- the tools ------------------------------------------------------------------------ */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const TASKS = "https://tasks.googleapis.com/tasks/v1";

const obj = (properties, required = []) => ({ type: "object", properties, required });

/** The primary calendar's events overlapping [from, to), as Google sends them
 *  -- for the calendar widget, which counts them rather than reads them. */
export async function googleCalendarEvents(config, saveTokens, from, to) {
  const { api } = googleClient(config, saveTokens);
  const items = [];
  let pageToken;
  do {
    const params = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api(`${CAL}/calendars/primary/events?${params}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken && items.length < 1000);
  return items;
}

export function googleTools(config, saveTokens) {
  const services = config.services || [];
  const g = () => googleClient(config, saveTokens);
  const tools = [];

  if (services.includes("gmail")) {
    tools.push(
      {
        name: "gmail_search",
        label: "Search email",
        description: "Search the user's Gmail with Gmail search syntax (from:, to:, subject:, is:unread, newer_than:7d, ...). Returns up to 10 messages with sender, subject, date, a snippet and the id to read one.",
        parameters: obj({ query: { type: "string", description: "Gmail search, e.g. 'from:alex newer_than:14d'" }, max: { type: "integer", description: "1-20, default 10" } }, ["query"]),
        run: async ({ query, max = 10 }) => {
          const { api } = g();
          const list = await api(`${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(20, Math.max(1, max))) })}`);
          if (!list.messages?.length) return "No messages match.";
          const rows = await Promise.all(
            list.messages.map((m) => api(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)),
          );
          return rows
            .map((m) => `- id ${m.id} | ${header(m, "Date")} | from ${header(m, "From")} | ${header(m, "Subject")}\n  ${m.snippet}`)
            .join("\n");
        },
      },
      {
        name: "gmail_read",
        label: "Read an email",
        description: "Read one email in full by its id (from gmail_search).",
        parameters: obj({ id: { type: "string" } }, ["id"]),
        run: async ({ id }) => {
          const m = await g().api(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
          const body = bodyOf(m.payload).slice(0, 15000);
          return [`From: ${header(m, "From")}`, `To: ${header(m, "To")}`, `Date: ${header(m, "Date")}`, `Subject: ${header(m, "Subject")}`, `Message-ID: ${header(m, "Message-ID")}`, `Thread: ${m.threadId}`, "", body].join("\n");
        },
      },
      {
        name: "gmail_draft",
        label: "Draft an email",
        confirm: true,
        description: "Save an email as a draft in the user's Gmail -- nothing is sent. Prefer this to sending. To reply, pass reply_to_id (a message id) so it threads.",
        parameters: obj({ to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, cc: { type: "string" }, reply_to_id: { type: "string" } }, ["to", "subject", "body"]),
        summary: (a) => `Save a draft to ${a.to}: “${a.subject}”`,
        run: async (a) => {
          const { api } = g();
          let threadId;
          let threading = {};
          if (a.reply_to_id) {
            const orig = await api(`${GMAIL}/messages/${encodeURIComponent(a.reply_to_id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
            threadId = orig.threadId;
            const mid = header(orig, "Message-ID");
            threading = { inReplyTo: mid, references: [header(orig, "References"), mid].filter(Boolean).join(" ") };
          }
          const draft = await api(`${GMAIL}/drafts`, {
            method: "POST",
            body: { message: { raw: rawMessage({ ...a, ...threading }), ...(threadId ? { threadId } : {}) } },
          });
          return `Draft saved (id ${draft.id}). It is in Gmail's Drafts, not sent.`;
        },
      },
      {
        name: "gmail_send",
        label: "Send an email",
        confirm: true,
        description: "Send an email from the user's Gmail. Only when the user has clearly asked for it to be sent; otherwise use gmail_draft.",
        parameters: obj({ to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, cc: { type: "string" } }, ["to", "subject", "body"]),
        summary: (a) => `Send an email to ${a.to}: “${a.subject}”`,
        run: async (a) => {
          const sent = await g().api(`${GMAIL}/messages/send`, { method: "POST", body: { raw: rawMessage(a) } });
          return `Sent (id ${sent.id}).`;
        },
      },
    );
  }

  if (services.includes("calendar")) {
    tools.push(
      {
        name: "gcal_events",
        label: "Google Calendar: events",
        description: "List events on the user's Google Calendar between two times (ISO 8601, with time zone). Optional text search.",
        parameters: obj({ from: { type: "string" }, to: { type: "string" }, query: { type: "string" } }, ["from", "to"]),
        run: async ({ from, to, query }) => {
          const params = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
          if (query) params.set("q", query);
          const data = await g().api(`${CAL}/calendars/primary/events?${params}`);
          if (!data.items?.length) return "No events.";
          return data.items
            .map((e) => `- ${e.start?.dateTime || e.start?.date} → ${e.end?.dateTime || e.end?.date} | ${e.summary || "(no title)"}${e.location ? ` | ${e.location}` : ""}${e.attendees?.length ? ` | with ${e.attendees.map((x) => x.email).join(", ")}` : ""}`)
            .join("\n");
        },
      },
      {
        name: "gcal_add_event",
        label: "Google Calendar: add event",
        confirm: true,
        description: "Add an event to the user's Google Calendar. Times in ISO 8601 with a time zone offset. Attendees, if any, are invited by email.",
        parameters: obj({ title: { type: "string" }, start: { type: "string" }, end: { type: "string" }, location: { type: "string" }, description: { type: "string" }, attendees: { type: "string", description: "Comma-separated emails" } }, ["title", "start", "end"]),
        summary: (a) => `Add “${a.title}” to Google Calendar, ${new Date(a.start).toLocaleString()}${a.attendees ? ` and invite ${a.attendees}` : ""}`,
        run: async (a) => {
          const event = await g().api(`${CAL}/calendars/primary/events?sendUpdates=${a.attendees ? "all" : "none"}`, {
            method: "POST",
            body: {
              summary: a.title,
              location: a.location,
              description: a.description,
              start: { dateTime: new Date(a.start).toISOString() },
              end: { dateTime: new Date(a.end).toISOString() },
              attendees: a.attendees ? a.attendees.split(",").map((e) => ({ email: e.trim() })).filter((x) => x.email) : undefined,
            },
          });
          return `Added: ${event.htmlLink}`;
        },
      },
    );
  }

  if (services.includes("drive")) {
    tools.push(
      {
        name: "drive_search",
        label: "Search Drive",
        description: "Search the user's Google Drive by name and content. Returns files with their id, type and link.",
        parameters: obj({ query: { type: "string" } }, ["query"]),
        run: async ({ query }) => {
          const q = `(name contains '${query.replace(/'/g, "\\'")}' or fullText contains '${query.replace(/'/g, "\\'")}') and trashed = false`;
          const data = await g().api(`${DRIVE}/files?${new URLSearchParams({ q, pageSize: "10", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" })}`);
          if (!data.files?.length) return "No files match.";
          return data.files.map((f) => `- id ${f.id} | ${f.name} | ${f.mimeType} | modified ${f.modifiedTime} | ${f.webViewLink}`).join("\n");
        },
      },
      {
        name: "drive_read",
        label: "Read a Drive file",
        description: "Read a Google Doc, Sheet or text file from Drive by id, as text (Sheets as CSV, first sheet).",
        parameters: obj({ id: { type: "string" } }, ["id"]),
        run: async ({ id }) => {
          const { api } = g();
          const meta = await api(`${DRIVE}/files/${encodeURIComponent(id)}?fields=name,mimeType`);
          const exportAs = {
            "application/vnd.google-apps.document": "text/plain",
            "application/vnd.google-apps.spreadsheet": "text/csv",
            "application/vnd.google-apps.presentation": "text/plain",
          }[meta.mimeType];
          let text;
          if (exportAs) text = await api(`${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportAs)}`, { raw: true });
          else if (/^text\/|json|xml|csv/.test(meta.mimeType)) text = await api(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, { raw: true });
          else return `${meta.name} is a ${meta.mimeType}, which can't be read as text.`;
          return `${meta.name}\n\n${text.length > 20000 ? `${text.slice(0, 20000)}\n[...cut at 20,000 characters]` : text}`;
        },
      },
    );
  }

  if (services.includes("tasks")) {
    tools.push(
      {
        name: "gtasks_list",
        label: "Google Tasks: list",
        description: "The user's open Google Tasks, across their task lists.",
        parameters: obj({}),
        run: async () => {
          const { api } = g();
          const lists = await api(`${TASKS}/users/@me/lists`);
          const out = [];
          for (const l of lists.items || []) {
            const tasks = await api(`${TASKS}/lists/${l.id}/tasks?showCompleted=false&maxResults=100`);
            for (const t of tasks.items || []) out.push(`- [${l.title}] ${t.title}${t.due ? ` (due ${t.due.slice(0, 10)})` : ""}${t.notes ? ` -- ${t.notes}` : ""}`);
          }
          return out.join("\n") || "No open tasks.";
        },
      },
      {
        name: "gtasks_add",
        label: "Google Tasks: add",
        confirm: true,
        description: "Add a task to the user's default Google Tasks list.",
        parameters: obj({ title: { type: "string" }, due: { type: "string", description: "Date, YYYY-MM-DD" }, notes: { type: "string" } }, ["title"]),
        summary: (a) => `Add the task “${a.title}”${a.due ? `, due ${a.due}` : ""}`,
        run: async (a) => {
          const task = await g().api(`${TASKS}/lists/@default/tasks`, {
            method: "POST",
            body: { title: a.title, notes: a.notes, due: a.due ? new Date(`${a.due}T00:00:00Z`).toISOString() : undefined },
          });
          return `Added “${task.title}”.`;
        },
      },
    );
  }

  return tools;
}
