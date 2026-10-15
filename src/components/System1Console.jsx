import { useEffect, useRef, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { useCallsign } from "../lib/callsigns.js";
import { DECISION_MODELS, LIMITS, TYPES, blankQuestion, levelOf, lineOf, pct, problemWithAll, s1Of, summaryOf, typeOf } from "../lib/system1.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Gauges, KindBadge } from "./Gauges.jsx";
import { Icon } from "./Icon.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

/* A System 1 agent's own screen, in place of a chat. A decision model has no
 * conversation: it takes an input (the "state") and answers the agent's
 * typed questions about it -- yes/no, a choice, a score -- each with its
 * probabilities (lib/system1.js). So the screen is the questions on one side,
 * and on the other the input and the answers. Each run is kept in the
 * agent's chat as a pair of messages, so its tokens and heat count like
 * anyone's (lib/agentMetrics.js). */

const PROMPTS = {
  noul: "Is a refund being requested?",
  choice: "Which team should handle this?",
  score: "How urgent is this?",
};

function Bar({ value }) {
  return (
    <span className="s1-bar" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(1, value || 0)) * 100}%` }} />
    </span>
  );
}

/** The agent's questions, edited in place. Used here and in the agent editor. */
export function QuestionsEditor({ questions, onChange }) {
  const put = (i, patch) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const retype = (i, type) => {
    const q = questions[i];
    if (q.type !== type) put(i, { ...blankQuestion(type, q.name), instructions: q.instructions });
  };
  const nextName = () => {
    for (let n = questions.length + 1; ; n++) if (!questions.some((q) => q.name === `q${n}`)) return `q${n}`;
  };
  return (
    <div className="s1-questions">
      {questions.map((q, i) => (
        <fieldset key={i} className="s1-question">
          <div className="s1-question-top">
            <div className="s1-tasks" role="radiogroup" aria-label="Kind of answer">
              {TYPES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={q.type === t.id} onClick={() => retype(i, t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {questions.length > 1 ? (
              <button type="button" className="btn icon-only compact" aria-label="Remove this question" onClick={() => onChange(questions.filter((_, j) => j !== i))}>
                <Icon name="close" />
              </button>
            ) : null}
          </div>
          <textarea className="s1-ask" rows={2} value={q.instructions} placeholder={PROMPTS[q.type]} aria-label="Question" onChange={(e) => put(i, { instructions: e.target.value })} />
          <label className="s1-crit" title="What the answer is called in Ollama's response">
            <span>Answer</span>
            <input className="s1-key" type="text" value={q.name} onChange={(e) => put(i, { name: e.target.value.replace(/\s+/g, "_") })} />
          </label>

          {q.type === "noul" ? (
            <div className="s1-criteria">
              <label className="s1-crit">
                <span>No means</span>
                <input type="text" value={q.criteria?.false || ""} placeholder="optional" onChange={(e) => put(i, { criteria: { ...q.criteria, false: e.target.value } })} />
              </label>
              <label className="s1-crit">
                <span>Yes means</span>
                <input type="text" value={q.criteria?.true || ""} placeholder="optional" onChange={(e) => put(i, { criteria: { ...q.criteria, true: e.target.value } })} />
              </label>
            </div>
          ) : null}

          {q.type === "choice" ? (
            <div className="s1-criteria">
              {q.criteria.map((o, k) => (
                <div key={k} className="s1-crit s1-option">
                  <input type="text" className="s1-option-key" value={o.key} placeholder={`option ${k + 1}`} aria-label={`Option ${k + 1}`} onChange={(e) => put(i, { criteria: q.criteria.map((x, m) => (m === k ? { ...x, key: e.target.value } : x)) })} />
                  <input type="text" value={o.description} placeholder="what it means (optional)" aria-label={`What option ${k + 1} means`} onChange={(e) => put(i, { criteria: q.criteria.map((x, m) => (m === k ? { ...x, description: e.target.value } : x)) })} />
                  {q.criteria.length > LIMITS.choices[0] ? (
                    <button type="button" className="btn icon-only compact" aria-label={`Remove option ${k + 1}`} onClick={() => put(i, { criteria: q.criteria.filter((_, m) => m !== k) })}>
                      <Icon name="close" />
                    </button>
                  ) : null}
                </div>
              ))}
              {q.criteria.length < LIMITS.choices[1] ? (
                <button type="button" className="btn compact s1-add" onClick={() => put(i, { criteria: [...q.criteria, { key: "", description: "" }] })}>
                  <Icon name="plus" /> Option
                </button>
              ) : null}
            </div>
          ) : null}

          {q.type === "score" ? (
            <div className="s1-criteria">
              {q.criteria.map((level, k) => (
                <div key={k} className="s1-crit s1-option">
                  <span className="s1-level">{k}</span>
                  <input type="text" value={level} placeholder={k === 0 ? "the lowest level" : k === q.criteria.length - 1 ? "the highest level" : `level ${k}`} aria-label={`Level ${k}`} onChange={(e) => put(i, { criteria: q.criteria.map((x, m) => (m === k ? e.target.value : x)) })} />
                  {q.criteria.length > LIMITS.levels[0] ? (
                    <button type="button" className="btn icon-only compact" aria-label={`Remove level ${k}`} onClick={() => put(i, { criteria: q.criteria.filter((_, m) => m !== k) })}>
                      <Icon name="close" />
                    </button>
                  ) : null}
                </div>
              ))}
              {q.criteria.length < LIMITS.levels[1] ? (
                <button type="button" className="btn compact s1-add" onClick={() => put(i, { criteria: [...q.criteria, ""] })}>
                  <Icon name="plus" /> Level
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="hint">{typeOf(q.type).hint}</p>
        </fieldset>
      ))}
      {questions.length < LIMITS.questions ? (
        <button type="button" className="btn s1-add" onClick={() => onChange([...questions, blankQuestion("noul", nextName())])}>
          <Icon name="plus" /> Question
        </button>
      ) : null}
    </div>
  );
}

function Answer({ a }) {
  if (a.missing) return <p className="hint">No answer came back for this question.</p>;
  if (a.type === "noul") {
    const yes = a.noul >= 0.5;
    return (
      <>
        <p className="s1-lead">
          <strong>{yes ? "Yes" : "No"}</strong> <span>{pct(yes ? a.noul : 1 - a.noul)}</span>
        </p>
        <ul className="s1-scores">
          <li data-best={yes ? "" : undefined}>
            <span className="s1-name">yes</span>
            <Bar value={a.noul} />
            <span className="s1-num">{pct(a.noul)}</span>
          </li>
          <li data-best={yes ? undefined : ""}>
            <span className="s1-name">no</span>
            <Bar value={1 - a.noul} />
            <span className="s1-num">{pct(1 - a.noul)}</span>
          </li>
        </ul>
      </>
    );
  }
  const entries = Object.entries(a.probabilities || {});
  if (a.type === "choice") {
    entries.sort((x, y) => y[1] - x[1]);
    return (
      <>
        <p className="s1-lead">
          <strong>{a.choice}</strong> <span>{pct(a.probabilities?.[a.choice])} · confidence {pct(a.confidence)}</span>
        </p>
        <ul className="s1-scores">
          {entries.map(([key, p]) => (
            <li key={key} data-best={key === a.choice ? "" : undefined}>
              <span className="s1-name">{key}</span>
              <Bar value={p} />
              <span className="s1-num">{pct(p)}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const top = levelOf(a);
  return (
    <>
      <p className="s1-lead">
        <strong>{a.score.toFixed(2)}</strong>
        <span>
          {" "}
          / {Math.max(0, entries.length - 1)} · likeliest: {a.legend?.[top] ?? `level ${top}`} · confidence {pct(a.confidence)}
        </span>
      </p>
      <ol className="s1-scores" start={0}>
        {entries.map(([key, p]) => (
          <li key={key} data-best={key === top ? "" : undefined}>
            <span className="s1-name">
              <em>{key}</em> {a.legend?.[key] || ""}
            </span>
            <Bar value={p} />
            <span className="s1-num">{pct(p)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function System1Console({ agent, presets, messages, providers, readings, busy, onRun, onConfig, onCustomize }) {
  const call = useCallsign();
  const [draft, setDraft] = useState(() => s1Of(agent).questions);
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState("");
  const saved = useRef(JSON.stringify(s1Of(agent).questions));
  useEffect(() => {
    setDraft(s1Of(agent).questions);
    saved.current = JSON.stringify(s1Of(agent).questions);
    setProblem("");
  }, [agent.id]);
  // Keep the questions as they're typed, a moment after the last key.
  useEffect(() => {
    const text = JSON.stringify(draft);
    if (text === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = text;
      onConfig({ s1: { questions: draft } });
    }, 400);
    return () => clearTimeout(timer);
  }, [draft]);

  const config = { questions: draft };
  const invalid = problemWithAll(config);
  const runs = [];
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "assistant" && messages[i].s1?.answers) runs.push({ input: messages[i - 1]?.content || "", out: messages[i] });
  const latest = runs.at(-1);

  const go = async () => {
    setProblem("");
    try {
      await onRun(input, config);
      setInput("");
    } catch (err) {
      setProblem(err.message || String(err));
    }
  };
  const tagline = taglineOf(agent, presets);

  return (
    <div className="chat s1-console">
      <header className="chat-head" data-tauri-drag-region>
        <AgentAvatar look={agent.look} name={agent.name} size={45} spinning={busy} />
        <span className="chat-who">
          <span className="chat-name" title={agent.name}>
            {call(agent.name)}
          </span>
          <span className="chat-tagline">{tagline === "No instructions yet." ? "A decision model: it answers your questions about each input." : tagline}</span>
        </span>
        {readings ? (
          <span className="chat-readings">
            <KindBadge kind="s1" task={summaryOf(config)} model={agent.model?.model || null} size="head" />
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
            <section className="card s1-panel" data-title={`Questions · ${draft.length}`}>
              <span className="label">Model</span>
              <ModelPicker providers={providers} value={agent.model} onChange={(model) => onConfig({ model })} compact />
              <p className="hint">
                A decision model on Ollama 0.35 or later — {DECISION_MODELS.slice(0, 3).join(", ")}. Pull one with <code>ollama pull {DECISION_MODELS[0]}</code>.
              </p>
              <QuestionsEditor questions={draft} onChange={setDraft} />
            </section>

            <section className="s1-work">
              <div className="card s1-panel" data-title="Input">
                <textarea
                  className="s1-input"
                  value={input}
                  placeholder={"The text to decide about.\n\nOr a JSON object — then a question can name its fields in `backticks`."}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy && !invalid && input.trim()) go();
                  }}
                />
                <div className="s1-actions">
                  <span className="hint">{invalid || "⌘↵ to run"}</span>
                  <button type="button" className="btn primary" disabled={busy || !input.trim() || !agent.model?.model || Boolean(invalid)} onClick={go}>
                    {busy ? "Deciding…" : draft.length === 1 ? "Ask" : `Ask all ${draft.length}`}
                  </button>
                </div>
                {!agent.model?.model ? <p className="hint warn">Choose a decision model first.</p> : null}
                {problem ? <p className="error-line">{problem}</p> : null}
              </div>

              {latest
                ? latest.out.s1.answers.map((a) => (
                    <div key={a.name} className="card s1-panel s1-answer" data-title={`${a.name} · ${typeOf(a.type).label}`}>
                      <p className="s1-q">{a.instructions}</p>
                      <Answer a={a} />
                    </div>
                  ))
                : null}
              {latest ? (
                <p className="s1-foot">
                  {latest.out.s1.model}
                  {latest.out.s1.usage ? ` · ${latest.out.s1.usage.input_tokens} tokens in` : ""} · {latest.out.s1.ms} ms
                </p>
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
                          <span className="s1-num">{r.out.s1.answers.map(lineOf).join("  ·  ")}</span>
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
