import { useEffect, useState } from "react";

import { probe } from "../lib/probe.js";
import { getProfile, onProfiles, ollamaContext, setReader, usableWindow } from "../lib/profile.js";
import { Icon } from "./Icon.jsx";

/* Whether each model in use can drive tools and the computer, and how
 * (lib/probe.js, lib/profile.js): tested, with what its server said about it,
 * and the reader's say where the app got it wrong. */
export function ModelAccess({ inUse }) {
  const [, redraw] = useState(0);
  useEffect(() => onProfiles(() => redraw((n) => n + 1)), []);
  if (!inUse.length) return null;
  return (
    <section className="card">
      <h2>Computer access</h2>
      <p className="hint">
        Whether each model you use can work tools — and so the computer — and how. “Native” uses its server’s own tool
        calls; “prompted” has the tools written into its instructions, for servers and models without them. Testing
        sends it two short messages.
      </p>
      <ul className="servers">
        {inUse.map(({ provider, model, who }) => (
          <Row key={`${provider.id}|${model}`} provider={provider} model={model} who={who} />
        ))}
      </ul>
    </section>
  );
}

const BADGE = {
  native: { text: "Native", cls: "on" },
  prompted: { text: "Prompted", cls: "on" },
  none: { text: "Can’t", cls: "cant" },
};
const k = (n) => (n >= 1024 ? `${Math.round(n / 1024)}k` : String(n));

function Row({ provider, model, who }) {
  const [testing, setTesting] = useState(false);
  const [problem, setProblem] = useState(null);
  const p = getProfile(provider, model);
  const tested = p.probedAt ? BADGE[p.tools] : null;
  const room = usableWindow(provider, p);
  const windowText =
    provider.kind === "ollama"
      ? `loads with ${k(ollamaContext(p))} tokens${p.window && p.window > ollamaContext(p) ? ` of the ${k(p.window)} it can take` : ""}`
      : room
        ? `${k(room)} tokens${p.windowFrom === "server" ? ", as the server says" : p.windowFrom === "reader" ? ", as you set" : ""}`
        : "context not said by the server";
  const test = async () => {
    setTesting(true);
    setProblem(null);
    try {
      await probe(provider, model);
    } catch (e) {
      setProblem(e.message || String(e));
    }
    setTesting(false);
  };
  return (
    <li className="server model-access">
      <div className="server-main">
        <div className="server-top">
          <span className="server-name">{model}</span>
          <span className="status">{provider.name}</span>
          {testing ? <span className="status">testing…</span> : tested ? <span className={`status ${tested.cls}`}>{tested.text}</span> : <span className="status">not tested</span>}
        </div>
        <span className="server-note">
          {who}
          {" · "}
          {windowText}
          {p.vision ? " · sees pictures" : ""}
        </span>
        {p.probeNote ? <span className="server-note">{p.probeNote}</span> : null}
        {problem ? <span className="error-line">{problem}</span> : null}
        <details className="model-access-set">
          <summary>Set by hand</summary>
          <label className="check-row">
            <span>Tools</span>
            <select value={p.toolsFrom === "reader" ? p.tools : ""} onChange={(e) => setReader(provider, model, { tools: e.target.value || null })}>
              <option value="">Automatic{p.tools && p.toolsFrom !== "reader" ? ` (${p.tools})` : ""}</option>
              <option value="native">Native</option>
              <option value="prompted">Prompted</option>
            </select>
          </label>
          <label className="check-row">
            <span>Context (tokens)</span>
            <input
              type="number"
              min="1024"
              step="1024"
              placeholder={p.window && p.windowFrom !== "reader" ? String(p.window) : "unknown"}
              value={p.windowFrom === "reader" ? p.window : ""}
              onChange={(e) => setReader(provider, model, { window: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
        </details>
      </div>
      <button type="button" className="btn" onClick={test} disabled={testing}>
        <Icon name="refresh" />
        {p.probedAt ? "Test again" : "Test computer access"}
      </button>
    </li>
  );
}
