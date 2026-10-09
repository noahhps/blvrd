import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { taglineOf } from "./lib/agents.js";
import { connectorTools, groupsOf } from "./lib/connectors/index.js";
import { MAX_HANDOFFS, groupBrief, mentionsIn, respondersFor, viewFor } from "./lib/group.js";
import { PRESETS } from "./lib/presets.js";
import { runTurn } from "./lib/run.js";
import { ADAPTERS } from "./lib/providers.js";
import { discover, getProfile, usableWindow } from "./lib/profile.js";
import { computerTaskTool } from "./lib/computer/task.js";
import { openComputer, stopComputer, whereOf } from "./lib/computer/connection.js";
import { load, newId, providersOf, save } from "./lib/store.js";
import { loadFiles, withFiles } from "./lib/fileStore.js";
import { TOOLS, toolsFor } from "./lib/tools.js";
import { inDesktop } from "./lib/http.js";
import { invoke, listen } from "./lib/desktop.js";
import { tellOS } from "./lib/notify.js";
import { searchOf } from "./lib/search.js";
import { NOTEBOOK_TOOLS, notebookBrief } from "./lib/notebookTools.js";
import { behindNote } from "./lib/notebookSync.js";
import { MEMORY_TOOLS, migrateNotes, readMemory, removeMemory } from "./lib/agentMemory.js";
import { notebook, provideLive, ready as notebookReady } from "./lib/notebook.js";
import { agentsRows, calendarRows, groupsRows, musicRows, setupRows } from "./lib/liveRows.js";
import { eventsAhead } from "./lib/useMonthEvents.js";
import { readNowPlaying } from "./lib/music.js";
import { hostOf, isLocalUrl } from "./lib/catalog.js";
import { useArcMood } from "./lib/useArcMood.js";
import {
  PAUSE_AFTER_FAILURES,
  RUN_LIMIT_MS,
  SCHEDULE_GROUP,
  afterRun,
  dueTasks,
  isActive,
  isMissed,
  isNothingNew,
  missedOf,
  reportOf,
  runPrompt,
  scheduleTools,
  soonest,
  withPause,
  withReports,
} from "./lib/schedule.js";
import { canFold, compact, compactAtOf, sinceSummary, summaryContext, tooLong, withSummary } from "./lib/compact.js";
import { QUICK_SEND, holdShortcut, shortcutOf, showMain, toggleQuick } from "./lib/quick.js";
import { AgentEditor } from "./components/AgentEditor.jsx";
import { CalendarView } from "./components/CalendarView.jsx";
import { NotebookView } from "./components/NotebookView.jsx";
import { DragChip } from "./components/DragChip.jsx";
import { Chat } from "./components/Chat.jsx";
import { Connectors } from "./components/Connectors.jsx";
import { Gallery } from "./components/Gallery.jsx";
import { GroupChat } from "./components/GroupChat.jsx";
import { GroupEditor } from "./components/GroupEditor.jsx";
import { Icon } from "./components/Icon.jsx";
import { Mascot } from "./components/Mascot.jsx";
import { Notice } from "./components/Notice.jsx";
import { RowMenu } from "./components/RowMenu.jsx";
import { Tasks } from "./components/Tasks.jsx";
import { Settings } from "./components/Settings.jsx";
import { Widgets } from "./components/widgets/index.jsx";

/* What goes back to the model: the chat since its last summary (lib/compact.js),
 * minus turns that failed -- an error is for the reader, not part of the
 * conversation -- with what scheduled tasks posted folded into the reader's
 * next message (lib/schedule.js). */
const historyOf = (messages, reports = {}) => withReports(sinceSummary(messages).rest.filter((m) => !m.failure), reports);
const clipText = (text, limit) => (String(text || "").length > limit ? `${String(text).slice(0, limit - 1)}…` : String(text || ""));
// The answer arriving, as text and tool calls in the order they come.
const withText = (parts, delta) => {
  const last = parts[parts.length - 1];
  return last?.type === "text" ? [...parts.slice(0, -1), { type: "text", text: last.text + delta }] : [...parts, { type: "text", text: delta }];
};
// Most recently talked-to first; a chat never used counts from when it was made.
const lastActive = (item, chats) => chats[item.id]?.at(-1)?.at || item.createdAt || 0;
const byRecent = (list, chats) => [...list].sort((a, b) => lastActive(b, chats) - lastActive(a, chats));

const RAIL_KEY = "blvrd.rail";
// On a Mac the window has no title bar of its own: its red, yellow and green
// buttons sit over the top of the sidebar (tauri.conf.json, titleBarStyle
// Overlay), so the layout leaves them room.
const OVERLAY_TITLEBAR = inDesktop() && /Mac/i.test(navigator.platform || navigator.userAgent);

/* The sidebar: pinned beside the conversation, or hidden -- and then brought
   out over it by the left edge or the button by the window controls, until
   the pointer leaves it (or it is pinned again). Remembered between launches. */
function useRail() {
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== "hidden";
    } catch {
      return true;
    }
  });
  const [peek, setPeek] = useState(false);
  const leave = useRef(0);
  const pin = (next) => {
    setPinned(next);
    setPeek(false);
    try {
      localStorage.setItem(RAIL_KEY, next ? "pinned" : "hidden");
    } catch {
      // Not remembered; still applies now.
    }
  };
  const show = () => {
    clearTimeout(leave.current);
    setPeek(true);
  };
  // A short grace, so crossing the sidebar's own edge on the way to it, or a
  // moment's overshoot, doesn't snap it shut.
  const hide = () => {
    clearTimeout(leave.current);
    leave.current = setTimeout(() => setPeek(false), 280);
  };
  return { pinned, peek, pin, show, hide, close: () => setPeek(false) };
}

export default function App() {
  const [state, setState] = useState(load);
  const [view, setView] = useState(() => {
    const recent = byRecent([...state.agents, ...(state.groups || [])], state.chats)[0];
    if (!recent) return { kind: "gallery" };
    return { kind: state.agents.includes(recent) ? "agent" : "group", id: recent.id };
  });
  const [editor, setEditor] = useState(null); // { agent?, initial? }
  const [groupEditor, setGroupEditor] = useState(null); // { group? }
  // The answer arriving: in which chat (an agent's id or a group's), from
  // which agent, its text so far, and -- in a group -- who answers after it.
  const [live, setLive] = useState(null); // { chatId, agentId, text, status, queue }
  const running = useRef(null); // { chatId, controller }
  // An agent waiting for the reader's yes before acting (lib/run.js).
  const [approval, setApproval] = useState(null); // { chatId, agentName, summary, args, toolName, toolLabel, resolve }

  // Saved a moment after each change rather than on every streamed word. A
  // save that fails is said, once until one works again: everything since
  // would otherwise be quietly lost on the next launch.
  const saveFailed = useRef(false);
  const notifyRef = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const failed = () => {
        if (saveFailed.current) return;
        saveFailed.current = true;
        notifyRef.current?.("Couldn't save your latest changes: this computer's storage for the app is full or blocked. They'll be lost when the app closes.");
      };
      if (save(state, failed)) saveFailed.current = false;
    }, 300);
    return () => clearTimeout(timer);
  }, [state]);

  // The files in messages (pictures, text files) are kept apart from the rest
  // (lib/fileStore.js) and put back once read. Sending waits for them, so a
  // turn never goes out with a picture missing.
  const filesIn = useRef(null);
  filesIn.current ||= loadFiles(state.chats).then((found) => {
    if (found.size) setState((s) => ({ ...s, chats: withFiles(s.chats, found) }));
  });

  const providers = useMemo(() => providersOf(state), [state.providers, state.custom]);

  // The sidebar now follows the Notebook: once, it takes the order the
  // sidebar had (state.widgets) and puts every widget's section in it.
  useEffect(() => {
    notebookReady.then(() => notebook.connectSidebar(stateRef.current.widgets));
  }, []);

  // Notes agents kept the old way (state.notes) move into each one's
  // MEMORY.md, once, where the user can see them.
  useEffect(() => {
    const kept = stateRef.current.notes || {};
    for (const [id, notes] of Object.entries(kept)) {
      const agent = stateRef.current.agents.find((a) => a.id === id);
      if (!notes?.length || !agent) continue;
      migrateNotes(id, agent.name, notes)
        .then(() => update((s) => ({ notes: Object.fromEntries(Object.entries(s.notes || {}).filter(([k]) => k !== id)) })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The user's unsaved notebook edits are saved when the window is hidden or
  // closed, without waiting for the usual few seconds.
  useEffect(() => {
    const flush = () => document.hidden && notebook.save();
    const quit = () => notebook.save();
    document.addEventListener("visibilitychange", flush);
    addEventListener("pagehide", quit);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      removeEventListener("pagehide", quit);
    };
  }, []);

  // The Notebook's live sections (lib/notebook.js LIVE): the sidebar's
  // widgets as rows an agent can read. Each reads the latest state when asked.
  provideLive("agents", () => agentsRows(byRecent(stateRef.current.agents, stateRef.current.chats), (a) => taglineOf(a, PRESETS)));
  provideLive("groups", () =>
    groupsRows(byRecent(stateRef.current.groups || [], stateRef.current.chats), (id) => stateRef.current.agents.find((a) => a.id === id)?.name || "someone no longer here"),
  );
  provideLive("setup", () =>
    setupRows({ defaultModel: stateRef.current.defaultModel, providers: providersOf(stateRef.current), connectors: stateRef.current.connectors, search: searchOf(stateRef.current) }),
  );
  provideLive("calendar", async () => calendarRows(await eventsAhead(stateRef.current.connectors, patchConnectors)));
  provideLive("music", async () => musicRows(await readNowPlaying()));
  const agents = useMemo(() => byRecent(state.agents, state.chats), [state.agents, state.chats]);
  const groups = useMemo(() => byRecent(state.groups || [], state.chats), [state.groups, state.chats]);
  const selected = view.kind === "agent" ? agents.find((a) => a.id === view.id) : null;
  const selectedGroup = view.kind === "group" ? groups.find((g) => g.id === view.id) : null;
  const agentsById = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const membersOf = (group) => (group?.members || []).map((id) => agentsById.get(id)).filter(Boolean);

  const update = useCallback((fn) => setState((s) => ({ ...s, ...fn(s) })), []);

  /* A notice at the foot of the window: what just happened, with Undo when
   * it can be taken back. In place of asking first -- a quick undo forgives a
   * slip without making every deliberate delete answer a question. */
  const [notice, setNotice] = useState(null); // { id, text, undo }
  const notify = useCallback((text, undo = null) => setNotice({ id: Date.now() + Math.random(), text, undo }), []);
  notifyRef.current = notify;
  const rail = useRail();
  // Picking something from a brought-out sidebar puts it away again.
  useEffect(() => {
    rail.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /* -- connectors ------------------------------------------------------------------ */

  const patchConnectors = useCallback(
    (fn) => update((s) => ({ connectors: { ...s.connectors, ...fn(s.connectors) } })),
    [update],
  );
  const getConnectors = () => stateRef.current.connectors;

  /* Tasks (lib/schedule.js). `schedulesNow` is the list as it is
   * this moment: a tool that adds a task and then lists them in the same turn
   * sees its own change before React has drawn it. */
  const schedulesNow = useRef(state.schedules || []);
  schedulesNow.current = state.schedules || [];
  const setSchedules = useCallback(
    (fn) => {
      const next = fn(schedulesNow.current);
      schedulesNow.current = next;
      update(() => ({ schedules: next }));
    },
    [update],
  );
  const scheduleOps = useRef(null);
  scheduleOps.current ||= {
    list: () => schedulesNow.current,
    add: (task) => setSchedules((list) => [...list, task]),
    patch: (id, fn) => setSchedules((list) => list.map((x) => (x.id === id ? fn(x) : x))),
    remove: (id) => setSchedules((list) => list.filter((x) => x.id !== id)),
    // What the agent could do that acts: offered on the Allow card for runs
    // nobody is there to approve.
    acting: (ctx) => {
      const agent = stateRef.current.agents.find((a) => a.id === ctx.agentId);
      return toolsFor(agent, availableRef.current)
        .filter((t) => t.confirm && t.group !== SCHEDULE_GROUP)
        .map((t) => ({ name: t.name, label: t.label || t.name }));
    },
  };
  const scheduleToolList = useMemo(() => scheduleTools(scheduleOps.current), []);

  // Every tool an agent could be given: the built-in ones and every connected
  // account's and server's.
  const available = useMemo(
    () => [...TOOLS, ...NOTEBOOK_TOOLS, ...MEMORY_TOOLS, ...scheduleToolList, ...connectorTools(state.connectors, { getConnectors, patchConnectors })],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.connectors],
  );
  const availableRef = useRef(available);
  availableRef.current = available;

  /* The computer (lib/computer): offered as one tool, computer_task, in a
   * chat whose computer is on -- This Mac or the Sandbox, set in the chat. */
  const computerTool = useMemo(
    () =>
      computerTaskTool({
        open: (chatId, options) => openComputer(chatId, whereOf(stateRef.current.computers, chatId), options),
        stop: stopComputer,
        modelOf: (agentId) => {
          const agent = stateRef.current.agents.find((a) => a.id === agentId);
          const target = agent && modelFor(agent);
          return target ? { agent, provider: target.provider, model: target.model, profile: getProfile(target.provider, target.model) } : null;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const availableIn = (chatId) => (whereOf(stateRef.current.computers, chatId) === "off" ? availableRef.current : [...availableRef.current, computerTool]);

  // A tool marked `noAlways` (scheduling) asks every time, whatever was
  // allowed before: its card is the reader's check of what will happen.
  // "Always allow" covers the tool, or less when it says (`alwaysKey`: one
  // command on this Mac).
  const askFirst = (chatId, agent) => ({ tool, args, summary, preview, alwaysKey = tool.name }) => {
    if (!tool.noAlways && stateRef.current.connectors.allow?.[alwaysKey]) return Promise.resolve(true);
    return new Promise((resolve) =>
      setApproval({
        chatId,
        agentName: agent.name,
        summary,
        args,
        preview,
        noAlways: Boolean(tool.noAlways),
        alwaysKey,
        toolName: tool.name,
        toolLabel: tool.label || tool.name,
        resolve,
      }),
    );
  };

  // `extra`: choices made on the card itself (a schedule's unattended ticks),
  // handed to the tool with the yes.
  const answerApproval = (choice, extra = null) => {
    const pending = approval;
    if (!pending) return;
    if (choice === "always" && !pending.noAlways) patchConnectors((c) => ({ allow: { ...c.allow, [pending.alwaysKey || pending.toolName]: true } }));
    setApproval(null);
    pending.resolve(choice === "deny" ? false : extra || true);
  };

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

  /* Deleting a conversation with an agent: the agent goes, with its chat and
   * its MEMORY.md, and it leaves its groups (what it said there stays). Done at once,
   * with an Undo in the notice rather than a question first (see `notify`). */
  const deleteAgent = (agent) => {
    if (running.current?.chatId === agent.id) running.current.controller.abort();
    const before = stateRef.current;
    const chat = before.chats[agent.id];
    const notes = before.notes[agent.id];
    const seats = Object.fromEntries((before.groups || []).map((g) => [g.id, g.members.indexOf(agent.id)]).filter(([, at]) => at !== -1));
    const memoryBack = removeMemory(agent.id);
    const tasks = (before.schedules || []).filter((x) => x.agentId === agent.id);
    update((s) => {
      const chats = { ...s.chats };
      const notes = { ...s.notes };
      delete chats[agent.id];
      delete notes[agent.id];
      // It leaves its groups too; what it said in them stays, under its name.
      const groups = (s.groups || []).map((g) => ({ ...g, members: g.members.filter((id) => id !== agent.id) }));
      const schedules = (s.schedules || []).filter((x) => x.agentId !== agent.id);
      return { agents: s.agents.filter((a) => a.id !== agent.id), chats, notes, groups, schedules };
    });
    setEditor(null);
    if (view.kind === "agent" && view.id === agent.id) setView({ kind: "gallery" });
    notify(`Deleted your conversation with ${agent.name}`, () => {
      memoryBack.then((back) => back());
      update((s) => ({
        agents: s.agents.some((a) => a.id === agent.id) ? s.agents : [...s.agents, agent],
        chats: chat ? { ...s.chats, [agent.id]: chat } : s.chats,
        notes: notes ? { ...s.notes, [agent.id]: notes } : s.notes,
        schedules: [...(s.schedules || []), ...tasks.filter((t) => !(s.schedules || []).some((x) => x.id === t.id))],
        // Back in its groups, in the seat it had.
        groups: (s.groups || []).map((g) => {
          if (!(g.id in seats) || g.members.includes(agent.id)) return g;
          const members = [...g.members];
          members.splice(seats[g.id], 0, agent.id);
          return { ...g, members };
        }),
      }));
    });
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

  const agentName = (id) => stateRef.current.agents.find((a) => a.id === id)?.name || "an assistant no longer here";
  const notebookOf = (agentId, chatId) => ({
    // The Notebook (lib/notebookTools.js): who is writing, in which
    // conversation (each has its own place in the notebook's versions), and
    // how to name another agent that wrote before them.
    agentId,
    chatId,
    nameOf: agentName,
    // Its own MEMORY.md is called after it, the first time it's made.
    agentName: agentName(agentId),
    search: () => searchOf(stateRef.current),
  });

  /* The models agents run on -- the default and each agent's own -- and who
   * uses each, for the Models screen's computer access. */
  const modelsInUse = () => {
    const found = new Map();
    const add = (choice, who) => {
      const provider = choice?.model && providers.find((p) => p.id === choice.provider);
      if (!provider) return;
      const key = `${provider.id}|${choice.model}`;
      const entry = found.get(key) || { provider, model: choice.model, users: [] };
      entry.users.push(who);
      found.set(key, entry);
    };
    add(state.defaultModel, "the default");
    for (const agent of state.agents) if (agent.model?.model) add(agent.model, agent.name);
    return [...found.values()].map(({ users, ...rest }) => ({ ...rest, who: `Used by ${users.join(", ")}` }));
  };

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

    setLive({ chatId, agentId: agent.id, text: "", parts: [], status: "", queue });
    const said = [];
    // The user's unsaved notebook edits are saved first: an agent is never
    // behind what's on their screen. Its own memory is read fresh, in case
    // it was edited in another editor.
    notebook.save();
    const memory = await readMemory(agent.id, agent.name).catch(() => "");
    // What the model can take and do, asked of its server once a launch
    // (lib/profile.js): its context, whether it calls tools natively.
    const profile = await discover(target.provider, target.model, { adapters: ADAPTERS });
    try {
      await runTurn({
        agent,
        provider: target.provider,
        model: target.model,
        profile,
        onWait: (ms) => setLive((l) => l && { ...l, status: `${target.provider.name} is busy; trying again in ${Math.ceil(ms / 1000)}s…` }),
        history,
        signal: controller.signal,
        notebook: notebookOf(agent.id, chatId),
        thinking,
        context: [context, notebookBrief()].filter(Boolean).join("\n\n"),
        note: behindNote(agent.id, chatId, history, agentName),
        memory,
        available: availableIn(chatId),
        approve: askFirst(chatId, agent),
        emit: (event) => {
          if (event.type === "text") setLive((l) => l && { ...l, text: l.text + event.delta, parts: withText(l.parts, event.delta), status: "" });
          else if (event.type === "retext") setLive((l) => l && { ...l, text: event.text, parts: event.text ? [{ type: "text", text: event.text }] : [] });
          else if (event.type === "call") setLive((l) => l && { ...l, parts: [...l.parts, { type: "call", name: event.name }] });
          // A tool saying what it's doing (the computer's worker, step by step).
          else if (event.type === "status") setLive((l) => l && { ...l, status: event.status });
          else if (event.type === "message") {
            const message = { ...event.message, ...tag };
            append(chatId, message);
            said.push(message);
            const calling = message.role === "assistant" && message.calls?.length;
            setLive((l) => l && { ...l, text: "", parts: [], status: calling ? `Using ${message.calls.map((c) => c.name).join(", ")}…` : "" });
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

  const send = (text, files = [], thinking = null) => selected && sendTo(selected, text, files, thinking);
  /* Compaction (lib/compact.js). `fold` summarizes the older part of a chat
   * with `agent`'s model and puts the summary in; it returns the chat with
   * it in, or null if there was nothing to fold or it couldn't be done.
   * Throws STOPPED when the reader stops it. */
  const fold = async ({ chatId, chat, agent, keep, controller, loud = false }) => {
    const target = modelFor(agent);
    const say = (problem) => (loud ? notify(problem) : console.warn(problem));
    if (!target || !target.provider.enabled) {
      say(`Can't summarize without a model: ${agent.name} has none that's switched on.`);
      return null;
    }
    const nameOf = (id) => (id ? agents.find((a) => a.id === id)?.name || "A removed agent" : agent.name);
    setLive({ chatId, agentId: agent.id, text: "", parts: [], status: "Summarizing earlier messages…", queue: [] });
    try {
      const done = await compact({ messages: chat, keep, provider: target.provider, model: target.model, nameOf, signal: controller.signal });
      if (!done) return null;
      const summary = { id: newId("m"), at: Date.now(), ...done.summary };
      update((s) => ({ chats: { ...s.chats, [chatId]: withSummary(s.chats[chatId] || [], done.before, summary) } }));
      return withSummary(chat, done.before, summary);
    } catch (problem) {
      if (controller.signal.aborted) throw STOPPED;
      say(`Couldn't summarize the chat: ${explain(problem, target)}`);
      return null;
    }
  };

  // Before a turn: a chat past the limit set in Settings keeps about a
  // quarter of it, the rest summarized.
  const foldIfLong = async ({ chatId, chat, agent, controller }) => {
    // The reader's setting, or less: three quarters of what the model can
    // really take, leaving room for its instructions, tools and answer.
    const set = compactAtOf(stateRef.current);
    if (set === null) return chat; // "Never"
    const target = modelFor(agent);
    const known = target ? (await discover(target.provider, target.model, { adapters: ADAPTERS }).catch(() => null)) || getProfile(target.provider, target.model) : null;
    // Only a window that is known (lib/profile.js usableWindow): a guessed
    // one would fold a big hosted model's chats far too early.
    const room = known ? usableWindow(target.provider, known) : null;
    const limit = room ? Math.min(set, Math.floor(room * 0.75)) : set;
    if (!tooLong(chat, null, limit)) return chat;
    return (await fold({ chatId, chat, agent, keep: Math.round(limit / 4), controller })) || chat;
  };

  // Whether a chat has anything to fold: more than one message from the
  // reader since its last summary.
  const canCompact = (chatId) => canFold(state.chats[chatId] || []);

  // From the header, the sidebar's menu, or a swipe: all but the last exchange.
  const compactNow = async (chatId, agent) => {
    if (running.current || !agent) return;
    await filesIn.current;
    if (running.current) return;
    const chat = stateRef.current.chats[chatId] || [];
    if (!canFold(chat)) {
      notify("Nothing to compact yet: it needs more than one message from you since the last summary.");
      return;
    }
    const controller = new AbortController();
    running.current = { chatId, controller };
    try {
      await fold({ chatId, chat, agent, keep: 0, controller, loud: true });
    } catch (stopped) {
      if (stopped !== STOPPED) throw stopped;
    } finally {
      running.current = null;
      setLive(null);
    }
  };

  const sendTo = async (agent, text, files = [], thinking = null) => {
    if (running.current) return;
    await filesIn.current;
    if (running.current) return;
    const user = { id: newId("m"), at: Date.now(), role: "user", content: text, ...(files.length ? { files } : {}) };
    const before = stateRef.current.chats[agent.id] || [];
    append(agent.id, user);
    const controller = new AbortController();
    running.current = { chatId: agent.id, controller };
    try {
      const chat = await foldIfLong({ chatId: agent.id, chat: [...before, user], agent, controller });
      await answerAs({ agent, chatId: agent.id, history: historyOf(chat), controller, thinking, context: summaryContext(chat) });
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
    await filesIn.current;
    if (running.current) return;
    const members = membersOf(group);
    if (!members.length) return;
    const user = { id: newId("m"), at: Date.now(), role: "user", content: text, ...(files.length ? { files } : {}) };
    const before = stateRef.current.chats[group.id] || [];
    append(group.id, user);

    const nameOf = (id) => agents.find((a) => a.id === id)?.name || "A removed agent";
    const queue = respondersFor({ members, picked, text });
    const controller = new AbortController();
    running.current = { chatId: group.id, controller };
    let handoffs = 0;
    try {
      // Too long: summarized by whoever answers first.
      const first = members.find((m) => m.id === queue[0]) || members[0];
      const chat = await foldIfLong({ chatId: group.id, chat: [...before, user], agent: first, controller });
      const transcript = historyOf(chat, { keep: true, nameOf });
      const summary = summaryContext(chat);
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift();
        const agent = members.find((m) => m.id === id);
        if (!agent) continue;
        const said = await answerAs({
          agent,
          chatId: group.id,
          history: viewFor(agent.id, transcript, nameOf),
          controller,
          context: [groupBrief(agent, members, group, (m) => taglineOf(m, PRESETS)), summary].filter(Boolean).join("\n\n"),
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

  const stop = () => {
    // A question waiting for an answer is answered no, and the turn ends.
    if (approval) {
      approval.resolve(false);
      setApproval(null);
    }
    running.current?.controller.abort();
  };

  const clearChatOf = (chatId, name) => {
    if (running.current?.chatId === chatId) running.current.controller.abort();
    const chat = stateRef.current.chats[chatId] || [];
    update((s) => ({ chats: { ...s.chats, [chatId]: [] } }));
    notify(`Cleared the chat with ${name}`, () => update((s) => ({ chats: { ...s.chats, [chatId]: [...chat, ...(s.chats[chatId] || [])] } })));
  };

  /* -- tasks: running them (lib/schedule.js) --------------------------------
   *
   * One at a time, and never ahead of the reader: a due task starts only when
   * nothing else is answering, and what it says is put in its chat once that
   * chat is free -- never between the reader's message and its answer. A run
   * is a small turn of its own: the task and the last result, not the chat. */

  const [schedRun, setSchedRun] = useState(null); // { id, controller }
  const schedRunRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const appendWhenFree = async (chatId, message) => {
    while (running.current?.chatId === chatId) await new Promise((done) => setTimeout(done, 500));
    append(chatId, message);
  };

  const runTask = async (task, agent, signal) => {
    const target = modelFor(agent);
    if (!target) throw new Error(`No model chosen for ${agent.name}.`);
    if (!target.provider.enabled) throw new Error(`${target.provider.name} is switched off in Settings.`);
    const always = stateRef.current.connectors.allow || {};
    const allowed = new Set([...(task.allow || []), ...Object.keys(always).filter((k) => always[k])]);
    const tools = toolsFor(agent, availableRef.current);
    const { context, message } = runPrompt(task, { allowed: tools.filter((t) => t.confirm && allowed.has(t.name)).map((t) => t.label || t.name) });
    notebook.save();
    const memory = await readMemory(agent.id, agent.name).catch(() => "");
    const profile = await discover(target.provider, target.model, { adapters: ADAPTERS });
    const said = [];
    const wanted = [];
    try {
      await runTurn({
        agent,
        provider: target.provider,
        model: target.model,
        profile,
        history: [{ role: "user", content: message }],
        signal,
        // Its own place in the notebook's versions, apart from the chat's; a
        // task it schedules is posted in the chat this one belongs to.
        notebook: { ...notebookOf(agent.id, `${task.chatId}#${task.id}`), postTo: task.chatId },
        context: [context, notebookBrief()].filter(Boolean).join("\n\n"),
        memory,
        available: availableIn(task.chatId),
        // Nobody is there to ask: what was ticked for this task runs, and
        // anything else is turned down with a reason the model can pass on.
        approve: async ({ tool }) => {
          if (allowed.has(tool.name)) return true;
          wanted.push(tool.label || tool.name);
          return { declined: `${tool.label || tool.name} didn't run: the user hasn't allowed it for this scheduled task. Don't try it again; say what you would have done.` };
        },
        emit: (event) => {
          if (event.type === "message") said.push(event.message);
        },
      });
    } catch (problem) {
      if (signal.aborted) throw problem;
      throw new Error(explain(problem, target));
    }
    const answer = said.filter((m) => m.role === "assistant" && m.content?.trim()).at(-1)?.content.trim() || "";
    if (task.quiet && isNothingNew(answer)) return { ok: true, text: answer, posted: false };
    const steps = said
      .filter((m) => m.role === "tool")
      .map((m) => ({ name: m.name, content: clipText(m.content, 2000), error: Boolean(m.error), declined: Boolean(m.declined) }));
    const text = answer || "(The task ran, but the model gave no answer.)";
    const inGroup = task.chatId !== task.agentId;
    return { ok: true, text, posted: true, message: reportOf(task, { text, steps, wanted, agentId: inGroup ? task.agentId : null }) };
  };

  // Said where the reader will see it: the system's notification when blvrd
  // isn't in front, a notice at the foot of the window when another chat is.
  const tellAbout = (task, agent, text) => {
    if (document.hidden || !document.hasFocus()) {
      tellOS(`${agent.name} · ${task.title}`, clipText(text, 200));
      return;
    }
    const here = viewRef.current;
    if (!((here.kind === "agent" || here.kind === "group") && here.id === task.chatId)) notify(`${agent.name} posted “${task.title}”`);
  };

  const runScheduled = async (task) => {
    const agent = stateRef.current.agents.find((a) => a.id === task.agentId);
    if (!agent) {
      setSchedules((list) => list.filter((x) => x.id !== task.id));
      return;
    }
    const now = Date.now();
    if (isMissed(task, now)) {
      setSchedules((list) => list.map((x) => (x.id === task.id ? afterRun(x, { ok: false, missed: true, error: "Missed" }, now) : x)));
      appendWhenFree(task.chatId, missedOf(task, now));
      return;
    }
    const controller = new AbortController();
    const current = { id: task.id, controller };
    schedRunRef.current = current;
    setSchedRun(current);
    let timedOut = false;
    const limit = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RUN_LIMIT_MS);
    let outcome;
    try {
      outcome = await runTask(task, agent, controller.signal);
    } catch (problem) {
      outcome = timedOut
        ? { ok: false, error: `It took longer than ${RUN_LIMIT_MS / 60_000} minutes and was stopped.` }
        : controller.signal.aborted
          ? { skipped: true }
          : { ok: false, error: problem?.message || String(problem) };
    } finally {
      clearTimeout(limit);
      schedRunRef.current = null;
      setSchedRun(null);
    }
    outcome.ms = Date.now() - now;
    const kept = schedulesNow.current.find((x) => x.id === task.id);
    if (!kept) return; // deleted while it ran
    const after = afterRun(kept, outcome, Date.now());
    setSchedules((list) => list.map((x) => (x.id === task.id ? after : x)));
    if (outcome.ok && outcome.message) {
      await appendWhenFree(task.chatId, outcome.message);
      tellAbout(task, agent, outcome.text);
    } else if (!outcome.ok && !outcome.skipped && after.paused && !kept.paused) {
      appendWhenFree(task.chatId, {
        role: "scheduled",
        scheduled: { id: task.id, title: task.title, words: task.words, at: Date.now() },
        content: "",
        note: `Paused “${task.title}”: it failed ${PAUSE_AFTER_FAILURES} times in a row. The last time: ${outcome.error} Resume it on the Tasks screen.`,
        ...(task.chatId !== task.agentId ? { agentId: task.agentId } : {}),
      });
    }
  };

  // Every 20 seconds, when the window comes back, and when the desktop shell
  // says a time has come: run what's due, if nothing else is running.
  const tickRef = useRef(null);
  tickRef.current = () => {
    if (schedRunRef.current || running.current) return;
    const due = dueTasks(schedulesNow.current, Date.now())[0];
    if (due) runScheduled(due);
  };
  useEffect(() => {
    const tick = () => tickRef.current();
    const first = setTimeout(tick, 4000); // once files and the notebook are in
    const every = setInterval(tick, 20_000);
    const off = listen("schedule-due", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      off.then((un) => un());
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // The desktop shell keeps the time as well, so a hidden window is woken
  // for it -- and keeps blvrd in the menu bar while anything is waiting.
  const nextDue = soonest(state.schedules);
  const waiting = (state.schedules || []).filter(isActive).length;
  const background = state.background !== false;
  useEffect(() => {
    invoke("schedule_set", { next: nextDue, waiting, background }, "Tasks").catch(() => {});
  }, [nextDue, waiting, background]);

  const scheduleActs = {
    runNow: (id) => {
      const task = schedulesNow.current.find((x) => x.id === id);
      if (!task || schedRunRef.current) return;
      runScheduled({ ...task, retryAt: Date.now() });
    },
    stop: () => schedRunRef.current?.controller.abort(),
    pause: (id, paused) => setSchedules((list) => list.map((x) => (x.id === id ? withPause(x, paused) : x))),
    patch: (id, fn) => setSchedules((list) => list.map((x) => (x.id === id ? fn(x) : x))),
    remove: (id) => {
      const task = schedulesNow.current.find((x) => x.id === id);
      if (!task) return;
      if (schedRunRef.current?.id === id) schedRunRef.current.controller.abort();
      setSchedules((list) => list.filter((x) => x.id !== id));
      notify(`Removed “${task.title}”`, () => setSchedules((list) => (list.some((x) => x.id === id) ? list : [...list, task])));
    },
    open: (chatId) => setView({ kind: stateRef.current.agents.some((a) => a.id === chatId) ? "agent" : "group", id: chatId }),
    setBackground: (on) => update(() => ({ background: on })),
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

  // A group's conversation: the group and its chat go; its agents stay.
  const deleteGroup = (group) => {
    if (running.current?.chatId === group.id) running.current.controller.abort();
    const chat = stateRef.current.chats[group.id];
    const tasks = (stateRef.current.schedules || []).filter((x) => x.chatId === group.id);
    update((s) => {
      const chats = { ...s.chats };
      delete chats[group.id];
      return { groups: s.groups.filter((g) => g.id !== group.id), chats, schedules: (s.schedules || []).filter((x) => x.chatId !== group.id) };
    });
    setGroupEditor(null);
    if (view.kind === "group" && view.id === group.id) {
      setView(agents.length ? { kind: "agent", id: agents[0].id } : { kind: "gallery" });
    }
    notify(`Deleted the conversation ${group.name}`, () =>
      update((s) => ({
        groups: (s.groups || []).some((g) => g.id === group.id) ? s.groups : [...(s.groups || []), group],
        chats: chat ? { ...s.chats, [group.id]: chat } : s.chats,
        schedules: [...(s.schedules || []), ...tasks.filter((t) => !(s.schedules || []).some((x) => x.id === t.id))],
      })),
    );
  };


  /* -- the sidebar's menu: right-click a row, or its ⋯ -------------------------- */

  const [rowMenu, setRowMenu] = useState(null); // { at: { x, y }, kind, id }
  // A conversation on its way out: its sidebar row plays its exit
  // (components/SwipeRow.jsx), then deletes it.
  const [removing, setRemoving] = useState(null);
  const removeRow = (id) => {
    setEditor(null);
    setGroupEditor(null);
    setRemoving(id);
  };

  /* What a sidebar row can do (components/SidebarRows.jsx), behind one
   * function that never changes, so the memoized rows aren't re-rendered for
   * every new closure. Each call reaches this render's handlers. */
  const rowActs = useRef(null);
  rowActs.current = {
    view: (kind, id) => setView({ kind, id }),
    menu: (event, kind, id) => openRowMenu(kind, id)(event),
    compact: (chatId, agent) => compactNow(chatId, agent),
    deleteAgent: (agent) => {
      setRemoving(null);
      deleteAgent(agent);
    },
    deleteGroup: (group) => {
      setRemoving(null);
      deleteGroup(group);
    },
  };
  const act = useCallback((name, ...args) => rowActs.current[name](...args), []);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const openRowMenu = (kind, id) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    // Right-click: at the pointer. The ⋯ button: under it.
    const at = event.type === "contextmenu" ? { x: event.clientX, y: event.clientY } : { x: box.left, y: box.bottom + 4 };
    setRowMenu({ at, kind, id });
  };
  const rowMenuItems = () => {
    if (!rowMenu) return [];
    const busy = Boolean(live);
    if (rowMenu.kind === "agent") {
      const agent = agents.find((a) => a.id === rowMenu.id);
      if (!agent) return [];
      const empty = !(state.chats[agent.id] || []).length;
      return [
        { label: "Compact now", disabled: busy || !canCompact(agent.id), run: () => compactNow(agent.id, agent) },
        { label: "Clear chat", disabled: empty, run: () => clearChatOf(agent.id, agent.name) },
        "-",
        { label: "Edit agent…", run: () => setEditor({ agent }) },
        "-",
        { label: "Delete conversation", danger: true, run: () => removeRow(agent.id) },
      ];
    }
    const group = groups.find((g) => g.id === rowMenu.id);
    if (!group) return [];
    const empty = !(state.chats[group.id] || []).length;
    const first = membersOf(group)[0];
    return [
      { label: "Compact now", disabled: busy || !first || !canCompact(group.id), run: () => compactNow(group.id, first) },
      { label: "Clear chat", disabled: empty, run: () => clearChatOf(group.id, group.name) },
      "-",
      { label: "Edit members…", run: () => setGroupEditor({ group }) },
      "-",
      { label: "Delete conversation", danger: true, run: () => removeRow(group.id) },
    ];
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

  /* The quickview (lib/quick.js): this window holds its shortcut, and sends
   * what is written there -- to that agent's chat, brought forward. One
   * already answering finishes first. */
  const shortcut = shortcutOf(state);
  const [shortcutProblem, setShortcutProblem] = useState(null);
  useEffect(() => holdShortcut(shortcut, toggleQuick, setShortcutProblem), [shortcut]);

  const quickRef = useRef(null);
  quickRef.current = { sendTo };
  useEffect(() => {
    // Released once it is attached, even if this cleanup comes first (as
    // React's development double-run does) -- else two listeners send twice.
    const off = listen(QUICK_SEND, async ({ agentId, text, files = [] }) => {
      const agent = stateRef.current.agents.find((a) => a.id === agentId);
      if (!agent) return;
      setView({ kind: "agent", id: agent.id });
      showMain();
      while (running.current) await new Promise((done) => setTimeout(done, 250));
      quickRef.current.sendTo(agent, text, files);
    });
    return () => off.then((un) => un());
  }, []);

  // The menu bar icon's "Tasks…" (src-tauri/src/schedule.rs).
  useEffect(() => {
    const off = listen("open-tasks", () => setView({ kind: "tasks" }));
    return () => off.then((un) => un());
  }, []);

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
  // blvrd in the sidebar: what any agent is doing, wherever you are.
  const mood = useArcMood({ live, approval, chats: state.chats });
  const target = selected ? modelFor(selected) : null;

  // What every widget draws from -- in the sidebar and on the Notebook page.
  const widgetCtx = {
    view,
    setView,
    connectors: state.connectors,
    patchConnectors,
    agents,
    groups,
    chats: state.chats,
    agentsById,
    busyChat,
    live,
    busy: Boolean(live),
    rowMenu,
    removing,
    act,
    newGroup: () => setGroupEditor({}),
    hasDefaultModel: Boolean(state.defaultModel?.model),
    scheduledCount: waiting,
  };

  return (
    <div
      className="app"
      data-rail={rail.pinned ? "pinned" : "hidden"}
      data-peek={!rail.pinned && rail.peek ? "" : undefined}
      data-titlebar={OVERLAY_TITLEBAR ? "overlay" : undefined}
    >
      {!rail.pinned ? (
        <>
          {/* The left edge brings the sidebar out; so does this button, which
              sits beside the window controls while the sidebar is away. */}
          <div className="rail-edge" onPointerEnter={rail.show} aria-hidden="true" />
          <button
            type="button"
            className="btn icon-only rail-show"
            aria-label="Show the sidebar"
            title="Show the sidebar"
            onClick={() => (rail.peek ? rail.close() : rail.show())}
          >
            <Icon name="sidebar" />
          </button>
        </>
      ) : null}
      <aside
        className="side"
        onPointerEnter={rail.pinned ? undefined : rail.show}
        onPointerLeave={rail.pinned ? undefined : rail.hide}
        aria-hidden={!rail.pinned && !rail.peek ? "true" : undefined}
      >
        {/* The window's title bar, inside the sidebar: room for the window
            controls, a strip to drag the window by, and the sidebar's own
            button -- hide it when pinned, pin it when it has been brought out. */}
        <div className="side-top" data-tauri-drag-region>
          <span className="spacer" data-tauri-drag-region />
          <button
            type="button"
            className="btn icon-only side-toggle"
            aria-label={rail.pinned ? "Hide the sidebar" : "Keep the sidebar open"}
            title={rail.pinned ? "Hide the sidebar" : "Keep the sidebar open"}
            aria-pressed={rail.pinned}
            onClick={() => rail.pin(!rail.pinned)}
          >
            <Icon name={rail.pinned ? "sidebar" : "sidebar-filled"} />
          </button>
        </div>
        <div className="brand">
          <Mascot shape="arc" colour="var(--red)" mood={mood} size={26} />
          <span className="wordmark">blvrd</span>
        </div>

        {/* Every part of the sidebar is a widget (components/widgets), in the
            order the reader dragged them into; they scroll as one column
            under the title bar. */}
        <div className="side-scroll">
          <Widgets ctx={widgetCtx} />
        </div>
      </aside>

      <main className="main">
        {view.kind === "calendar" ? (
          <CalendarView
            focus={view}
            connectors={state.connectors}
            patchConnectors={patchConnectors}
            onConnect={() => setView({ kind: "connectors" })}
          />
        ) : view.kind === "notebook" ? (
          <NotebookView focus={view} notify={notify} widgetCtx={widgetCtx} nameOf={(id) => agents.find((a) => a.id === id)?.name || "an agent no longer here"} />
        ) : view.kind === "tasks" ? (
          <Tasks
            schedules={state.schedules || []}
            agents={state.agents}
            groups={state.groups || []}
            available={available}
            running={schedRun?.id || null}
            background={background}
            acts={scheduleActs}
          />
        ) : view.kind === "connectors" ? (
          <Connectors connectors={state.connectors} patchConnectors={patchConnectors} getConnectors={getConnectors} />
        ) : view.kind === "settings" ? (
          <Settings
            providers={providers}
            defaultModel={state.defaultModel}
            onDefaultModel={(defaultModel) => update(() => ({ defaultModel }))}
            onProvider={setProvider}
            onAddCustom={addCustom}
            onRemoveCustom={removeCustom}
            shortcut={shortcut}
            shortcutProblem={shortcutProblem}
            onShortcut={(quickShortcut) => update(() => ({ quickShortcut }))}
            compactAt={compactAtOf(state)}
            onCompactAt={(compactAt) => update(() => ({ compactAt }))}
            search={searchOf(state)}
            onSearch={(patch) => update((s) => ({ search: { ...searchOf(s), ...patch } }))}
            inUse={modelsInUse()}
          />
        ) : selected ? (
          <Chat
            agent={selected}
            presets={PRESETS}
            messages={state.chats[selected.id] || []}
            live={live?.chatId === selected.id ? live : null}
            approval={approval?.chatId === selected.id ? approval : null}
            onApprove={answerApproval}
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
            onCompact={() => compactNow(selected.id, selected)}
            canCompact={canCompact(selected.id)}
            computer={whereOf(state.computers, selected.id)}
            onComputer={(where) => {
              const id = selected.id;
              if (where === "off") stopComputer(id);
              update((s) => ({ computers: { ...(s.computers || {}), [id]: { where } } }));
            }}
            onCustomize={() => setEditor({ agent: selected })}
          />
        ) : selectedGroup ? (
          <GroupChat
            group={selectedGroup}
            members={membersOf(selectedGroup)}
            messages={state.chats[selectedGroup.id] || []}
            live={live?.chatId === selectedGroup.id ? live : null}
            approval={approval?.chatId === selectedGroup.id ? approval : null}
            onApprove={answerApproval}
            busy={Boolean(live)}
            onSend={sendGroup}
            onStop={stop}
            onCompact={() => compactNow(selectedGroup.id, membersOf(selectedGroup)[0])}
            canCompact={canCompact(selectedGroup.id) && membersOf(selectedGroup).length > 0}
            onEdit={() => setGroupEditor({ group: selectedGroup })}
          />
        ) : (
          <Gallery
            presets={PRESETS}
            firstRun={agents.length === 0}
            onNew={() => setEditor({ initial: null })}
            onAdd={(preset) => addAgent(fromPreset(preset))}
            mood={mood}
            onCustomize={(preset) => setEditor({ initial: fromPreset(preset) })}
          />
        )}
      </main>

      <DragChip ctx={widgetCtx} />
      <Notice notice={notice} onDone={() => setNotice(null)} />
      {rowMenu ? <RowMenu at={rowMenu.at} items={rowMenuItems()} onClose={closeRowMenu} /> : null}
      {groupEditor ? (
        <GroupEditor
          group={groupEditor.group || null}
          agents={agents}
          presets={PRESETS}
          onSave={saveGroup}
          onDelete={(group) => removeRow(group.id)}
          onClose={() => setGroupEditor(null)}
        />
      ) : null}

      {editor ? (
        <AgentEditor
          agent={editor.agent || null}
          initial={editor.initial}
          providers={providers}
          defaultModel={state.defaultModel}
          groups={groupsOf(available)}
          onSave={saveAgent}
          onDelete={(agent) => removeRow(agent.id)}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}

/* An error as a sentence the reader can act on. */
function explain(problem, { provider, model }) {
  const text = problem?.message || String(problem);
  if (/Failed to fetch|NetworkError|ECONNREFUSED|error sending request|Connection refused|Load failed|No route to host|EHOSTUNREACH/i.test(text)) {
    // Another machine on the network: on a Mac the likeliest block is the
    // Local Network permission, which fails just like a server that's down.
    const host = hostOf(provider.base).split(":")[0];
    if (isLocalUrl(provider.base) && !/^(localhost|127\.|\[?::1)/.test(host) && /Mac/i.test(navigator.platform || navigator.userAgent)) {
      return `${provider.name} isn't answering at ${provider.base}. Check it's running on that computer, and that blvrd may use your network: System Settings → Privacy & Security → Local Network.`;
    }
    return provider.keys
      ? `Could not reach ${provider.name}. Check your connection.`
      : `${provider.name} isn't answering at ${provider.base}. Is it running? (Settings → Find local servers.)`;
  }
  if (/\b401\b|\b403\b|authentication|api key|x-api-key/i.test(text)) {
    if (!provider.key) return `${provider.name} wants a key. Add one in Settings. (${text})`;
    return `${provider.name} turned the key down. Check it in Settings. (${text})`;
  }
  if (/\b404\b|not found|model .* (does not exist|not found)/i.test(text)) {
    return `${provider.name} has no model called "${model}". ${provider.kind === "ollama" ? `Try \`ollama pull ${model}\`, or ` : ""}choose another in Customize. (${text})`;
  }
  return text;
}
