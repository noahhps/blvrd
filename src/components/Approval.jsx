import { Icon } from "./Icon.jsx";

/* An agent asking to do something: what, with which details, and the reader's
 * three answers. Sits in the thread where the answer is waiting, so the
 * question is read in the context that prompted it. Arrives with a quick
 * rise from 98%, never from nothing. */
export function Approval({ request, onAnswer }) {
  if (!request) return null;
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
        <button type="button" className="btn" onClick={() => onAnswer("always")} title={`Don't ask again for ${request.toolLabel}`}>
          Always allow
        </button>
        <button type="button" className="btn primary" onClick={() => onAnswer("allow")} autoFocus>
          Allow
        </button>
      </div>
    </div>
  );
}
