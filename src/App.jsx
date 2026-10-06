import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { taglineOf } from "./lib/agents.js";
import { MAX_HANDOFFS, groupBrief, mentionsIn, respondersFor, viewFor } from "./lib/group.js";
import { PRESETS } from "./lib/presets.js";
import { runTurn } from "./lib/run.js";
import { load, newId, providersOf, save } from "./lib/store.js";
import { AgentAvatar } from "./components/AgentAvatar.jsx";
import { AgentEditor } from "./components/AgentEditor.jsx";
import { Chat } from "./components/Chat.jsx";
import { Gallery } from "./components/Gallery.jsx";
import { GroupAvatar } from "./components/GroupAvatar.jsx";
import { GroupChat } from "./components/GroupChat.jsx";
import { GroupEditor } from "./components/GroupEditor.jsx";
import { Icon } from "./components/Icon.jsx";
import { Logo } from "./components/Logo.jsx";
import { Settings } from "./components/Settings.jsx";

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const lastSeen = (at) => {
  if (!at) return "";
  const when = new Date(at);
  return when.toDateString() === new Date().toDateString() ? TIME.format(when) : DAY.format(when);
};

/* What goes back to the model: the chat as kept, minus turns that failed --
 * an error is for the reader, not part of the conversation. */
const historyOf = (messages) => messages.filter((m) => !m.failure);

export default function App() {
  const [state, setState] = useState(load);
  const [view, setView] = useState(() => (state.agents.length ? { kind: "agent", id: state.agents[0].id } : { kind: "gallery" }));
  const [editor, setEditor] = useState(null); // { agent?, initial? }
  const [groupEditor, setGroupEditor] = useState(null); // { group? }
  // The answer arriving: in which chat (an agent's id or a group's), from
  // which agent, its text so far, and -- in a group -- who answers after it.
  const [live, setLive] = useState(null); // { chatId, agentId, text, status, queue }
  const running = useRef(null); // { chatId, controller }

  // Saved a moment after each change rather than on every streamed word.
  useEffect(() => {
    const timer = setTimeout(() => save(state), 300);
    return () => clearTimeout(timer);
  }, [state]);

  const providers = useMemo(() => providersOf(state), [state.providers, state.custom]);
  const agents = state.agents;
  const groups = state.groups || [];
  const selected = view.kind === "agent" ? agents.find((a) => a.id === view.id) : null;
  const selectedGroup = view.kind === "group" ? groups.find((g) => g.id === view.id) : null;
  const membersOf = (group) => (group?.members || []).map((id) => agents.find((a) => a.id === id)).filter(Boolean);

  const update = useCallback((fn) => setState((s) => ({ ...s, ...fn(s) })), []);

  /* -- agents ------------------------------------------------------------------ */

  const addAgent = (fields) => {
    const agent = { id: newId("agent"), createdAt: Date.now(), tools: null, model: null, look: null, instructions: "", ...fields };
    update((s) => ({ agents: [...s.agents, agent] }));
    setView({ kind: "agent", id: agent.id });
    return agent;
  };

  const saveAgent = (fields) => {
    if (editor?.agent) {
      const id = editor.agent.id;
      update((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...fields } : a)) }));
    } else {
      addAgent(fields);
    }
    setEditor(null);
  };

  const deleteAgent = (agent) => {
    if (!window.confirm(`Delete ${agent.name}? Its chat and notes go with it.`)) return;
    if (running.current?.chatId === agent.id) running.current.controller.abort();
    update((s) => {
      const chats = { ...s.chats };
      const notes = { ...s.notes };
      delete chats[agent.id];
      delete notes[agent.id];
      // It leaves its groups too; what it said in them stays, under its name.
      const groups = (s.groups || []).map((g) => ({ ...g, members: g.members.filter((id) => id !== agent.id) }));
      return { agents: s.agents.filter((a) => a.id !== agent.id), chats, notes, groups };
    });
    setEditor(null);
    setView({ kind: "gallery" });
  };

  const fromPreset = ({ name, instructions, look }) => ({ name, instructions, look, tools: null, model: null });

  /* -- talking ------------------------------------------------------------------- */

  const append = (chatId, message) =>
    update((s) => ({
      chats: { ...s.chats, [chatId]: [...(s.chats[chatId] || []), { id: newId("m"), at: Date.now(), ...message }] },
    }));

  const modelFor = (agent) => {
    const choice = agent?.model?.model ? agent.model : state.defaultModel;
    if (!choice?.model) return null;
    const provider = providers.find((p) => p.id === choice.provider);
    return provider ? { provider, model: choice.model } : null;
  };

  const notebookOf = (agentId) => ({
    // Read when the tool runs, from the latest state, so a note saved earlier
    // in the same turn is already there.
    notes: () => stateRef.current.notes[agentId] || [],
    addNote: (note) =>
      update((s) => ({ notes: { ...s.notes, [agentId]: [...(s.notes[agentId] || []), { text: note, at: Date.now() }] } })),
  });

  /* One agent's turn, in whichever chat. Everything it says is appended to
   * `chatId` with `tag` added (a group tags each message with its agent), and
   * returned. Throws STOPPED when the reader stops it. */
  const STOPPED = "stopped";
  const answerAs = async ({ agent, chatId, history, controller, thinking = null, context = "", tag = {}, queue = [] }) => {
    const target = modelFor(agent);
    const fail = (failure) => {
      append(chatId, { role: "assistant", failure, ...tag });
      return [];
    };
    if (!target) return fail(`No model chosen for ${agent.name} yet. Pick a default model in Settings, or give ${agent.name} its own with Customize.`);
    if (!target.provider.enabled) return fail(`${target.provider.name} is switched off in Settings.`);

    setLive({ chatId, agentId: agent.id, text: "", status: "", queue });
    const said = [];
    try {
      await runTurn({
        agent,
        provider: target.provider,
        model: target.model,
        history,
        signal: controller.signal,
        notebook: notebookOf(agent.id),
        thinking,
        context,
        emit: (event) => {
          if (event.type === "text") setLive((l) => l && { ...l, text: l.text + event.delta, status: "" });
          else if (event.type === "retext") setLive((l) => l && { ...l, text: event.text });
          else if (event.type === "message") {
            const message = { ...event.message, ...tag };
            append(chatId, message);
            said.push(message);
            const calling = message.role === "assistant" && message.calls?.length;
            setLive((l) => l && { ...l, text: "", status: calling ? `Using ${message.calls.map((c) => c.name).join(", ")}…` : "" });
          }
        },
      });
    } catch (problem) {
      if (controller.signal.aborted) {
        append(chatId, { role: "assistant", content: liveRef.current?.text || "", calls: [], note: "Stopped.", ...tag });
        throw STOPPED;
      }
      return fail(explain(problem, target));
    }
    return said;
  };

  const send = async (text, files = [], thinking = null) => {
    const agent = selected;
    if (!agent || running.current) return;
    const user = { role: "user", content: text, ...(files.length ? { files } : {}) };
    const history = [...historyOf(state.chats[agent.id] || []), user];
    append(agent.id, user);
    const controller = new AbortController();
    running.current = { chatId: agent.id, controller };
    try {
      await answerAs({ agent, chatId: agent.id, history, controller, thinking });
    } catch (stopped) {
      if (stopped !== STOPPED) throw stopped;
    } finally {
      running.current = null;
      setLive(null);
    }
  };

  /* A message to a group. The members it is for answer one after another,
   * each shown the chat as it stands -- earlier answers in this round
   * included -- from its own seat (lib/group.js). An answer that @-mentions
   * another member brings that member in next, up to MAX_HANDOFFS times. */
  const sendGroup = async (text, files = [], _thinking = null, picked = []) => {
    const group = selectedGroup;
    if (!group || running.current) return;
    const members = membersOf(group);
    if (!members.length) return;
    const user = { role: "user", content: text, ...(files.length ? { files } : {}) };
    const transcript = [...historyOf(state.chats[group.id] || []), user];
    append(group.id, user);

    const nameOf = (id) => agents.find((a) => a.id === id)?.name || "A removed agent";
    const queue = respondersFor({ members, picked, text });
    const controller = new AbortController();
    running.current = { chatId: group.id, controller };
    let handoffs = 0;
    try {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift();
        const agent = members.find((m) => m.id === id);
        if (!agent) continue;
        const said = await answerAs({
          agent,
          chatId: group.id,
          history: viewFor(agent.id, transcript, nameOf),
          controller,
          context: groupBrief(agent, members, group, (m) => taglineOf(m, PRESETS)),
          tag: { agentId: agent.id },
          queue: [...queue],
        });
        transcript.push(...said);
        // Handing on: members named in this answer, not already waiting, next.
        const reply = said.filter((m) => m.role === "assistant").map((m) => m.content || "").join("\n");
        const named = mentionsIn(reply, members).filter((id) => id !== agent.id && !queue.includes(id));
        for (const id of named.reverse()) {
          if (handoffs >= MAX_HANDOFFS) break;
          queue.unshift(id);
          handoffs += 1;
        }
      }
    } catch (stopped) {
      if (stopped !== STOPPED) throw stopped;
    } finally {
      running.current = null;
      setLive(null);
    }
  };

  const stateRef = useRef(state);
  stateRef.current = state;
  const liveRef = useRef(live);
  liveRef.current = live;

  const stop = () => running.current?.controller.abort();

  const clearChat = () => {
    if (!selected || !window.confirm(`Clear your chat with ${selected.name}? Its notes are kept.`)) return;
    update((s) => ({ chats: { ...s.chats, [selected.id]: [] } }));
  };

  /* -- groups --------------------------------------------------------------------- */

  const saveGroup = ({ name, members }) => {
    if (groupEditor?.group) {
      const id = groupEditor.group.id;
      update((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name, members } : g)) }));
    } else {
      const group = { id: newId("group"), name, members, createdAt: Date.now() };
      update((s) => ({ groups: [...(s.groups || []), group] }));
      setView({ kind: "group", id: group.id });
    }
    setGroupEditor(null);
  };

  const deleteGroup = (group) => {
    if (!window.confirm(`Delete the group ${group.name}? Its chat goes with it; the agents stay.`)) return;
    if (running.current?.chatId === group.id) running.current.controller.abort();
    update((s) => {
      const chats = { ...s.chats };
      delete chats[group.id];
      return { groups: s.groups.filter((g) => g.id !== group.id), chats };
    });
    setGroupEditor(null);
    setView(agents.length ? { kind: "agent", id: agents[0].id } : { kind: "gallery" });
  };

  const clearGroup = () => {
    if (!selectedGroup || !window.confirm(`Clear the chat in ${selectedGroup.name}?`)) return;
    update((s) => ({ chats: { ...s.chats, [selectedGroup.id]: [] } }));
  };

  /* -- settings ------------------------------------------------------------------ */

  const setProvider = (id, patch) =>
    update((s) => {
      if (s.custom.some((p) => p.id === id)) {
        return { custom: s.custom.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
      }
      return { providers: { ...s.providers, [id]: { ...(s.providers[id] || {}), ...patch } } };
    });

  const addCustom = ({ name, base, key }) =>
    update((s) => ({ custom: [...s.custom, { id: newId("server"), kind: "openai", name, base, key, enabled: true }] }));

  const removeCustom = (id) => update((s) => ({ custom: s.custom.filter((p) => p.id !== id) }));

  // Links in answers and in Settings open in the reader's browser, not in the app.
  useEffect(() => {
    const onClick = async (event) => {
      const link = event.target.closest?.("a[target=_blank]");
      if (!link || !("__TAURI_INTERNALS__" in window)) return;
      event.preventDefault();
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      openUrl(link.href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const busyChat = live?.chatId;
  const target = selected ? modelFor(selected) : null;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <Logo size={26} />
          <span className="wordmark">blvrd</span>
        </div>

        <div className="side-head">
          <span className="label">Agents</span>
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
        </div>

        {agents.length === 0 ? (
          <p className="side-empty">No agents yet -- add one to start.</p>
        ) : (
          <ul className="contacts">
            {agents.map((agent) => {
              const chat = state.chats[agent.id] || [];
              const last = chat[chat.length - 1];
              const answering = busyChat === agent.id;
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    className="contact"
                    aria-current={selected?.id === agent.id ? "true" : undefined}
                    onClick={() => setView({ kind: "agent", id: agent.id })}
                  >
                    <AgentAvatar look={agent.look} name={agent.name} size={34} spinning={answering} />
                    <span className="contact-text">
                      <span className="contact-top">
                        <span className="contact-name">{agent.name}</span>
                        {last?.at ? <span className="contact-when">{lastSeen(last.at)}</span> : null}
                      </span>
                      <span className="contact-line">
                        {answering ? "answering…" : last ? preview(last) : taglineOf(agent, PRESETS)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="side-head side-head-groups">
          <span className="label">Groups</span>
          <button
            type="button"
            className="btn icon-only"
            title={agents.length < 2 ? "Add at least two agents to make a group" : "New group"}
            aria-label="New group"
            disabled={agents.length < 2}
            onClick={() => setGroupEditor({})}
          >
            <Icon name="plus" />
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="side-empty">{agents.length < 2 ? "Add two agents to put them in a group." : "Put agents together to talk to all of them at once."}</p>
        ) : (
          <ul className="contacts contacts-groups">
            {groups.map((group) => {
              const chat = state.chats[group.id] || [];
              const last = chat[chat.length - 1];
              const answering = busyChat === group.id;
              const answerer = answering ? agents.find((a) => a.id === live.agentId) : null;
              const who = last?.agentId ? agents.find((a) => a.id === last.agentId)?.name : null;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className="contact"
                    aria-current={selectedGroup?.id === group.id ? "true" : undefined}
                    onClick={() => setView({ kind: "group", id: group.id })}
                  >
                    <GroupAvatar members={membersOf(group)} size={34} answeringId={answering ? live.agentId : null} />
                    <span className="contact-text">
                      <span className="contact-top">
                        <span className="contact-name">{group.name}</span>
                        {last?.at ? <span className="contact-when">{lastSeen(last.at)}</span> : null}
                      </span>
                      <span className="contact-line">
                        {answering
                          ? `${answerer?.name || "Someone"} is answering…`
                          : last
                            ? (who ? `${who}: ` : "") + preview(last)
                            : `${membersOf(group).length} agents`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          className="side-settings"
          aria-current={view.kind === "settings" ? "true" : undefined}
          onClick={() => setView({ kind: "settings" })}
        >
          <Icon name="gear" />
          Models
          {!state.defaultModel?.model ? <span className="dot" title="No default model yet" /> : null}
        </button>
      </aside>

      <main className="main">
        {view.kind === "settings" ? (
          <Settings
            providers={providers}
            defaultModel={state.defaultModel}
            onDefaultModel={(defaultModel) => update(() => ({ defaultModel }))}
            onProvider={setProvider}
            onAddCustom={addCustom}
            onRemoveCustom={removeCustom}
          />
        ) : selected ? (
          <Chat
            agent={selected}
            presets={PRESETS}
            messages={state.chats[selected.id] || []}
            live={live?.chatId === selected.id ? live : null}
            busy={Boolean(live)}
            model={target?.model}
            provider={target?.provider}
            providers={providers}
            defaultModel={state.defaultModel}
            onModel={(model) => {
              const id = selected.id;
              update((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, model } : a)) }));
            }}
            onSend={send}
            onStop={stop}
            onClear={clearChat}
            onCustomize={() => setEditor({ agent: selected })}
          />
        ) : selectedGroup ? (
          <GroupChat
            group={selectedGroup}
            members={membersOf(selectedGroup)}
            messages={state.chats[selectedGroup.id] || []}
            live={live?.chatId === selectedGroup.id ? live : null}
            busy={Boolean(live)}
            onSend={sendGroup}
            onStop={stop}
            onClear={clearGroup}
            onEdit={() => setGroupEditor({ group: selectedGroup })}
          />
        ) : (
          <Gallery
            presets={PRESETS}
            firstRun={agents.length === 0}
            onNew={() => setEditor({ initial: null })}
            onAdd={(preset) => addAgent(fromPreset(preset))}
            onCustomize={(preset) => setEditor({ initial: fromPreset(preset) })}
          />
        )}
      </main>

      {groupEditor ? (
        <GroupEditor
          group={groupEditor.group || null}
          agents={agents}
          presets={PRESETS}
          onSave={saveGroup}
          onDelete={deleteGroup}
          onClose={() => setGroupEditor(null)}
        />
      ) : null}

      {editor ? (
        <AgentEditor
          agent={editor.agent || null}
          initial={editor.initial}
          providers={providers}
          defaultModel={state.defaultModel}
          onSave={saveAgent}
          onDelete={deleteAgent}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}

function preview(message) {
  if (message.failure) return "Something went wrong";
  if (message.role === "tool") return `Used ${message.name}`;
  if (message.role === "user" && !message.content && message.files?.length) {
    return `You: ${message.files.map((f) => f.name).join(", ")}`;
  }
  const text = (message.content || message.note || "")
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (message.role === "user" ? "You: " : "") + text;
}

/* An error as a sentence the reader can act on. */
function explain(problem, { provider, model }) {
  const text = problem?.message || String(problem);
  if (/Failed to fetch|NetworkError|ECONNREFUSED|error sending request|Connection refused|Load failed/i.test(text)) {
    return provider.keys
      ? `Could not reach ${provider.name}. Check your connection.`
      : `${provider.name} isn't answering at ${provider.base}. Is it running? (Settings → Find local servers.)`;
  }
  if (/\b401\b|\b403\b|authentication|api key|x-api-key/i.test(text)) {
    return `${provider.name} turned the key down. Check it in Settings. (${text})`;
  }
  if (/\b404\b|not found|model .* (does not exist|not found)/i.test(text)) {
    return `${provider.name} has no model called "${model}". ${provider.kind === "ollama" ? `Try \`ollama pull ${model}\`, or ` : ""}choose another in Customize. (${text})`;
  }
  return text;
}
