import { useState } from "react";

import { HOSTED_CLOSED, HOSTED_OPEN, hostOf, isLocalUrl } from "../lib/catalog.js";
import { forget, modelsOf } from "../lib/models.js";
import { findBase } from "../lib/serverBase.js";
import { COMPACT_CHOICES, DEFAULT_COMPACT_AT } from "../lib/compact.js";
import { FREE, PAID } from "../lib/search.js";
import { DEFAULT_SHORTCUT, shortcutFromKey, shortcutLabel } from "../lib/quick.js";
import { Icon } from "./Icon.jsx";
import { ModelAccess } from "./ModelAccess.jsx";
import { SandboxCard } from "./SandboxCard.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

/* Where the models come from.
 *
 * This computer first: every local server the app knows, which it can look for
 * on its own. Then hosted servers -- those that serve open-weight models, then
 * the closed APIs -- each off until it has a key, and each saying where your
 * messages would go. Then any other OpenAI-compatible server by URL. */
export function Settings({
  providers,
  defaultModel,
  onDefaultModel,
  onProvider,
  onAddCustom,
  onRemoveCustom,
  shortcut,
  shortcutProblem,
  onShortcut,
  compactAt,
  onCompactAt,
  search,
  onSearch,
  inUse = [],
}) {
  const [probe, setProbe] = useState({}); // id -> { state, count, error }
  const [probing, setProbing] = useState(false);

  const local = providers.filter((p) => !p.keys && !p.custom);
  const custom = providers.filter((p) => p.custom);
  const byId = new Map(providers.map((p) => [p.id, p]));

  const findLocal = async () => {
    setProbing(true);
    await Promise.all(
      local.map(async (p) => {
        setProbe((s) => ({ ...s, [p.id]: { state: "asking" } }));
        const { models, error } = await modelsOf(p, { fresh: true });
        setProbe((s) => ({
          ...s,
          [p.id]: error ? { state: "off", error } : { state: "on", count: models.length },
        }));
      }),
    );
    setProbing(false);
  };

  const status = (p) => {
    const s = probe[p.id];
    if (!s) return null;
    if (s.state === "asking") return <span className="status">looking…</span>;
    if (s.state === "on") return <span className="status on">running · {s.count} model{s.count === 1 ? "" : "s"}</span>;
    return <span className="status off">not running</span>;
  };

  return (
    <div className="settings">
      <header>
        <h1>Models</h1>
        <p>
          blvrd talks to model servers directly. Local ones keep everything on your machine;
          hosted ones are sent each message you write to an agent that uses them.
        </p>
      </header>

      <section className="card">
        <h2>Default model</h2>
        <p className="hint">What an agent runs on unless you give it a model of its own.</p>
        <ModelPicker providers={providers} value={defaultModel} onChange={onDefaultModel} />
      </section>

      <ModelAccess inUse={inUse} />
      <SandboxCard />

      <section className="card">
        <div className="card-head">
          <h2>On this computer</h2>
          <button type="button" className="btn" onClick={findLocal} disabled={probing}>
            <Icon name="search" />
            {probing ? "Looking…" : "Find local servers"}
          </button>
        </div>
        <p className="hint">
          Open-source servers that run models on your own hardware. Start one, then look for it here.
          Change an address if yours runs elsewhere — another machine on your network counts as local.
        </p>
        <ul className="servers">
          {local.map((p) => (
            <li key={p.id} className="server">
              <label className="switch" title={p.enabled ? "On" : "Off"}>
                <input type="checkbox" checked={p.enabled} onChange={(e) => onProvider(p.id, { enabled: e.target.checked })} />
                <span />
              </label>
              <span className="server-main">
                <span className="server-top">
                  <span className="server-name">{p.name}</span>
                  {status(p)}
                </span>
                <span className="server-note">{withCode(p.note)}</span>
              </span>
              <span className="server-fields">
                <input
                  className="server-url"
                  type="text"
                  value={p.base}
                  aria-label={`${p.name} address`}
                  spellCheck={false}
                  onChange={(e) => {
                    forget(p);
                    onProvider(p.id, { base: e.target.value });
                  }}
                />
                {p.localKey ? (
                  <input
                    className="server-url"
                    type="password"
                    value={p.key}
                    placeholder="API key"
                    aria-label={`${p.name} API key`}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => {
                      forget(p);
                      onProvider(p.id, { key: e.target.value.trim() });
                    }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <HostedList
        title="Hosted open models"
        hint="The same open-weight models — Llama, Qwen, DeepSeek, Mistral, Gemma — on someone else's GPUs. Useful when a model is too big for this machine."
        entries={HOSTED_OPEN}
        byId={byId}
        onProvider={onProvider}
      />
      <HostedList title="Closed APIs" hint="Proprietary models, reached with your own key." entries={HOSTED_CLOSED} byId={byId} onProvider={onProvider} />

      <section className="card">
        <h2>Another server</h2>
        <p className="hint">Anything that speaks the OpenAI-compatible chat API: a server on another machine, LiteLLM, a company gateway.</p>
        {custom.length ? (
          <ul className="servers">
            {custom.map((p) => (
              <li key={p.id} className="server">
                <label className="switch">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => onProvider(p.id, { enabled: e.target.checked })} />
                  <span />
                </label>
                <span className="server-main">
                  <span className="server-top">
                    <span className="server-name">{p.name}</span>
                    <span className={`status ${isLocalUrl(p.base) ? "on" : ""}`}>{isLocalUrl(p.base) ? "local" : hostOf(p.base)}</span>
                  </span>
                  <span className="server-note">{p.base}</span>
                </span>
                <button type="button" className="btn icon-only" aria-label={`Remove ${p.name}`} onClick={() => onRemoveCustom(p.id)}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <AddServer onAdd={onAddCustom} />
      </section>

      <section className="card">
        <h2>Long chats</h2>
        <p className="hint">
          When a chat grows past this — or nears what the agent’s model can take, if that comes first — its older
          messages are summarized by the agent’s model and only the summary and the recent part are sent. The chat still shows everything. You can also compact one any time:
          right-click it in the sidebar.
        </p>
        <select
          className="compact-at"
          value={compactAt === null ? "off" : String(compactAt)}
          onChange={(e) => onCompactAt(e.target.value === "off" ? null : Number(e.target.value))}
          aria-label="Compact chats after"
        >
          {COMPACT_CHOICES.map((n) => (
            <option key={n} value={n}>
              After about {n / 1000}k tokens{n === DEFAULT_COMPACT_AT ? " (default)" : ""}
            </option>
          ))}
          <option value="off">Never</option>
        </select>
      </section>

      <SearchCard search={search} onSearch={onSearch} />

      <QuickviewCard shortcut={shortcut} problem={shortcutProblem} onShortcut={onShortcut} />

      <p className="fineprint">
        Agents, chats, notes and keys are stored on this computer only, in the app's own storage. Keys are kept in
        plain text there, so anyone with access to your user account could read them.
      </p>
    </div>
  );
}

/* Where an agent's web searches go. The free tier needs nothing; a provider
 * of the reader's own takes a key (or, for SearXNG, an address) and is asked
 * first. */
function SearchCard({ search, onSearch }) {
  const id = search.provider;
  const paid = PAID[id];
  const free = Object.values(FREE).map((v) => v.name).join(", ");
  return (
    <section className="card">
      <h2>Web search</h2>
      <p className="hint">
        What an agent’s “Search the web” ability uses. Only the search itself is sent, never your chat.
      </p>
      <div className="search-fields">
        <select value={id} onChange={(e) => onSearch({ provider: e.target.value })} aria-label="Search provider">
          <option value="free">Free, no key ({free} in turn)</option>
          {Object.entries(PAID).map(([key, p]) => (
            <option key={key} value={key}>
              {p.name}
              {key === "searxng" ? " (your own server)" : " (your key)"}
            </option>
          ))}
        </select>
        {id === "searxng" ? (
          <input
            type="text"
            value={search.searxng}
            placeholder="http://127.0.0.1:8080"
            aria-label="SearXNG address"
            spellCheck={false}
            onChange={(e) => onSearch({ searxng: e.target.value.trim() })}
          />
        ) : paid ? (
          <input
            type="password"
            value={search.keys[id] || ""}
            placeholder={`${paid.name} API key`}
            aria-label={`${paid.name} API key`}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onSearch({ keys: { ...search.keys, [id]: e.target.value.trim() } })}
          />
        ) : null}
      </div>
      {id === "free" ? (
        <p className="hint">
          Each search goes to the next of these services’ free tiers, and to the one after if it’s busy. Fine for
          everyday use; a key of your own is steadier.
        </p>
      ) : id === "searxng" ? (
        <p className="hint">Your SearXNG needs the JSON format turned on (search.formats in its settings.yml).</p>
      ) : (
        <p className="hint">
          <a href={paid.keys} target="_blank" rel="noreferrer">
            Get a {paid.name} key
          </a>
          . Searches go to {paid.name}.
        </p>
      )}
      {paid ? (
        <label className="check search-fallback">
          <input type="checkbox" checked={search.fallback} onChange={(e) => onSearch({ fallback: e.target.checked })} />
          When {paid.name} fails, use the free services instead
        </label>
      ) : null}
    </section>
  );
}

/* The quickview's shortcut: press "Change", then the keys you want. */
function QuickviewCard({ shortcut, problem, onShortcut }) {
  const [recording, setRecording] = useState(false);
  const onKey = (e) => {
    e.preventDefault();
    if (e.key === "Escape") return setRecording(false);
    const next = shortcutFromKey(e);
    if (!next) return;
    setRecording(false);
    onShortcut(next);
  };
  return (
    <section className="card">
      <h2>Quickview</h2>
      <p className="hint">
        A box that comes up over any app. Type @ to pick an agent, write to it, and press Enter: blvrd opens on
        that chat with your message sent.
      </p>
      <div className="shortcut-row">
        <button
          type="button"
          className={`btn shortcut${recording ? " recording" : ""}`}
          onClick={() => setRecording(true)}
          onKeyDown={recording ? onKey : undefined}
          onBlur={() => setRecording(false)}
          aria-label={recording ? "Press the keys for the shortcut" : `Shortcut: ${shortcutLabel(shortcut)}. Change it`}
        >
          {recording ? "Press keys…" : <kbd>{shortcutLabel(shortcut)}</kbd>}
        </button>
        {shortcut !== DEFAULT_SHORTCUT ? (
          <button type="button" className="btn" onClick={() => onShortcut(DEFAULT_SHORTCUT)}>
            Use {shortcutLabel(DEFAULT_SHORTCUT)}
          </button>
        ) : null}
        {shortcut ? (
          <button type="button" className="btn" onClick={() => onShortcut(null)}>
            Turn off
          </button>
        ) : null}
      </div>
      {problem ? (
        <p className="hint warn">
          Couldn’t take {shortcutLabel(shortcut)}: another app may have it. Pick another. ({problem})
        </p>
      ) : (
        <p className="hint">
          {recording ? "Hold modifiers and press a key. Esc to cancel." : "Any keys with ⌘, ⌥, ⌃ or ⇧, or an F-key. fn can’t be used: macOS keeps it."}
        </p>
      )}
    </section>
  );
}

function HostedList({ title, hint, entries, byId, onProvider }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      <ul className="servers">
        {entries.map((entry) => {
          const p = byId.get(entry.id);
          return (
            <li key={entry.id} className="server">
              <label className="switch" title={p.key ? "" : "Add a key to turn it on"}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  disabled={!p.key}
                  onChange={(e) => onProvider(p.id, { enabled: e.target.checked })}
                />
                <span />
              </label>
              <span className="server-main">
                <span className="server-top">
                  <span className="server-name">{p.name}</span>
                  <span className="status">sends to {hostOf(p.base)}</span>
                </span>
                <a className="server-note" href={entry.keys} target="_blank" rel="noreferrer">
                  Get a key
                </a>
              </span>
              <input
                className="server-url"
                type="password"
                value={p.key}
                placeholder="API key"
                aria-label={`${p.name} API key`}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  forget(p);
                  const key = e.target.value.trim();
                  onProvider(p.id, { key, enabled: Boolean(key) });
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddServer({ onAdd }) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Added only where it answers (lib/serverBase.js): http or https, with or
  // without /v1, whichever the server actually serves.
  const add = async (e) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError("");
    const found = await findBase(base, key.trim());
    setChecking(false);
    if (found.problem) return setError(found.problem);
    onAdd({ name: name.trim() || new URL(found.base).host, base: found.base, key: key.trim() });
    setName("");
    setBase("");
    setKey("");
  };

  return (
    <form className="add-server" onSubmit={add}>
      <input type="text" value={name} placeholder="Name" aria-label="Name" onChange={(e) => setName(e.target.value)} />
      <input type="text" value={base} placeholder="192.168.1.20:8080" aria-label="Address" spellCheck={false} onChange={(e) => setBase(e.target.value)} />
      <input type="password" value={key} placeholder="Key (if it needs one)" aria-label="Key" autoComplete="off" onChange={(e) => setKey(e.target.value)} />
      <button type="submit" className="btn" disabled={!base.trim() || checking}>
        <Icon name="plus" />
        {checking ? "Checking…" : "Add"}
      </button>
      {error ? <p className="error-line">{error}</p> : null}
    </form>
  );
}

/* `text in backticks` as code, the rest as it is. */
function withCode(text) {
  return String(text || "")
    .split(/(`[^`]+`)/)
    .map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part));
}
