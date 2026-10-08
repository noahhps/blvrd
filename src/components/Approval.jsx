import { useState } from "react";

import { Icon } from "./Icon.jsx";

/* An agent asking to do something: what, with which details, and the reader's
 * three answers. Sits in the thread where the answer is waiting, so the
 * question is read in the context that prompted it. Arrives with a quick
 * rise from 98%, never from nothing.
 *
 * A request with a `preview` (a scheduled task, lib/schedule.js) shows what
 * the app read it as instead of the raw details, and has no "Always allow":
 * the card is the reader's check of what will happen. */
export function Approval({ request, onAnswer }) {
  if (!request) return null;
  if (request.preview?.kind === "schedule") return <ScheduleApproval request={request} onAnswer={onAnswer} />;
  const args = request.args && Object.keys(request.args).length ? JSON.stringify(request.args, null, 2) : null;
  return (
    <div className="approval" role="alertdialog" aria-label={`${request.agentName} wants to act`}>
      <div className="approval-head">
        <Icon name="tool" size={14} />
        <span>
          <strong>{request.agentName}</strong> wants to: {request.summary}
        </span>
      </div>
      {args ? (
        <details className="approval-details">
          <summary>Details</summary>
          <pre>{args.length > 4000 ? `${args.slice(0, 4000)}\n…` : args}</pre>
        </details>
      ) : null}
      <div className="approval-actions">
        <button type="button" className="btn" onClick={() => onAnswer("deny")}>
          Don’t allow
        </button>
        <span className="spacer" />
        {!request.noAlways ? (
          <button type="button" className="btn" onClick={() => onAnswer("always")} title={`Don't ask again for ${request.toolLabel}`}>
            Always allow
          </button>
        ) : null}
        <button type="button" className="btn primary" onClick={() => onAnswer("allow")} autoFocus>
          Allow
        </button>
      </div>
    </div>
  );
}

/* A task to schedule, or a change to one: its name, when it runs in words
 * worked out by the app (not the model), what it will do, and -- for a new
 * one -- which of the agent's acting tools may run when nobody is there. */
function ScheduleApproval({ request, onAnswer }) {
  const p = request.preview;
  const [allow, setAllow] = useState(() => new Set());
  const toggle = (name) =>
    setAllow((was) => {
      const next = new Set(was);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  return (
    <div className="approval schedule-approval" role="alertdialog" aria-label={`${request.agentName} wants to schedule a task`}>
      <div className="approval-head">
        <Icon name="clock" size={14} />
        <span>
          <strong>{request.agentName}</strong> wants to {p.change ? "change a scheduled task" : "schedule a task"}
        </span>
      </div>
      <div className="schedule-preview">
        <p className="schedule-title">
          <strong>{p.title}</strong> — {p.words}
        </p>
        <p className="schedule-task">{p.task}</p>
        <p className="hint">
          Next: {p.next} · posts in this chat{p.quiet ? " only when there's something worth saying" : ""}, and notifies you
        </p>
        {!p.change && p.acting?.length ? (
          <fieldset className="schedule-allow">
            <legend>May do these without asking when it runs</legend>
            {p.acting.map((t) => (
              <label key={t.name} className="check">
                <input type="checkbox" checked={allow.has(t.name)} onChange={() => toggle(t.name)} />
                <span>{t.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
      <div className="approval-actions">
        <button type="button" className="btn" onClick={() => onAnswer("deny")}>
          Not now
        </button>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => onAnswer("allow", { allow: [...allow] })} autoFocus>
          {p.change ? "Change" : "Schedule"}
        </button>
      </div>
    </div>
  );
}
