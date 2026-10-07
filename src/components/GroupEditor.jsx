import { useEffect, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { GroupAvatar } from "./GroupAvatar.jsx";
import { Icon } from "./Icon.jsx";

/**
 * Make or change a group: a name and two or more of the reader's agents.
 * Members answer in the order they're listed here.
 */
export function GroupEditor({ group, agents, presets, onSave, onDelete, onClose }) {
  const [name, setName] = useState(group?.name || "");
  const [members, setMembers] = useState(() => (group?.members || []).filter((id) => agents.some((a) => a.id === id)));
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ticked members keep the order they were added in -- that is the order
  // they answer in.
  const toggle = (id) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const chosen = members.map((id) => agents.find((a) => a.id === id)).filter(Boolean);

  const save = () => {
    const title = name.trim() || chosen.map((a) => a.name).join(", ");
    if (chosen.length < 2) return setError("A group needs at least two agents.");
    onSave({ name: title, members });
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={group ? "Edit group" : "New group"}>
        <button type="button" className="sheet-close btn icon-only" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>

        <div className="sheet-head">
          <GroupAvatar members={chosen.length ? chosen : agents.slice(0, 2)} size={80} />
          <input
            className="sheet-name"
            type="text"
            value={name}
            placeholder={chosen.length ? chosen.map((a) => a.name).join(", ") : "Name the group"}
            aria-label="Group name"
            autoFocus={!group}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="sheet-body">
          <section className="field">
            <span className="label">
              Members · {chosen.length}
              {chosen.length > 1 ? " — they answer in this order" : ""}
            </span>
            <ul className="member-list">
              {agents.map((agent) => {
                const on = members.includes(agent.id);
                return (
                  <li key={agent.id}>
                    <label className="member" data-on={on ? "" : undefined}>
                      <input type="checkbox" checked={on} onChange={() => toggle(agent.id)} />
                      <AgentAvatar look={agent.look} name={agent.name} size={30} />
                      <span className="member-text">
                        <span className="member-name">{agent.name}</span>
                        <span className="member-line">{taglineOf(agent, presets)}</span>
                      </span>
                      {on ? <span className="member-order">{members.indexOf(agent.id) + 1}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {error ? <p className="error-line">{error}</p> : null}

        <div className="sheet-actions">
          {group ? (
            <button type="button" className="btn danger" onClick={() => onDelete(group)}>
              <Icon name="trash" />
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={chosen.length < 2}>
            {group ? "Save" : "Make group"}
          </button>
        </div>
      </div>
    </div>
  );
}
