import { useState } from "react";

import { SCHEDULE_GROUP, dueAt } from "../lib/schedule.js";
import { inDesktop } from "../lib/http.js";
import { renderMarkdown } from "../lib/markdown.js";
import { toolsFor } from "../lib/tools.js";
import { WhenError, momentWords, parseWhen } from "../lib/when.js";
import { Icon } from "./Icon.jsx";

/* What agents were asked to do later (lib/schedule.js): each task, when it
 * runs in words, when next, what it said last, and what it may do without
 * asking. Only here can the reader let a task act unattended -- an agent
 * can't change that. */
export function Tasks({ schedules, agents, groups, available, running, background, acts }) {
  const order = (s) => (s.done ? 2 : s.paused ? 1 : 0);
  const list = [...schedules].sort((a, b) => order(a) - order(b) || (dueAt(a) || Infinity) - (dueAt(b) || Infinity));
  return (
    <div className="settings tasks-page">
      <header>
        <h1>Tasks</h1>
        <p>
          What your agents were asked to do later, once or again and again. Ask in a chat — “every weekday at 8, summarize
          my unread email”, “in 20 minutes, remind me to call Sam” — and the agent asks you here before it’s kept. What each
          run says is posted in the chat it was made in.
        </p>
        {inDesktop() ? (
          <label className="check">
            <input type="checkbox" checked={background} onChange={(e) => acts.setBackground(e.target.checked)} />
            <span>Keep blvrd in the menu bar when its window is closed, so tasks still run</span>
          </label>
        ) : (
          <p className="hint warn">In a browser tab, tasks run only while the tab is open.</p>
        )}
      </header>

      {list.length ? (
        list.map((s) => (
          <Task key={s.id} task={s} agents={agents} groups={groups} available={available} running={running} acts={acts} />
        ))
      ) : (
        <section className="card">
          <p className="hint">No tasks yet.</p>
        </section>
      )}
    </div>
  );
}

function Task({ task, agents, groups, available, running, acts }) {
  const [editing, setEditing] = useState(false);
  const agent = agents.find((a) => a.id === task.agentId);
  const group = groups.find((g) => g.id === task.chatId);
  const where = group ? group.name : agent?.name || "an agent no longer here";
  const isRunning = running === task.id;
  const state = isRunning
    ? "Running now"
    : task.done
      ? "Finished"
      : task.paused
        ? "Paused"
        : dueAt(task)
          ? `Next ${momentWords(new Date(dueAt(task)))}${task.retryAt ? " (trying again)" : ""}`
          : "";
  const acting = agent ? toolsFor(agent, available).filter((t) => t.confirm && t.group !== SCHEDULE_GROUP) : [];
  const allow = new Set(task.allow || []);
  const toggle = (name) =>
    acts.patch(task.id, (s) => {
      const next = new Set(s.allow || []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...s, allow: [...next] };
    });
  const runs = [...(task.runs || [])].reverse();

  return (
    <section className={`card scheduled-task${task.paused || task.done ? " dim" : ""}`}>
      <div className="card-head">
        <h2>
          <Icon name="clock" size={16} />
          {task.title}
        </h2>
        <span className="tag">{state}</span>
      </div>
      <p className="scheduled-when">
        {task.words}
        {task.quiet ? " · only when there's something to say" : ""} ·{" "}
        <button type="button" className="link" onClick={() => acts.open(task.chatId)}>
          {group ? `${agent?.name || "An agent"} in ${where}` : where}
        </button>
      </p>

      {editing ? (
        <EditTask task={task} onSave={(fn) => (acts.patch(task.id, fn), setEditing(false))} onCancel={() => setEditing(false)} />
      ) : (
        <p className="scheduled-text">{task.task}</p>
      )}

      {task.last?.text ? (
        <details className="scheduled-last">
          <summary>Last said, {momentWords(new Date(task.last.at))}</summary>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(task.last.text) }} />
        </details>
      ) : null}

      {acting.length ? (
        <fieldset className="schedule-allow">
          <legend>May do these without asking when it runs</legend>
          {acting.map((t) => (
            <label key={t.name} className="check">
              <input type="checkbox" checked={allow.has(t.name)} onChange={() => toggle(t.name)} />
              <span>{t.label || t.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {runs.length ? (
        <details className="scheduled-runs">
          <summary>
            {runs.length} run{runs.length === 1 ? "" : "s"}
            {task.failures ? ` · ${task.failures} failed in a row` : ""}
          </summary>
          <ul>
            {runs.map((r, i) => (
              <li key={i} className={r.ok ? "" : "failed"}>
                <span>{momentWords(new Date(r.at))}</span>
                <span>{r.missed ? "missed" : r.ok ? (r.posted ? "posted" : "nothing new") : "failed"}</span>
                {r.ms ? <span>{Math.max(1, Math.round(r.ms / 1000))}s</span> : null}
                {r.summary ? <span className="hint">{r.summary}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="row-actions">
        {isRunning ? (
          <button type="button" className="btn" onClick={acts.stop}>
            <Icon name="stop" />
            Stop
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => acts.runNow(task.id)} disabled={Boolean(running) || !agent} title="Run it now, without waiting">
            <Icon name="play" />
            Run now
          </button>
        )}
        {!task.done ? (
          <button type="button" className="btn" onClick={() => acts.pause(task.id, !task.paused)}>
            <Icon name={task.paused ? "play" : "pause"} />
            {task.paused ? "Resume" : "Pause"}
          </button>
        ) : null}
        {!editing ? (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <Icon name="pen" />
            Edit
          </button>
        ) : null}
        <span className="spacer" />
        <button type="button" className="btn danger" onClick={() => acts.remove(task.id)}>
          <Icon name="trash" />
          Delete
        </button>
      </div>
    </section>
  );
}

/* When and what, in the reader's words; the when is read the way an agent's
 * is, and said back before it's kept. */
function EditTask({ task, onSave, onCancel }) {
  const [when, setWhen] = useState(task.words);
  const [text, setText] = useState(task.task);
  const [quiet, setQuiet] = useState(task.quiet);
  let read = null;
  let problem = null;
  try {
    read = when.trim() === task.words ? null : parseWhen(when);
  } catch (e) {
    problem = e instanceof WhenError ? e.message.replace(/^couldn't read "[^"]*" as a time: /, "") : String(e.message || e);
  }
  const save = () => {
    if (problem || !text.trim()) return;
    onSave((s) => ({
      ...s,
      task: text.trim(),
      quiet,
      ...(read ? { rule: read.rule, words: read.words, next: read.next.getTime(), retryAt: null, done: false, count: 0, failures: 0 } : {}),
    }));
  };
  return (
    <div className="scheduled-edit">
      <label className="field">
        <span>When</span>
        <input type="text" value={when} onChange={(e) => setWhen(e.target.value)} />
        {problem ? <span className="hint warn">{problem}</span> : read ? <span className="hint">{read.words} — next {momentWords(read.next)}</span> : null}
      </label>
      <label className="field">
        <span>What to do</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
        <span>Only post when there’s something worth saying</span>
      </label>
      <div className="row-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save} disabled={Boolean(problem) || !text.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}
