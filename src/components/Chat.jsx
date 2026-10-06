import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { hostOf, isLocalUrl } from "../lib/catalog.js";
import { renderMarkdown } from "../lib/markdown.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Icon } from "./Icon.jsx";

/* One agent's ongoing chat. `live` is the answer still arriving: its text so
 * far, shown under the messages already kept. */
export function Chat({ agent, presets, messages, live, busy, model, provider, onSend, onStop, onCustomize, onClear }) {
  const [draft, setDraft] = useState("");
  const thread = useRef(null);
  const input = useRef(null);
  const stuck = useRef(true);

  // Keep the newest words in view while they arrive, unless the reader has
  // scrolled up to read something earlier.
  const onScroll = () => {
    const el = thread.current;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = thread.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text]);

  useEffect(() => {
    setDraft("");
    stuck.current = true;
    input.current?.focus();
  }, [agent.id]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    stuck.current = true;
    onSend(text);
  };

  const where = provider
    ? isLocalUrl(provider.base)
      ? { local: true, text: `${model} · ${provider.name}` }
      : { local: false, text: `${model} · ${hostOf(provider.base)}` }
    : null;

  return (
    <div className="chat">
      <header className="chat-head">
        <AgentAvatar look={agent.look} name={agent.name} size={30} spinning={busy} />
        <span className="chat-who">
          <span className="chat-name">{agent.name}</span>
          <span className="chat-tagline">{taglineOf(agent, presets)}</span>
        </span>
        {where ? (
          <span className={`where ${where.local ? "local" : "hosted"}`} title={where.local ? "Runs on this computer or your network" : "Your messages are sent to this host"}>
            <Icon name={where.local ? "chip" : "globe"} size={14} />
            {where.text}
          </span>
        ) : (
          <span className="where none">No model chosen</span>
        )}
        {messages.length ? (
          <button type="button" className="btn icon-only" title="Clear this chat" aria-label="Clear this chat" onClick={onClear} disabled={busy}>
            <Icon name="trash" />
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onCustomize}>
          <Icon name="pen" />
          Customize
        </button>
      </header>

      <div className="thread" ref={thread} onScroll={onScroll}>
        {messages.length === 0 && !live ? (
          <div className="greeting">
            <AgentAvatar look={agent.look} name={agent.name} size={64} intro />
            <h2>Hi, I’m {agent.name}.</h2>
            <p>{taglineOf(agent, presets)}</p>
          </div>
        ) : null}
        <div className="turns">
          {messages.map((m, i) => (
            <Turn key={m.id || i} message={m} agent={agent} />
          ))}
          {live ? (
            <div className="turn assistant">
              <AgentAvatar look={agent.look} name={agent.name} size={26} spinning />
              <div className="answer">
                {live.text ? (
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }} />
                ) : (
                  <p className="thinking">{live.status || "Thinking…"}</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="composer">
        <textarea
          ref={input}
          value={draft}
          rows={1}
          placeholder={`Message ${agent.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="round stop" aria-label="Stop" title="Stop" onClick={onStop}>
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="button" className="round" aria-label="Send" title="Send" disabled={!draft.trim()} onClick={send}>
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function Turn({ message, agent }) {
  if (message.role === "user") {
    return (
      <div className="turn user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }
  if (message.role === "tool") {
    return (
      <details className={`step${message.error ? " failed" : ""}`}>
        <summary>
          <Icon name="tool" size={14} />
          <span>{message.error ? `${message.name} didn’t work` : `Used ${message.name}`}</span>
        </summary>
        <pre>{message.content}</pre>
      </details>
    );
  }
  if (message.failure) {
    return (
      <div className="turn assistant">
        <AgentAvatar look={agent.look} name={agent.name} size={26} />
        <div className="answer">
          <p className="error-box">{message.failure}</p>
        </div>
      </div>
    );
  }
  const hasText = Boolean(message.content?.trim());
  if (!hasText && !message.note) return null;
  return (
    <div className="turn assistant">
      <AgentAvatar look={agent.look} name={agent.name} size={26} />
      <div className="answer">
        {hasText ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} /> : null}
        {message.note ? <p className="note">{message.note}</p> : null}
      </div>
    </div>
  );
}
