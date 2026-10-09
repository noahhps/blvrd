/* Group chats: several agents and the reader in one conversation.
 *
 * A group's chat is one list of messages, each agent's tagged with its
 * `agentId`. Every model is still talked to the usual way -- the reader as
 * "user", the agent as "assistant" -- so each agent is shown the chat from its
 * own seat (`viewFor`): its own turns as its own, and everything anyone else
 * said as labelled lines on the user's side ("[Researcher]: ..."). That is
 * what lets agents on different models, local and hosted, share one thread.
 *
 * Who answers (`respondersFor`): the members the reader picked, then anyone
 * @-mentioned in the message, in the group's order -- and if nobody was named,
 * or the reader wrote @everyone, everyone, in turn. An agent can hand the floor on by @-mentioning another
 * member in its reply (`mentionsIn`), up to MAX_HANDOFFS times a message, so
 * agents can't talk in circles. */

export const MAX_HANDOFFS = 3;

/* @everyone: offered in the @ list beside the members, and read as "all of
 * you". Only the reader's: an agent writing it doesn't hand the floor round. */
export const EVERYONE = { id: "everyone", name: "everyone" };

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Members @-mentioned in `text`, in the order they appear, each once. */
export function mentionsIn(text, members) {
  const found = [];
  for (const m of members) {
    const name = String(m.name || "").trim();
    if (!name) continue;
    const re = new RegExp(`(^|[^\\w@])@${escape(name)}(?![\\w])`, "i");
    const hit = re.exec(String(text || ""));
    if (hit) found.push({ id: m.id, at: hit.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

/** Every @Name in `text`, where it is: [{ start, end, id }], in order. Where
 *  two names could match at once ("@Ann" and "@Ann Lee"), the longer wins. */
export function mentionSpans(text, members) {
  const spans = [];
  for (const m of members) {
    const name = String(m.name || "").trim();
    if (!name) continue;
    const re = new RegExp(`(^|[^\\w@])(@${escape(name)})(?![\\w])`, "gi");
    for (const hit of String(text || "").matchAll(re)) {
      const start = hit.index + hit[1].length;
      spans.push({ start, end: start + hit[2].length, id: m.id });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  return spans.filter((s, i) => !spans.slice(0, i).some((t) => t.start < s.end && s.start < t.end));
}

/** Whether `text` says @everyone. */
export const mentionsEveryone = (text) => mentionSpans(text, [EVERYONE]).length > 0;

/** Who answers a message, in order. */
export function respondersFor({ members, picked = [], text = "" }) {
  if (mentionsEveryone(text)) return members.map((m) => m.id);
  const wanted = new Set([...picked, ...mentionsIn(text, members)]);
  const named = members.filter((m) => wanted.has(m.id)).map((m) => m.id);
  return named.length ? named : members.map((m) => m.id);
}

/** The group's chat as `agentId` should be shown it. */
export function viewFor(agentId, messages, nameOf) {
  const out = [];
  const toUser = (text, files) => {
    const last = out[out.length - 1];
    if (last && last.role === "user") {
      last.content = [last.content, text].filter(Boolean).join("\n\n");
      if (files?.length) last.files = [...(last.files || []), ...files];
    } else {
      out.push({ role: "user", content: text, ...(files?.length ? { files } : {}) });
    }
  };
  for (const m of messages) {
    if (m.failure) continue;
    if (m.role === "user") {
      // What scheduled tasks posted since (lib/schedule.js withReports), said
      // before the user's own words rather than as theirs.
      if (m.before) toUser(m.before);
      toUser(m.content ? `[User]: ${m.content}` : "[User] sent files.", m.files);
    } else if (m.agentId === agentId) {
      // Its own turn, calls and results included, exactly as it happened.
      const { agentId: _, ...own } = m;
      out.push(own);
    } else if (m.role === "assistant" && m.content?.trim()) {
      toUser(`[${nameOf(m.agentId)}]: ${m.content.trim()}`);
    }
    // Another agent's tool calls and results are its business; its answer
    // is what the others see.
  }
  return out;
}

/** What an agent is told about the group it is answering in. */
export function groupBrief(agent, members, group, taglineOf) {
  const others = members.filter((m) => m.id !== agent.id);
  const roster = others.map((m) => `- ${m.name}: ${taglineOf(m)}`).join("\n");
  return [
    `This is a group chat${group?.name ? ` called "${group.name}"` : ""} between the user, you (${agent.name}), and ${others.length} other agent${others.length === 1 ? "" : "s"}:`,
    roster,
    `Messages from the user are shown as "[User]: ...", and from the other agents as "[Name]: ...". Reply only as yourself, without a "[${agent.name}]:" label. Add what you are best placed to add -- don't repeat what others have already said, and say so briefly if you have nothing to add. To hand a question to another agent, mention them by name with @, like @${others[0]?.name || "Name"}.`,
  ].join("\n");
}
