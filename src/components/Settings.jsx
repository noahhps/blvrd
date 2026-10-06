import { useState } from "react";

import { HOSTED_CLOSED, HOSTED_OPEN, hostOf, isLocalUrl } from "../lib/catalog.js";
import { forget, modelsOf } from "../lib/models.js";
import { Icon } from "./Icon.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

/* Where the models come from.
 *
 * This computer first: every local server the app knows, which it can look for
 * on its own. Then hosted servers -- those that serve open-weight models, then
 * the closed APIs -- each off until it has a key, and each saying where your
 * messages would go. Then any other OpenAI-compatible server by URL. */
export function Settings({ providers, defaultModel, onDefaultModel, onProvider, onAddCustom, onRemoveCustom }) {
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
          Change an address if yours runs elsewhere -- another machine on your network counts as local.
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
            </li>
          ))}
        </ul>
      </section>

      <HostedList
        title="Hosted open models"
        hint="The same open-weight models -- Llama, Qwen, DeepSeek, Mistral, Gemma -- on someone else's GPUs. Useful when a model is too big for this machine."
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

      <p className="fineprint">
        Agents, chats, notes and keys are stored on this computer only, in the app's own storage. Keys are kept in
        plain text there, so anyone with access to your user account could read them.
      </p>
    </div>
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

  const add = (e) => {
    e.preventDefault();
    let url;
    try {
      url = new URL(base.trim());
    } catch {
      return setError("That address is not a URL -- it should look like http://192.168.1.20:8080/v1");
    }
    onAdd({ name: name.trim() || url.host, base: url.href.replace(/\/+$/, ""), key: key.trim() });
    setName("");
    setBase("");
    setKey("");
    setError("");
  };

  return (
    <form className="add-server" onSubmit={add}>
      <input type="text" value={name} placeholder="Name" aria-label="Name" onChange={(e) => setName(e.target.value)} />
      <input type="text" value={base} placeholder="http://host:port/v1" aria-label="Address" spellCheck={false} onChange={(e) => setBase(e.target.value)} />
      <input type="password" value={key} placeholder="Key (if it needs one)" aria-label="Key" autoComplete="off" onChange={(e) => setKey(e.target.value)} />
      <button type="submit" className="btn" disabled={!base.trim()}>
        <Icon name="plus" />
        Add
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
