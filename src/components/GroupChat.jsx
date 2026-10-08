import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { agentCount } from "../lib/preview.js";
import { launchFrom, useLaunch } from "../lib/launch.js";
import { useReadWidth } from "../lib/useReadWidth.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Approval } from "./Approval.jsx";
import { timeline } from "../lib/timeline.js";
import { LiveTurn, Turn } from "./Chat.jsx";
import { Composer } from "./Composer.jsx";
import { GroupAvatar } from "./GroupAvatar.jsx";
import { Icon } from "./Icon.jsx";

const GONE = { id: null, name: "A removed agent", look: { colour: "ink" } };
const NO_MEMBERS = "This group has no agents left. Add some with Edit group.";

/* A group's chat: the reader and several agents in one thread, each answer
 * labelled with who gave it. Under the composer, who answers the next
 * message -- everyone, or the members picked (or @-mentioned in the text). */
export function GroupChat({ group, members, messages, live, busy, onSend, onStop, onEdit, onCompact, canCompact = false, approval = null, onApprove }) {
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
  }, [messages.length, live?.text, live?.parts?.length, live?.agentId]);
  // After the scroll above, so the sent bubble is measured where it rests.
  useLaunch(thread, messages.length);

  useEffect(() => {
    stuck.current = true;
    setPicked([]);
  }, [group.id]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = (text, files, thinking) => {
    stuck.current = true;
    launchFrom(area.current?.querySelector(".composer textarea"));
    onSend(text, files, thinking, picked);
    setPicked([]); // the pick is for one message
  };

  const speaking = live ? agentOf(live.agentId) : null;
  const next = live?.queue?.map((id) => agentOf(id).name) || [];

  return (
    <div className="chat">
      <header className="chat-head" data-tauri-drag-region>
        <GroupAvatar members={members} size={34} answeringId={live?.agentId} />
        <span className="chat-who">
          <span className="chat-name">{group.name}</span>
          <span className="chat-tagline">
            {agentCount(members.length)}
            {members.length ? ` · ${members.map((m) => m.name).join(", ")}` : ""}
          </span>
        </span>
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
              {members.length ? (
                <p>
                  Everyone answers in turn. Pick who answers under the box, or write @{members[0].name} — and agents can
                  hand a question to each other the same way.
                </p>
              ) : (
                <p>{NO_MEMBERS}</p>
              )}
            </div>
          ) : null}
          <div className="turns">
            {timeline(messages, Boolean(live)).map(({ key, message }) => (
              <Turn key={key} message={message} agent={message.role === "user" ? null : agentOf(message.agentId)} speaker />
            ))}
            {live && speaking ? (
              <LiveTurn live={live} agent={speaking} speaker after={next.length ? <p className="note">Then {next.join(", ")}</p> : null} />
            ) : null}
            <Approval request={approval} onAnswer={onApprove} />
          </div>
        </div>

        <Composer
          agentName={group.name}
          disabled={busy}
          blocked={members.length ? null : NO_MEMBERS}
          provider={null}
          model={null}
          focusKey={group.id}
          autoFocus={messages.length === 0}
          mentions={members}
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
