import { useEffect, useState } from "react";

import { inDesktop } from "../lib/http.js";
import { resetSandbox, sandboxStatus, stopSandbox } from "../lib/computer/connection.js";
import { Icon } from "./Icon.jsx";

/* The sandbox (src-tauri/src/machine.rs): the Linux machine a chat's
 * computer can be, instead of this Mac. Made the first time a chat uses it;
 * stopped when nothing has for a while; reset here, to a fresh machine. */
export function SandboxCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState(null);
  const refresh = () => sandboxStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    if (inDesktop()) refresh();
  }, []);
  if (!inDesktop()) return null;
  const act = (what, fn) => async () => {
    setBusy(what);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem(e.message || String(e));
    }
    setBusy(null);
    setSure(false);
    refresh();
  };
  const state = !status ? "…" : status.state === "running" ? "running" : status.state === "stopped" ? "stopped" : status.state === "none" ? "not made yet" : "unknown";
  return (
    <section className="card">
      <div className="card-head">
        <h2>Sandbox</h2>
        <span className={`status${status?.state === "running" ? " on" : ""}`}>{busy ? `${busy}…` : state}</span>
      </div>
      <p className="hint">
        A Linux machine of its own on this Mac, for chats whose computer is set to Sandbox. Agents can do anything in it
        without asking; it holds none of your files or keys, and sees one folder of yours, <code>~/blvrd/Shared</code> (as
        <code>/shared</code> in it). It is made the first time a chat uses it — that takes a few minutes and a few GB — and
        stopped after 15 minutes with nothing to do.
      </p>
      {problem ? <p className="error-line">{problem}</p> : null}
      <div className="row-actions">
        <button type="button" className="btn" onClick={act("Stopping", stopSandbox)} disabled={Boolean(busy) || status?.state !== "running"}>
          <Icon name="stop" />
          Stop
        </button>
        {sure ? (
          <>
            <button type="button" className="btn danger" onClick={act("Resetting", resetSandbox)} disabled={Boolean(busy)}>
              <Icon name="refresh" />
              Reset: everything agents put in it goes
            </button>
            <button type="button" className="btn" onClick={() => setSure(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setSure(true)} disabled={Boolean(busy) || !status || status.state === "none"}>
            <Icon name="refresh" />
            Reset…
          </button>
        )}
      </div>
    </section>
  );
}
