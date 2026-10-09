import { useLayoutEffect, useState } from "react";

import { taglineOf } from "../lib/agents.js";
import { mentionAt, mentionable } from "../lib/mentions.js";
import { PRESETS } from "../lib/presets.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { GroupAvatar } from "./GroupAvatar.jsx";

/* The @ list: typing @ in a box brings up the agents it can reach, above the
 * box, narrowed as you type. ↑ ↓ to choose -- the list runs upward, so ↑ goes
 * further from the box -- Enter or Tab to take one, Escape to let it go. What
 * taking one does is the box's own business (`take`): the quickview puts the
 * agent in a chip, a group's composer writes "@Name " into the message.
 *
 * An entry with `members` stands for them all (a group's @everyone): drawn as
 * the group, and saying what it does in its own `tagline`. */

export function useMentions(agents, take) {
  const [mention, setMention] = useState(null); // { start, query }
  const [pick, setPick] = useState(0);
  const choices = mention ? mentionable(agents, mention.query) : [];
  useLayoutEffect(() => setPick(0), [mention?.query]);

  const choose = (agent) => {
    take(agent, mention);
    setMention(null);
  };

  return {
    open: Boolean(mention),
    // From the box's onChange and onSelect: is the caret just after an @?
    follow: (el) => setMention(mentionAt(el.value, el.selectionStart)),
    show: (at) => setMention(at),
    /** The box's keys while the list is up; true when the list used one. */
    onKey: (e) => {
      if (!mention || e.nativeEvent.isComposing) return false;
      if (choices.length && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const step = e.key === "ArrowUp" ? 1 : -1;
        setPick((p) => (p + step + choices.length) % choices.length);
        return true;
      }
      if (choices.length && (e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        choose(choices[Math.min(pick, choices.length - 1)]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return true;
      }
      return false;
    },
    list: mention ? (
      <ul className="mention-list" role="listbox" aria-label="Agents">
        {choices.length ? (
          choices.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === pick}>
              <button
                type="button"
                className="mention-choice"
                onMouseEnter={() => setPick(i)}
                // Keep the caret in the box.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(a)}
              >
                {a.members ? <GroupAvatar members={a.members} size={28} /> : <AgentAvatar look={a.look} name={a.name} size={28} />}
                <span className="mention-text">
                  <span className="mention-name">{a.name}</span>
                  <span className="mention-tagline">{a.tagline ?? taglineOf(a, PRESETS)}</span>
                </span>
              </button>
            </li>
          ))
        ) : (
          <li className="mention-none">{agents.length ? `No agent called “${mention.query}”` : "No agents yet."}</li>
        )}
      </ul>
    ) : null,
  };
}
