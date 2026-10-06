import { useState } from "react";

import { apple } from "../lib/connectors/apple.js";
import { GOOGLE_SERVICES, signInToGoogle } from "../lib/connectors/google.js";
import { haApi } from "../lib/connectors/homeassistant.js";
import { mcpStore } from "../lib/connectors/index.js";
import { MCP_PRESETS, disconnect, listTools, NeedsSignIn, signInTo } from "../lib/connectors/mcp.js";
import { inDesktop } from "../lib/http.js";
import { newId } from "../lib/store.js";
import { BrandLogo } from "./BrandLogo.jsx";
import { Icon } from "./Icon.jsx";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/* What agents can reach besides talking: the reader's accounts and apps.
 *
 * Each connector is off until set up here. Once on, its tools can be given to
 * any agent (Customize → Abilities). Reading is free; anything that sends,
 * adds, changes or switches something asks the reader in the chat first --
 * "Always allow" there is remembered per tool and listed at the foot of this
 * page, where it can be taken back. */
export function Connectors({ connectors, patchConnectors, getConnectors }) {
  const desktop = inDesktop();
  return (
    <div className="settings">
      <header>
        <h1>Connectors</h1>
        <p>
          Give agents your mail, calendar, documents, home and work tools. Each one is off until you connect it here, and
          an agent only gets it if you tick it under Customize → Abilities. Anything that sends, adds or changes something
          asks you in the chat first.
        </p>
        {!desktop ? <p className="hint warn">Signing in and the Mac connectors need the desktop app (npm run tauri:dev).</p> : null}
      </header>

      <Google config={connectors.google} patchConnectors={patchConnectors} />
      <Apple config={connectors.apple} patchConnectors={patchConnectors} />
      <HomeAssistant config={connectors.homeassistant} patchConnectors={patchConnectors} />
      <Mcp servers={connectors.mcp || []} patchConnectors={patchConnectors} getConnectors={getConnectors} />
      <Allowed allow={connectors.allow || {}} patchConnectors={patchConnectors} />
    </div>
  );
}

function Status({ state }) {
  if (!state) return null;
  if (state.busy) return <span className="status">{state.busy}</span>;
  if (state.error) return <p className="hint warn">{state.error}</p>;
  if (state.ok) return <span className="status on">{state.ok}</span>;
  return null;
}

/* -- Google ------------------------------------------------------------------------- */

function Google({ config, patchConnectors }) {
  const c = config || {};
  const [clientId, setClientId] = useState(c.clientId || "");
  const [clientSecret, setClientSecret] = useState(c.clientSecret || "");
  const [services, setServices] = useState(c.services || ["gmail", "calendar", "drive", "tasks"]);
  const [state, setState] = useState(null);
  const signedIn = Boolean(c.tokens?.access_token);

  const connect = async () => {
    setState({ busy: "Waiting for you in the browser…" });
    try {
      const result = await signInToGoogle({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), services });
      patchConnectors(() => ({ google: { clientId: clientId.trim(), clientSecret: clientSecret.trim(), ...result } }));
      setState({ ok: "Connected" });
    } catch (e) {
      setState({ error: e.message });
    }
  };

  return (
    <section className="card connector">
      <div className="card-head">
        <h2 className="with-logo"><BrandLogo id="google" size={18} />Google Workspace</h2>
        {signedIn ? <span className="status on">Connected as {c.email || "your account"}</span> : null}
      </div>
      <p className="hint">Gmail, Google Calendar, Drive and Docs, and Tasks -- through your own Google account.</p>

      {signedIn ? (
        <div className="connector-row">
          <span className="hint">{GOOGLE_SERVICES.filter((s) => c.services?.includes(s.id)).map((s) => s.label).join(" · ")}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={connect}>Sign in again</button>
          <button type="button" className="btn" onClick={() => patchConnectors(() => ({ google: { ...c, tokens: null, email: null } }))}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <details className="howto">
            <summary>How to get a client ID (once, about 5 minutes)</summary>
            <ol>
              <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud → Credentials</a> and make a project if asked.</li>
              <li>Turn on the APIs you want: <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Gmail</a>, <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Calendar</a>, <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Drive</a>, <a href="https://console.cloud.google.com/apis/library/tasks.googleapis.com" target="_blank" rel="noreferrer">Tasks</a>.</li>
              <li>Under OAuth consent screen, choose External and add yourself as a test user.</li>
              <li>Create credentials → OAuth client ID → <strong>Desktop app</strong>. Paste its client ID and secret below.</li>
            </ol>
            <p className="hint">Your sign-in goes straight from your browser to Google and back to this computer. Nothing passes through anyone else.</p>
          </details>
          <div className="field-row">
            <input type="text" value={clientId} placeholder="Client ID (….apps.googleusercontent.com)" aria-label="Google client ID" spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
            <input type="password" value={clientSecret} placeholder="Client secret" aria-label="Google client secret" autoComplete="off" onChange={(e) => setClientSecret(e.target.value)} />
          </div>
          <div className="connector-row">
            {GOOGLE_SERVICES.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={services.includes(s.id)}
                  onChange={() => setServices((v) => (v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id]))}
                />
                <BrandLogo id={s.id} size={14} tile={false} />
                <span>{s.label}</span>
              </label>
            ))}
            <span className="spacer" />
            <button type="button" className="btn primary" disabled={!clientId.trim() || !services.length || !inDesktop()} onClick={connect}>
              Sign in with Google
            </button>
          </div>
        </>
      )}
      <Status state={state} />
    </section>
  );
}

/* -- Apple ---------------------------------------------------------------------------- */

function Apple({ config, patchConnectors }) {
  const c = config || { enabled: false, calendar: true, reminders: true };
  const [state, setState] = useState(null);
  const set = (patch) => patchConnectors(() => ({ apple: { ...c, ...patch } }));

  const test = async () => {
    setState({ busy: "Asking Calendar… macOS may ask you to allow blvrd." });
    try {
      const cals = await apple("calendar_list");
      setState({ ok: `Calendar works: ${cals.length} calendar${cals.length === 1 ? "" : "s"}` });
    } catch (e) {
      setState({ error: e.message });
    }
  };

  return (
    <section className="card connector">
      <div className="card-head">
        <h2 className="with-logo"><BrandLogo id="apple" size={18} />Apple Calendar & Reminders</h2>
        <label className="switch" title={c.enabled ? "On" : "Off"}>
          <input type="checkbox" checked={Boolean(c.enabled)} disabled={!isMac} onChange={(e) => set({ enabled: e.target.checked })} />
          <span />
        </label>
      </div>
      <p className="hint">
        {isMac
          ? "The calendars and reminder lists on this Mac -- iCloud, Google, Exchange, whatever Calendar and Reminders are signed in to."
          : "Only on a Mac."}
      </p>
      {c.enabled ? (
        <div className="connector-row">
          <label className="check">
            <input type="checkbox" checked={c.calendar !== false} onChange={(e) => set({ calendar: e.target.checked })} />
            <span>Calendar</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={c.reminders !== false} onChange={(e) => set({ reminders: e.target.checked })} />
            <span>Reminders</span>
          </label>
          <span className="spacer" />
          <button type="button" className="btn" onClick={test} disabled={!inDesktop()}>Check access</button>
        </div>
      ) : null}
      <Status state={state} />
    </section>
  );
}

/* -- Home Assistant --------------------------------------------------------------------- */

function HomeAssistant({ config, patchConnectors }) {
  const c = config || { url: "", token: "", ask: true, enabled: false };
  const [url, setUrl] = useState(c.url || "http://homeassistant.local:8123");
  const [token, setToken] = useState(c.token || "");
  const [state, setState] = useState(null);

  const connect = async () => {
    setState({ busy: "Connecting…" });
    const next = { ...c, url: url.trim().replace(/\/+$/, ""), token: token.trim() };
    try {
      const info = await haApi(next, "/config");
      patchConnectors(() => ({ homeassistant: { ...next, enabled: true, name: info.location_name } }));
      setState({ ok: `Connected to ${info.location_name || "Home Assistant"}` });
    } catch (e) {
      setState({ error: e.message });
    }
  };

  return (
    <section className="card connector">
      <div className="card-head">
        <h2 className="with-logo"><BrandLogo id="homeassistant" size={18} />Home Assistant</h2>
        {c.enabled ? <span className="status on">Connected{c.name ? ` to ${c.name}` : ""}</span> : null}
      </div>
      <p className="hint">
        Lights, heating, locks, blinds, media and scenes -- anything in your Home Assistant. Make a token in Home Assistant under
        your profile → Security → Long-lived access tokens.
      </p>
      <div className="field-row">
        <input type="text" value={url} placeholder="http://homeassistant.local:8123" aria-label="Home Assistant address" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
        <input type="password" value={token} placeholder="Long-lived access token" aria-label="Home Assistant token" autoComplete="off" onChange={(e) => setToken(e.target.value)} />
      </div>
      <div className="connector-row">
        <label className="check">
          <input type="checkbox" checked={c.ask !== false} onChange={(e) => patchConnectors(() => ({ homeassistant: { ...c, ask: e.target.checked } }))} />
          <span>Ask before controlling a device</span>
        </label>
        <span className="spacer" />
        {c.enabled ? (
          <button type="button" className="btn" onClick={() => patchConnectors(() => ({ homeassistant: { ...c, enabled: false } }))}>Disconnect</button>
        ) : null}
        <button type="button" className="btn primary" disabled={!url.trim() || !token.trim()} onClick={connect}>
          {c.enabled ? "Reconnect" : "Connect"}
        </button>
      </div>
      <Status state={state} />
    </section>
  );
}

/* -- MCP ------------------------------------------------------------------------------- */

function Mcp({ servers, patchConnectors, getConnectors }) {
  const [states, setStates] = useState({});
  const [custom, setCustom] = useState({ kind: "url", name: "", url: "", token: "", command: "" });
  const [tokenFor, setTokenFor] = useState(null); // preset waiting for a token
  const [tokenValue, setTokenValue] = useState("");
  const [folderFor, setFolderFor] = useState(null);
  const [folder, setFolder] = useState("");
  const store = mcpStore(getConnectors, patchConnectors);
  const setState = (id, s) => setStates((all) => ({ ...all, [id]: s }));

  /* Connect: sign in if the server needs it, then list its tools. */
  const connect = async (server) => {
    setState(server.id, { busy: "Connecting…" });
    try {
      let current = store.get(server.id) || server;
      if (current.auth === "oauth" && !current.oauth?.tokens?.access_token) {
        setState(server.id, { busy: "Waiting for you in the browser…" });
        const oauth = await signInTo(current, store);
        store.patch(server.id, () => ({ oauth }));
        current = { ...current, oauth };
      }
      setState(server.id, { busy: "Listing tools…" });
      const tools = await listTools(current, store);
      store.patch(server.id, () => ({ tools, enabled: true }));
      setState(server.id, { ok: `${tools.length} tool${tools.length === 1 ? "" : "s"}` });
    } catch (e) {
      if (e instanceof NeedsSignIn && server.auth !== "bearer") {
        store.patch(server.id, (s) => ({ auth: "oauth", oauth: { ...s.oauth, tokens: null } }));
        setState(server.id, { error: `${server.name} needs you to sign in -- press Connect again.` });
      } else {
        setState(server.id, { error: e.message });
      }
    }
  };

  const add = (fields) => {
    const server = { id: newId("mcp"), enabled: false, tools: [], transport: "http", auth: "none", ...fields };
    patchConnectors((c) => ({ mcp: [...(c.mcp || []), server] }));
    // The store reads the latest state, which now includes the new server.
    setTimeout(() => connect(server), 0);
  };

  const addPreset = (preset) => {
    if (preset.needsFolder) return setFolderFor(preset);
    if (preset.auth === "bearer" && !preset.tokenOptional) return setTokenFor(preset);
    add({ name: preset.name, url: preset.url, auth: preset.auth, preset: preset.id });
  };

  const remove = (server) => {
    disconnect(server.id);
    patchConnectors((c) => ({ mcp: c.mcp.filter((s) => s.id !== server.id) }));
  };

  const have = new Set(servers.map((s) => s.preset).filter(Boolean));

  return (
    <section className="card connector">
      <div className="card-head">
        <h2 className="with-logo"><BrandLogo id="mcp" size={18} />Work tools (MCP)</h2>
      </div>
      <p className="hint">
        Apps that offer their tools over the Model Context Protocol. Hosted ones sign in in your browser; local ones run as a
        command on this computer.
      </p>

      {servers.length ? (
        <ul className="servers">
          {servers.map((s) => (
            <li key={s.id} className="server">
              <label className="switch" title={s.enabled ? "On" : "Off"}>
                <input type="checkbox" checked={Boolean(s.enabled)} onChange={(e) => store.patch(s.id, () => ({ enabled: e.target.checked }))} />
                <span />
              </label>
              <BrandLogo id={s.preset} name={s.name} size={16} />
              <span className="server-main">
                <span className="server-top">
                  <span className="server-name">{s.name}</span>
                  {states[s.id] ? <Status state={states[s.id]} /> : s.tools?.length ? <span className="status on">{s.tools.length} tools</span> : <span className="status">not connected</span>}
                </span>
                <span className="server-note">{s.transport === "stdio" ? [s.command, ...(s.args || [])].join(" ") : s.url}</span>
              </span>
              <button type="button" className="btn" onClick={() => connect(s)}>
                <Icon name="refresh" />
                {s.tools?.length ? "Refresh" : "Connect"}
              </button>
              <button type="button" className="btn icon-only" aria-label={`Remove ${s.name}`} onClick={() => remove(s)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="presets-mini">
        {MCP_PRESETS.filter((p) => !have.has(p.id)).map((p) => (
          <button key={p.id} type="button" className="preset-mini" onClick={() => addPreset(p)} title={p.note}>
            <span className="preset-mini-name">
              <BrandLogo id={p.id} name={p.name} size={14} tile={false} />
              {p.name}
            </span>
            <span className="preset-mini-note">{p.note}</span>
          </button>
        ))}
      </div>

      {tokenFor ? (
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            add({ name: tokenFor.name, url: tokenFor.url, auth: "bearer", token: tokenValue.trim(), preset: tokenFor.id });
            setTokenFor(null);
            setTokenValue("");
          }}
        >
          <input type="password" value={tokenValue} placeholder={`${tokenFor.name}: ${tokenFor.tokenLabel}`} aria-label={tokenFor.tokenLabel} autoComplete="off" onChange={(e) => setTokenValue(e.target.value)} autoFocus />
          <a className="btn" href={tokenFor.tokenUrl} target="_blank" rel="noreferrer">Get one</a>
          <button type="submit" className="btn primary" disabled={!tokenValue.trim()}>Add</button>
        </form>
      ) : null}

      {folderFor ? (
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            add({ name: `Files: ${folder.trim().split("/").filter(Boolean).pop() || folder.trim()}`, transport: "stdio", command: folderFor.command, args: [...folderFor.args, folder.trim()], preset: folderFor.id });
            setFolderFor(null);
            setFolder("");
          }}
        >
          <input type="text" value={folder} placeholder="/Users/you/Documents/Project" aria-label="Folder" spellCheck={false} onChange={(e) => setFolder(e.target.value)} autoFocus />
          <button type="submit" className="btn primary" disabled={!folder.trim().startsWith("/")}>Add</button>
        </form>
      ) : null}

      <details className="howto">
        <summary>Another server</summary>
        <form
          className="custom-server"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.kind === "url") {
              let url;
              try {
                url = new URL(custom.url.trim());
              } catch {
                return;
              }
              add({ name: custom.name.trim() || url.host, url: url.href, auth: custom.token.trim() ? "bearer" : "none", token: custom.token.trim() });
            } else {
              const [command, ...args] = splitCommand(custom.command.trim());
              add({ name: custom.name.trim() || command, transport: "stdio", command, args });
            }
            setCustom({ kind: custom.kind, name: "", url: "", token: "", command: "" });
          }}
        >
          <div className="connector-row">
            <label className="check">
              <input type="radio" name="kind" checked={custom.kind === "url"} onChange={() => setCustom({ ...custom, kind: "url" })} />
              <span>Hosted (URL)</span>
            </label>
            <label className="check">
              <input type="radio" name="kind" checked={custom.kind === "command"} onChange={() => setCustom({ ...custom, kind: "command" })} />
              <span>Local (command)</span>
            </label>
          </div>
          <div className="field-row">
            <input type="text" value={custom.name} placeholder="Name" aria-label="Name" onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            {custom.kind === "url" ? (
              <>
                <input type="text" value={custom.url} placeholder="https://example.com/mcp" aria-label="Server URL" spellCheck={false} onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
                <input type="password" value={custom.token} placeholder="Token (optional)" aria-label="Token" autoComplete="off" onChange={(e) => setCustom({ ...custom, token: e.target.value })} />
              </>
            ) : (
              <input type="text" value={custom.command} placeholder='npx -y @scope/server "an argument"' aria-label="Command" spellCheck={false} onChange={(e) => setCustom({ ...custom, command: e.target.value })} />
            )}
            <button type="submit" className="btn">
              <Icon name="plus" />
              Add
            </button>
          </div>
          <p className="hint">A server that signs in with OAuth is found out on connecting; you'll be sent to your browser.</p>
        </form>
      </details>
    </section>
  );
}

/* A command line split into words, honouring "double" and 'single' quotes. */
export function splitCommand(line) {
  const words = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) words.push(m[1] ?? m[2] ?? m[3]);
  return words;
}

/* -- always allowed ---------------------------------------------------------------------- */

function Allowed({ allow, patchConnectors }) {
  const names = Object.keys(allow).filter((k) => allow[k]);
  return (
    <section className="card connector">
      <div className="card-head">
        <h2>Allowed without asking</h2>
        {names.length ? (
          <button type="button" className="btn" onClick={() => patchConnectors(() => ({ allow: {} }))}>Ask again for all</button>
        ) : null}
      </div>
      {names.length ? (
        <ul className="allowed">
          {names.map((n) => (
            <li key={n}>
              <code>{n}</code>
              <button
                type="button"
                className="btn icon-only"
                aria-label={`Ask again before ${n}`}
                onClick={() => patchConnectors((c) => ({ allow: Object.fromEntries(Object.entries(c.allow).filter(([k]) => k !== n)) }))}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing yet. When an agent asks before acting, “Always allow” adds that action here.</p>
      )}
    </section>
  );
}
