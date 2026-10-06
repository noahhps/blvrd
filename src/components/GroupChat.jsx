import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { renderMarkdown } from "../lib/markdown.js";
import { useReadWidth } from "../lib/useReadWidth.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Turn } from "./Chat.jsx";
import { Composer } from "./Composer.jsx";
import { GroupAvatar } from "./GroupAvatar.jsx";
import { Icon } from "./Icon.jsx";

const GONE = { id: null, name: "A removed agent", look: { colour: "ink" } };

/* A group's chat: the reader and several agents in one thread, each answer
 * labelled with who gave it. Under the composer, who answers the next
 * message -- everyone, or the members picked (or @-mentioned in the text). */
export function GroupChat({ group, members, messages, live, busy, onSend, onStop, onEdit, onClear }) {
  const thread = useRef(null);
  const area = useRef(null);
  const stuck = useRef(true);
  const read = useReadWidth(area);
  const [picked, setPicked] = useState([]);
  const byId = new Map(members.map((m) => [m.id, m]));
  const agentOf = (id) => byId.get(id) || GONE;

  const onScroll = () => {
    const el = thread.current;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = thread.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text, live?.agentId]);

  useEffect(() => {
    stuck.current = true;
    setPicked([]);
  }, [group.id]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = (text, files, thinking) => {
    stuck.current = true;
    onSend(text, files, thinking, picked);
    setPicked([]); // the pick is for one message
  };

  const speaking = live ? agentOf(live.agentId) : null;
  const next = live?.queue?.map((id) => agentOf(id).name) || [];

  return (
    <div className="chat">
      <header className="chat-head">
        <GroupAvatar members={members} size={34} answeringId={live?.agentId} />
        <span className="chat-who">
          <span className="chat-name">{group.name}</span>
          <span className="chat-tagline">
            {members.length} agents · {members.map((m) => m.name).join(", ")}
          </span>
        </span>
        {messages.length ? (
          <button type="button" className="btn icon-only" title="Clear this chat" aria-label="Clear this chat" onClick={onClear} disabled={busy}>
            <Icon name="trash" />
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="pen" />
          Edit group
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
              <GroupAvatar members={members} size={72} />
              <h2>{group.name}</h2>
              <p>
                Everyone answers in turn. Pick who answers under the box, or write @{members[0]?.name || "Name"} -- and
                agents can hand a question to each other the same way.
              </p>
            </div>
          ) : null}
          <div className="turns">
            {messages.map((m, i) => (
              <Turn key={m.id || i} message={m} agent={m.role === "user" ? null : agentOf(m.agentId)} speaker />
            ))}
            {live && speaking ? (
              <div className="turn assistant">
                <AgentAvatar look={speaking.look} name={speaking.name} size={26} spinning />
                <div className="answer">
                  <span className="speaker">{speaking.name}</span>
                  {live.text ? (
                    <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }} />
                  ) : (
                    <p className="thinking">{live.status || "Thinking…"}</p>
                  )}
                  {next.length ? <p className="note">Then {next.join(", ")}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <Composer
          agentName={group.name}
          disabled={busy}
          provider={null}
          model={null}
          focusKey={group.id}
          autoFocus={messages.length === 0}
          onSend={send}
          onStop={onStop}
          tray={
            <>
              <span className="tray-label">Answers</span>
              <div className="who" role="group" aria-label="Who answers">
                <button type="button" className="who-chip" aria-pressed={picked.length === 0} onClick={() => setPicked([])}>
                  Everyone
                </button>
                {members.map((m) => (
                  <button key={m.id} type="button" className="who-chip" aria-pressed={picked.includes(m.id)} onClick={() => toggle(m.id)}>
                    <AgentAvatar look={m.look} name={m.name} size={14} />
                    {m.name}
                  </button>
                ))}
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
