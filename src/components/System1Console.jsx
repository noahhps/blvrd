import { useEffect, useRef, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { useCallsign } from "../lib/callsigns.js";
import { TASKS, s1Of, taskOf } from "../lib/system1.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Gauges, KindBadge } from "./Gauges.jsx";
import { Icon } from "./Icon.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

/* A System 1 agent's own screen, in place of a chat: an embedding model has
 * no conversation, so what it needs is its job set up (the task, its labels
 * or thresholds, the model) and a place to hand it an input and read the
 * answer. Each run is kept in the agent's chat as a pair of messages, so its
 * tokens and heat count like anyone's (lib/agentMetrics.js). */

const PLACEHOLDER = {
  embed: "The text to embed",
  classify: "The text to classify",
  rank: "The query\n\nthen one passage per line",
  match: "The first text\n\nthe second text",
  dedupe: "One item per line",
};

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

function Bar({ value }) {
  return (
    <span className="s1-bar" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

function Result({ r }) {
  if (!r) return null;
  const foot = (
    <p className="s1-foot">
      {r.model} · {r.dims} dimensions{r.tokens != null ? ` · ${r.tokens} tokens` : ""} · {r.ms} ms
    </p>
  );
  if (r.task === "classify")
    return (
      <div className="s1-result">
        <p className="s1-lead">
          <strong>{r.best.label}</strong> <span>{pct(r.best.score)}</span>
        </p>
        <ul className="s1-scores">
          {r.scores.map((s) => (
            <li key={s.label} data-best={s === r.best ? "" : undefined}>
              <span className="s1-name">{s.label}</span>
              <Bar value={s.score} />
              <span className="s1-num">{pct(s.score)}</span>
            </li>
          ))}
        </ul>
        {foot}
      </div>
    );
  if (r.task === "rank")
    return (
      <div className="s1-result">
        <ol className="s1-scores">
          {r.ranked.map((x, i) => (
            <li key={i} data-best={i === 0 ? "" : undefined}>
              <span className="s1-name">{x.text}</span>
              <Bar value={x.score} />
              <span className="s1-num">{pct(x.score)}</span>
            </li>
          ))}
        </ol>
        {foot}
      </div>
    );
  if (r.task === "match")
    return (
      <div className="s1-result">
        <p className="s1-lead">
          <strong>{pct(r.score)}</strong> <span>alike</span>
        </p>
        <Bar value={r.score} />
        {foot}
      </div>
    );
  if (r.task === "dedupe")
    return (
      <div className="s1-result">
        {r.pairs.length ? (
          <ul className="s1-scores">
            {r.pairs.map((x, i) => (
              <li key={i}>
                <span className="s1-name">
                  {x.a} <em>≈</em> {x.b}
                </span>
                <Bar value={x.score} />
                <span className="s1-num">{pct(x.score)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="s1-lead">No duplicates among {r.count} lines.</p>
        )}
        {foot}
      </div>
    );
  return (
    <div className="s1-result">
      <p className="s1-lead">
        <strong>{r.dims}</strong> <span>dimensions · norm {r.norm.toFixed(3)}</span>
      </p>
      <code className="s1-vector">[{r.preview.map((x) => x.toFixed(4)).join(", ")}, …]</code>
      {foot}
    </div>
  );
}

export function System1Console({ agent, presets, messages, providers, readings, busy, onRun, onConfig, onCustomize }) {
  const call = useCallsign();
  const config = s1Of(agent);
  const task = taskOf(config.task);
  const [input, setInput] = useState("");
  const [labels, setLabels] = useState(config.labels.join("\n"));
  const [problem, setProblem] = useState("");
  const area = useRef(null);
  useEffect(() => setLabels(s1Of(agent).labels.join("\n")), [agent.id]);

  const runs = [];
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "assistant" && messages[i].s1) runs.push({ input: messages[i - 1]?.content || "", out: messages[i] });
  const latest = runs.at(-1);

  const go = async () => {
    setProblem("");
    try {
      await onRun(input);
      setInput("");
    } catch (err) {
      setProblem(err.message || String(err));
    }
  };
  const setConfig = (patch) => onConfig({ s1: { ...config, ...patch } });

  return (
    <div className="chat s1-console">
      <header className="chat-head" data-tauri-drag-region>
        <AgentAvatar look={agent.look} name={agent.name} size={45} spinning={busy} />
        <span className="chat-who">
          <span className="chat-name" title={agent.name}>
            {call(agent.name)}
          </span>
          <span className="chat-tagline">{taglineOf(agent, presets) === "No instructions yet." ? task.hint : taglineOf(agent, presets)}</span>
        </span>
        {readings ? (
          <span className="chat-readings">
            <KindBadge kind="s1" task={config.task} model={agent.model?.model || null} size="head" />
            <Gauges r={readings} size="head" />
          </span>
        ) : null}
        <button type="button" className="btn" onClick={onCustomize}>
          <Icon name="pen" />
          Customize
        </button>
      </header>

      <div className="chat-row">
        <div className="chat-body s1-body">
          <div className="s1-grid">
            <section className="card s1-panel" data-title="Configuration">
              <h2>System 1 model</h2>
              <p className="hint">No conversation: one input in, one answer out. It runs on an embedding model, through Ollama's /api/embed.</p>

              <span className="label">Model</span>
              <ModelPicker providers={providers} value={agent.model} onChange={(model) => onConfig({ model })} compact />

              <span className="label">Task</span>
              <div className="s1-tasks" role="radiogroup" aria-label="Task">
                {TASKS.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={config.task === t.id} onClick={() => setConfig({ task: t.id })}>
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="hint">{task.hint}</p>

              {config.task === "classify" ? (
                <label className="field">
                  <span className="label">Labels, one per line</span>
                  <textarea
                    value={labels}
                    onChange={(e) => setLabels(e.target.value)}
                    onBlur={() => setConfig({ labels: labels.split("\n").map((l) => l.trim()).filter(Boolean) })}
                    placeholder={"question\nbug report\nfeature request"}
                  />
                </label>
              ) : null}
              {config.task === "rank" ? (
                <label className="field">
                  <span className="label">Show the top</span>
                  <input type="text" inputMode="numeric" value={config.topK} onChange={(e) => setConfig({ topK: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
              ) : null}
              {config.task === "dedupe" ? (
                <label className="field">
                  <span className="label">Same when at least {pct(config.threshold)} alike</span>
                  <input type="range" min="0.5" max="0.99" step="0.01" value={config.threshold} onChange={(e) => setConfig({ threshold: Number(e.target.value) })} />
                </label>
              ) : null}
              {config.task === "embed" ? (
                <label className="field">
                  <span className="label">Dimensions (blank: the model's own)</span>
                  <input type="text" inputMode="numeric" value={config.dimensions || ""} placeholder="e.g. 256" onChange={(e) => setConfig({ dimensions: Number(e.target.value) || null })} />
                </label>
              ) : null}
            </section>

            <section className="s1-work">
              <div className="card s1-panel" data-title={`Input · ${task.label}`}>
                <textarea
                  ref={area}
                  className="s1-input"
                  value={input}
                  placeholder={PLACEHOLDER[config.task]}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
                  }}
                />
                <div className="s1-actions">
                  <span className="hint">⌘↵ to run</span>
                  <button type="button" className="btn primary" disabled={busy || !input.trim() || !agent.model?.model} onClick={go}>
                    {busy ? "Running…" : `Run · ${task.label}`}
                  </button>
                </div>
                {!agent.model?.model ? <p className="hint warn">Choose an embedding model first.</p> : null}
                {problem ? <p className="error-line">{problem}</p> : null}
              </div>

              {latest ? (
                <div className="card s1-panel" data-title="Output">
                  <Result r={latest.out.s1} />
                </div>
              ) : null}

              {runs.length > 1 ? (
                <div className="card s1-panel" data-title={`Log · ${runs.length} runs`}>
                  <ol className="s1-log">
                    {runs
                      .slice(0, -1)
                      .reverse()
                      .slice(0, 12)
                      .map((r, i) => (
                        <li key={i}>
                          <span className="s1-name">{r.input.split("\n")[0]}</span>
                          <span className="s1-num">{r.out.s1.task === "classify" ? r.out.s1.best.label : r.out.s1.task === "match" ? pct(r.out.s1.score) : r.out.s1.task}</span>
                        </li>
                      ))}
                  </ol>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
