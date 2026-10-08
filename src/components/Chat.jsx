import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { hostOf, isLocalUrl } from "../lib/catalog.js";
import { getToolsOpen, setToolsOpen } from "../lib/prefs.js";
import { renderMarkdown } from "../lib/markdown.js";
import { timeline } from "../lib/timeline.js";
import { TOOLS, toolsFor } from "../lib/tools.js";
import { launchFrom, useLaunch } from "../lib/launch.js";
import { useReadWidth } from "../lib/useReadWidth.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Approval } from "./Approval.jsx";
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
  onCompact,
  canCompact = false,
  approval = null,
  onApprove,
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
  }, [messages.length, live?.text, live?.parts?.length]);
  // After the scroll above, so the sent bubble is measured where it rests.
  useLaunch(thread, messages.length);

  useEffect(() => {
    stuck.current = true;
  }, [agent.id]);

  const send = (text, files, thinking) => {
    stuck.current = true;
    launchFrom(area.current?.querySelector(".composer textarea"));
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
        : "No abilities — talk only";

  const defaultLabel = defaultModel?.model ? `Default (${defaultModel.model})` : "Default model";

  return (
    <div className="chat">
      <header className="chat-head" data-tauri-drag-region>
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
          <button
            type="button"
            className="btn icon-only compact"
            title={canCompact ? "Compact: summarize the earlier messages" : "Nothing to compact yet"}
            aria-label="Compact this chat"
            onClick={onCompact}
            disabled={busy || !canCompact}
          >
            <Icon name="compact" />
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
            {timeline(messages, Boolean(live)).map(({ key, message }) => (
              <Turn key={key} message={message} agent={agent} />
            ))}
            {live ? <LiveTurn live={live} agent={agent} /> : null}
            <Approval request={approval} onAnswer={onApprove} />
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

/* The answer still arriving, its text and calls in the order they come. */
export function LiveTurn({ live, agent, speaker = false, after = null }) {
  const parts = live.parts?.length ? live.parts : live.text ? [{ type: "text", text: live.text }] : [];
  const lastText = parts.findLastIndex((p) => p.type === "text");
  const out = [];
  let seenText = false;
  parts.forEach((part, i) => {
    if (part.type === "call") {
      out.push(<PendingStep key={i} name={part.name} who={speaker ? agent.name : null} pending />);
      return;
    }
    out.push(
      <div className="turn assistant" key={i}>
        <AgentAvatar look={agent.look} name={agent.name} size={26} spinning={i === lastText && i === parts.length - 1} />
        <div className="answer">
          {speaker && !seenText ? <span className="speaker">{agent.name}</span> : null}
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }} />
          {i === parts.length - 1 ? after : null}
        </div>
      </div>,
    );
    seenText = true;
  });
  // Waiting on the model, or on a tool: say so under whatever came before.
  if (!parts.length || parts[parts.length - 1].type === "call") {
    out.push(
      <div className="turn assistant" key="waiting">
        <AgentAvatar look={agent.look} name={agent.name} size={26} spinning />
        <div className="answer">
          {speaker && !seenText ? <span className="speaker">{agent.name}</span> : null}
          <p className="thinking">{parts.length ? "Working…" : live.status || "Thinking…"}</p>
          {after}
        </div>
      </div>,
    );
  }
  return out;
}

/* One message. `speaker` labels an agent's turn with its name -- in a group,
   where more than one agent answers in the same thread. */
export function Turn({ message, agent, speaker = false }) {
  // Only a message sent just now rises in from the composer; opening a chat
  // shows what was already said as it stands.
  const [fresh] = useState(() => message.role === "user" && Date.now() - (message.at || 0) < 1000);
  if (message.role === "user") {
    const files = message.files || [];
    return (
      <div className="turn user" data-sent={fresh ? "" : undefined}>
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
  if (message.role === "summary") return <SummaryMark message={message} />;
  if (message.role === "chain") return <ToolChain steps={message.steps} who={speaker ? agent?.name : null} />;
  if (message.role === "tool" && message.unfinished) return <PendingStep name={message.name} who={speaker ? agent?.name : null} />;
  if (message.role === "tool") return <ToolStep message={message} who={speaker ? agent.name : null} />;
  const label = speaker ? <span className="speaker">{agent.name}</span> : null;
  if (message.failure) {
    return (
      <div className="turn assistant">
        <AgentAvatar look={agent.look} name={agent.name} size={26} />
        <div className="answer">
          {label}
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
        {label}
        {hasText ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} /> : null}
        {message.note ? <p className="note">{message.note}</p> : null}
      </div>
    </div>
  );
}

/* Where a long chat was folded up (lib/compact.js): what's above it is no
   longer sent to the model, only this summary of it. Open it to read it. */
function SummaryMark({ message }) {
  return (
    <details className="summary-mark">
      <summary>
        <span>Earlier messages summarized</span>
        <Icon name="chevron" size={12} />
      </summary>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content || "") }} />
    </details>
  );
}

/* A call made but not answered: running now, or cut short by a stop. */
function PendingStep({ name, who = null, pending = false }) {
  return (
    <div className="step pending">
      <span className="step-pill">
        <Icon name="tool" size={14} />
        <span>{pending ? `${who ? `${who} is using` : "Using"} ${name}…` : `${who ? `${who}’s ` : ""}${name} didn’t finish`}</span>
      </span>
    </div>
  );
}

/* Open or shut as the reader last left a tool call or chain (lib/prefs.js);
   toggling one sets that for every one after it, in any agent's chat. A step
   inside a chain (`remember` off) starts shut and is its own business. */
function useStepOpen(remember = true) {
  const [open, setOpen] = useState(() => remember && getToolsOpen());
  const onToggle = (e) => {
    const next = e.currentTarget.open;
    if (next === open) return; // React's own sync of `open` fires this too
    setOpen(next);
    if (remember) setToolsOpen(next);
  };
  return { open, onToggle };
}

/* Calls made back to back, as one step: their names when shut, each call
   (itself opened for its result) when open. */
function ToolChain({ steps, who = null }) {
  const toggle = useStepOpen();
  const names = [...new Set(steps.map((m) => m.name))];
  const shown = names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ");
  const failed = steps.some((m) => m.error || m.declined || m.unfinished);
  return (
    <details className={`step chain${failed ? " failed" : ""}`} {...toggle}>
      <summary>
        <Icon name="tool" size={14} />
        <span>
          {who ? `${who} used` : "Used"} {shown}
          {steps.length > names.length ? ` · ${steps.length} calls` : ""}
        </span>
        <Icon name="chevron" size={12} />
      </summary>
      <div className="chain-steps">
        {steps.map((m, i) =>
          m.unfinished ? <PendingStep key={i} name={m.name} /> : <ToolStep key={m.id || i} message={m} remember={false} />,
        )}
      </div>
    </details>
  );
}

/* A tool call: shut or open for its result. */
function ToolStep({ message, who = null, remember = true }) {
  const toggle = useStepOpen(remember);
  return (
    <details className={`step${message.error ? " failed" : ""}`} {...toggle}>
      <summary>
        <Icon name="tool" size={14} />
        <span>
          {message.declined
            ? `${message.name} wasn’t allowed`
            : message.error
              ? `${who ? `${who}’s ` : ""}${message.name} didn’t work`
              : `${who ? `${who} used` : "Used"} ${message.name}`}
        </span>
        <Icon name="chevron" size={12} />
      </summary>
      <pre>{message.content}</pre>
    </details>
  );
}
