import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { hostOf, isLocalUrl } from "../lib/catalog.js";
import { getToolsOpen, setToolsOpen } from "../lib/prefs.js";
import { renderMarkdown } from "../lib/markdown.js";
import { TOOLS, toolsFor } from "../lib/tools.js";
import { useReadWidth } from "../lib/useReadWidth.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Composer } from "./Composer.jsx";
import { Icon } from "./Icon.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

/* One agent's ongoing chat. `live` is the answer still arriving: its text so
 * far, shown under the messages already kept.
 *
 * The column -- the turns and the composer under them -- is one width, set by
 * dragging either of its edges (lib/useReadWidth.js). */
export function Chat({
  agent,
  presets,
  messages,
  live,
  busy,
  model,
  provider,
  providers,
  defaultModel,
  onModel,
  onSend,
  onStop,
  onCustomize,
  onClear,
}) {
  const thread = useRef(null);
  const area = useRef(null);
  const stuck = useRef(true);
  const read = useReadWidth(area);

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
    stuck.current = true;
  }, [agent.id]);

  const send = (text, files, thinking) => {
    stuck.current = true;
    onSend(text, files, thinking);
  };

  const where = provider
    ? isLocalUrl(provider.base)
      ? { local: true, text: `${model} · ${provider.name}` }
      : { local: false, text: `${model} · ${hostOf(provider.base)}` }
    : null;

  const abilities = toolsFor(agent);
  const abilitiesLine =
    abilities.length === TOOLS.length
      ? "Every ability"
      : abilities.length
        ? abilities.map((t) => t.label).join(", ")
        : "No abilities -- talk only";

  const defaultLabel = defaultModel?.model ? `Default (${defaultModel.model})` : "Default model";

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

      <div
        className="chat-body"
        ref={area}
        data-resizing={read.resizing ? "" : undefined}
        data-empty={messages.length === 0 && !live ? "" : undefined}
        style={read.width ? { "--read-w": `${read.width}px` } : undefined}
      >
        {["left", "right"].map((side) => (
          <div
            key={side}
            className="read-resize"
            data-side={side}
            role="separator"
            aria-orientation="vertical"
            aria-label="Conversation width"
            tabIndex={0}
            onPointerDown={read.start(side)}
            onKeyDown={read.nudge(side)}
            onDoubleClick={() => read.nudge(side)({ key: "Reset", preventDefault() {} })}
          >
            <i />
          </div>
        ))}

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

        <Composer
          agentName={agent.name}
          disabled={busy}
          provider={provider}
          model={model}
          focusKey={agent.id}
          autoFocus={messages.length === 0}
          onSend={send}
          onStop={onStop}
          tray={
            <>
              <span className="tray-label">Model</span>
              <ModelPicker
                providers={providers}
                value={agent.model}
                onChange={onModel}
                allowDefault
                defaultLabel={defaultLabel}
                compact
              />
              <span className="spacer" />
              <span className="tray-note" title={abilitiesLine}>{abilitiesLine}</span>
            </>
          }
        />
      </div>
    </div>
  );
}

function Turn({ message, agent }) {
  if (message.role === "user") {
    const files = message.files || [];
    return (
      <div className="turn user">
        {files.length ? (
          <div className="sent-files">
            {files.map((f, i) =>
              f.kind === "image" ? (
                <img key={i} className="sent-image" src={f.dataUrl} alt={f.name} />
              ) : (
                <span key={i} className="sent-file">
                  <Icon name="file" size={14} />
                  {f.name}
                </span>
              ),
            )}
          </div>
        ) : null}
        {message.content ? <div className="bubble">{message.content}</div> : null}
      </div>
    );
  }
  if (message.role === "tool") return <ToolStep message={message} />;
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

/* A tool call: collapsed or expanded as the reader last left one (lib/prefs.js),
   and toggling it sets that for every tool call after it, in any agent's chat. */
function ToolStep({ message }) {
  const [open, setOpen] = useState(getToolsOpen);
  return (
    <details
      className={`step${message.error ? " failed" : ""}`}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return; // React's own sync of `open` fires this too
        setOpen(next);
        setToolsOpen(next);
      }}
    >
      <summary>
        <Icon name="tool" size={14} />
        <span>{message.error ? `${message.name} didn’t work` : `Used ${message.name}`}</span>
        <Icon name="chevron" size={12} />
      </summary>
      <pre>{message.content}</pre>
    </details>
  );
}
