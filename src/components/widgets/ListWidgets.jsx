import { Icon } from "../Icon.jsx";
import { AgentRow, GroupRow } from "../SidebarRows.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

/* The agents, most recently talked-to first, and a way to add one. */
export function AgentsWidget({ ctx, handle }) {
  const { agents, chats, view, setView, busyChat, rowMenu, removing, busy, act } = ctx;
  return (
    <>
      <WidgetHead
        label="Agents"
        handle={handle}
        action={
          <button
            type="button"
            className="btn icon-only"
            title="Add an agent"
            aria-label="Add an agent"
            aria-pressed={view.kind === "gallery"}
            onClick={() => setView({ kind: "gallery" })}
          >
            <Icon name="plus" />
          </button>
        }
      />
      {agents.length === 0 ? (
        <p className="side-empty">No agents yet — add one to start.</p>
      ) : (
        <ul className="contacts">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              chat={chats[agent.id]}
              selected={view.kind === "agent" && view.id === agent.id}
              answering={busyChat === agent.id}
              menuOpen={rowMenu?.id === agent.id}
              removing={removing === agent.id}
              busy={busy}
              act={act}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/* The group chats, and a way to start one once there are two agents. */
export function GroupsWidget({ ctx, handle }) {
  const { agents, groups, chats, agentsById, view, busyChat, live, rowMenu, removing, busy, act, newGroup } = ctx;
  return (
    <>
      <WidgetHead
        label="Groups"
        handle={handle}
        action={
          <button
            type="button"
            className="btn icon-only"
            title={agents.length < 2 ? "Add at least two agents to make a group" : "New group"}
            aria-label="New group"
            disabled={agents.length < 2}
            onClick={newGroup}
          >
            <Icon name="plus" />
          </button>
        }
      />
      {groups.length === 0 ? (
        <p className="side-empty">{agents.length < 2 ? "Add two agents to put them in a group." : "Put agents together to talk to all of them at once."}</p>
      ) : (
        <ul className="contacts contacts-groups">
          {groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              chat={chats[group.id]}
              agentsById={agentsById}
              selected={view.kind === "group" && view.id === group.id}
              answeringId={busyChat === group.id ? live.agentId : null}
              menuOpen={rowMenu?.id === group.id}
              removing={removing === group.id}
              busy={busy}
              act={act}
            />
          ))}
        </ul>
      )}
    </>
  );
}
