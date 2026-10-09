import { memo, useMemo } from "react";

import { taglineOf } from "../lib/agents.js";
import { canCompact as canCompactChat } from "../lib/compact.js";
import { PRESETS } from "../lib/presets.js";
import { agentCount, lastLine, shortWhen, speakerName } from "../lib/preview.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { GroupAvatar } from "./GroupAvatar.jsx";
import { Icon } from "./Icon.jsx";
import { SwipeRow } from "./SwipeRow.jsx";

/* The sidebar's rows: an agent's conversation, and a group's.
 *
 * Each is memoized and given only what it shows -- its own chat, whether it
 * is selected or answering -- plus one stable `act` for everything it can
 * do (App.jsx). So an answer streaming in, which re-renders the app with
 * every word, re-renders no row but the one answering: with hundreds of
 * conversations that is the difference between smooth and stuttering. */

const NO_CHAT = [];

function Row({ kind, id, name, title, menuOpen, removing, busy, canCompact, onDelete, onCompact, act, selected, avatar, when, line }) {
  return (
    <SwipeRow
      data-menu={menuOpen ? "" : undefined}
      removing={removing}
      onLeft={onDelete}
      onRight={onCompact}
      rightDisabled={busy || !canCompact}
    >
      <button
        type="button"
        className="contact"
        aria-current={selected ? "true" : undefined}
        onClick={() => act("view", kind, id)}
        onContextMenu={(e) => act("menu", e, kind, id)}
      >
        {avatar}
        <span className="contact-text">
          <span className="contact-top">
            {/* Cut short when long; the whole name on hover. */}
            <span className="contact-name" title={title}>
              {name}
            </span>
            {when ? <span className="contact-when">{when}</span> : null}
          </span>
          <span className="contact-line">{line}</span>
        </span>
      </button>
      <button type="button" className="contact-more" aria-label={`More for ${name}`} onClick={(e) => act("menu", e, kind, id)}>
        <Icon name="more" size={16} />
      </button>
    </SwipeRow>
  );
}

export const AgentRow = memo(function AgentRow({ agent, chat = NO_CHAT, selected, answering, menuOpen, removing, busy, act }) {
  const last = chat[chat.length - 1];
  const said = useMemo(() => lastLine(chat), [chat]);
  return (
    <Row
      kind="agent"
      id={agent.id}
      name={agent.name}
      title={agent.name}
      selected={selected}
      menuOpen={menuOpen}
      removing={removing}
      busy={busy}
      canCompact={canCompactChat(chat)}
      act={act}
      onDelete={() => act("deleteAgent", agent)}
      onCompact={() => act("compact", agent.id, agent)}
      avatar={<AgentAvatar look={agent.look} name={agent.name} size={34} spinning={answering} />}
      when={shortWhen(last?.at)}
      line={answering ? "answering…" : said ? said.text : taglineOf(agent, PRESETS)}
    />
  );
});

export const GroupRow = memo(function GroupRow({ group, chat = NO_CHAT, agentsById, selected, answeringId, menuOpen, removing, busy, act }) {
  const last = chat[chat.length - 1];
  const members = useMemo(() => group.members.map((id) => agentsById.get(id)).filter(Boolean), [group.members, agentsById]);
  const said = useMemo(() => lastLine(chat), [chat]);

  let line;
  if (answeringId) line = `${agentsById.get(answeringId)?.name || "Someone"} is answering…`;
  else if (!members.length) line = agentCount(0);
  else if (said) {
    // Who said it, short enough to leave room for what they said.
    const speaker = said.message.agentId ? agentsById.get(said.message.agentId) : null;
    const others = members.filter((m) => m.id !== speaker?.id).map((m) => m.name);
    line = speaker ? `${speakerName(speaker.name, others)}: ${said.text}` : said.text;
  } else line = agentCount(members.length);

  return (
    <Row
      kind="group"
      id={group.id}
      name={group.name}
      title={group.name}
      selected={selected}
      menuOpen={menuOpen}
      removing={removing}
      busy={busy}
      canCompact={members.length > 0 && canCompactChat(chat)}
      act={act}
      onDelete={() => act("deleteGroup", group)}
      onCompact={() => act("compact", group.id, members[0])}
      avatar={<GroupAvatar members={members} size={34} answeringId={answeringId} />}
      when={shortWhen(last?.at)}
      line={line}
    />
  );
});
