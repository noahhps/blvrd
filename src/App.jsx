import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { taglineOf } from "./lib/agents.js";
import { PRESETS } from "./lib/presets.js";
import { runTurn } from "./lib/run.js";
import { load, newId, providersOf, save } from "./lib/store.js";
import { AgentAvatar } from "./components/AgentAvatar.jsx";
import { AgentEditor } from "./components/AgentEditor.jsx";
import { Chat } from "./components/Chat.jsx";
import { Gallery } from "./components/Gallery.jsx";
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
  const [live, setLive] = useState(null); // { agentId, text, status }
  const running = useRef(null); // { agentId, controller }

  // Saved a moment after each change rather than on every streamed word.
  useEffect(() => {
    const timer = setTimeout(() => save(state), 300);
    return () => clearTimeout(timer);
  }, [state]);

  const providers = useMemo(() => providersOf(state), [state.providers, state.custom]);
  const agents = state.agents;
  const selected = view.kind === "agent" ? agents.find((a) => a.id === view.id) : null;

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
    if (running.current?.agentId === agent.id) running.current.controller.abort();
    update((s) => {
      const chats = { ...s.chats };
      const notes = { ...s.notes };
      delete chats[agent.id];
      delete notes[agent.id];
      return { agents: s.agents.filter((a) => a.id !== agent.id), chats, notes };
    });
    setEditor(null);
    setView({ kind: "gallery" });
  };

  const fromPreset = ({ name, instructions, look }) => ({ name, instructions, look, tools: null, model: null });

  /* -- talking ------------------------------------------------------------------- */

  const append = (agentId, message) =>
    update((s) => ({
      chats: { ...s.chats, [agentId]: [...(s.chats[agentId] || []), { id: newId("m"), at: Date.now(), ...message }] },
    }));

  const modelFor = (agent) => {
    const choice = agent?.model?.model ? agent.model : state.defaultModel;
    if (!choice?.model) return null;
    const provider = providers.find((p) => p.id === choice.provider);
    return provider ? { provider, model: choice.model } : null;
  };

  const send = async (text, files = [], thinking = null) => {
    const agent = selected;
    if (!agent || running.current) return;
    const target = modelFor(agent);
    const user = { role: "user", content: text, ...(files.length ? { files } : {}) };
    const history = [...historyOf(state.chats[agent.id] || []), user];
    append(agent.id, user);

    if (!target) {
      append(agent.id, { role: "assistant", failure: "No model chosen yet. Pick a default model in Settings, or give this agent its own with Customize." });
      return;
    }
    if (!target.provider.enabled) {
      append(agent.id, { role: "assistant", failure: `${target.provider.name} is switched off in Settings.` });
      return;
    }

    const controller = new AbortController();
    running.current = { agentId: agent.id, controller };
    setLive({ agentId: agent.id, text: "", status: "" });

    // Notes are read when the tool runs, from the latest state, so a note
    // saved earlier in the same turn is already there.
    const notebook = {
      notes: () => stateRef.current.notes[agent.id] || [],
      addNote: (note) =>
        update((s) => ({ notes: { ...s.notes, [agent.id]: [...(s.notes[agent.id] || []), { text: note, at: Date.now() }] } })),
    };

    try {
      await runTurn({
        agent,
        provider: target.provider,
        model: target.model,
        history,
        signal: controller.signal,
        notebook,
        thinking,
        emit: (event) => {
          if (event.type === "text") setLive((l) => l && { ...l, text: l.text + event.delta, status: "" });
          else if (event.type === "retext") setLive((l) => l && { ...l, text: event.text });
          else if (event.type === "message") {
            append(agent.id, event.message);
            const calling = event.message.role === "assistant" && event.message.calls?.length;
            setLive((l) => l && { ...l, text: "", status: calling ? `Using ${event.message.calls.map((c) => c.name).join(", ")}…` : "" });
          }
        },
      });
    } catch (problem) {
      if (controller.signal.aborted) {
        const partial = liveRef.current?.text;
        append(agent.id, { role: "assistant", content: partial || "", calls: [], note: "Stopped." });
      } else {
        append(agent.id, { role: "assistant", failure: explain(problem, target) });
      }
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

  const busyAgent = live?.agentId;
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
              const answering = busyAgent === agent.id;
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
            live={live?.agentId === selected.id ? live : null}
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
