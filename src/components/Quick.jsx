import { useEffect, useRef, useState } from "react";

import { listen } from "../lib/desktop.js";
import { inDesktop } from "../lib/http.js";
import { QUICK_OPEN, QUICK_SEND } from "../lib/quick.js";
import { load } from "../lib/store.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Arc } from "./Arc.jsx";
import { useAttachments } from "./Attachments.jsx";
import { Icon } from "./Icon.jsx";
import { useMentions } from "./Mentions.jsx";

/* The quickview (lib/quick.js): one line to write on, which agent it's for
 * in a chip at its start, picked with @ (components/Mentions.jsx). It can be
 * dragged anywhere on screen, and comes back where it was left. Files go with
 * the message as in a chat: the paperclip, or dropped onto the box. Enter with
 * an agent sends -- the main window comes forward on that chat -- and Escape,
 * or clicking away, puts the box away with what you wrote kept for next time. */

const lastActive = (agent, chats) => chats[agent.id]?.at(-1)?.at || agent.createdAt || 0;
const agentsNow = () => {
  const state = load();
  return [...state.agents].sort((a, b) => lastActive(b, state.chats) - lastActive(a, state.chats));
};

/* Where the reader last dragged the box to, kept between launches. Put back
 * only if that spot is still on a screen (a display may have gone). */
const PLACE_KEY = "blvrd.quick-at";
async function keepPlace() {
  if (!inDesktop()) return () => {};
  const { getCurrentWindow, availableMonitors, PhysicalPosition } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
    if (saved) {
      const screens = await availableMonitors();
      const fits = screens.some(({ position: p, size: s }) => saved.x >= p.x && saved.y >= p.y && saved.x < p.x + s.width - 100 && saved.y < p.y + s.height - 100);
      if (fits) await win.setPosition(new PhysicalPosition(saved.x, saved.y));
    }
  } catch {
    // Left where the app put it: the middle of the screen.
  }
  return win.onMoved(({ payload }) => {
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({ x: payload.x, y: payload.y }));
    } catch {
      // Not kept for next launch; it stays put for this one.
    }
  });
}

async function hide() {
  if (!inDesktop()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export function Quick() {
  const [agents, setAgents] = useState(agentsNow);
  const [agent, setAgent] = useState(null);
  const [text, setText] = useState("");
  const input = useRef(null);
  const files = useAttachments();

  // Taking an agent: the @name typed so far goes, the agent goes in the chip.
  const mentions = useMentions(agents, (chosen, { start, query }) => {
    const before = text.slice(0, start);
    const after = text.slice(start + 1 + query.length).replace(/^\s+/, "");
    setAgent(chosen);
    setText(before + after);
    requestAnimationFrame(() => input.current?.setSelectionRange(before.length, before.length));
  });

  // Shown again: the agents as they are now (they're kept by the main
  // window), and the caret back in the box.
  useEffect(() => {
    const refresh = () => {
      const now = agentsNow();
      setAgents(now);
      setAgent((a) => (a ? now.find((n) => n.id === a.id) || null : null));
      input.current?.focus();
    };
    const off = listen(QUICK_OPEN, refresh);
    const moved = keepPlace();
    window.addEventListener("focus", refresh);
    // Clicking anywhere else puts it away, as a menu would.
    const away = () => hide();
    window.addEventListener("blur", away);
    return () => {
      off.then((un) => un());
      moved.then((un) => un());
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", away);
    };
  }, []);

  const send = async () => {
    const message = text.trim();
    if (!agent) {
      // Who it's for comes first: open the list as if @ had been typed.
      setText("@" + text);
      mentions.show({ start: 0, query: "" });
      return;
    }
    if (!message && !files.usable.length) return;
    const ready = await files.take();
    if (inDesktop()) {
      const { emitTo } = await import("@tauri-apps/api/event");
      await emitTo("main", QUICK_SEND, { agentId: agent.id, text: message, files: ready });
    }
    setText("");
    hide();
  };

  const onKey = (e) => {
    if (mentions.onKey(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === "Backspace" && agent && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
      setAgent(null);
    }
  };

  return (
    <div className="quick">
      {mentions.list}
      {/* Dragged by its grip, or by any of the box that isn't the text. */}
      <div className="quick-box" data-tauri-drag-region data-dropping={files.dropping ? "" : undefined}>
        {files.list}
        <div className="quick-row" data-tauri-drag-region>
        <span className="quick-grip" data-tauri-drag-region title="Drag to move" aria-hidden="true" />
        {/* The Arc listens while you write: a little give with each key. */}
        <Arc mood={text ? "listening" : "idle"} tick={text.length} size={22} />
        {agent ? (
          <span className="quick-chip">
            <AgentAvatar look={agent.look} name={agent.name} size={20} />
            {agent.name}
          </span>
        ) : null}
        <input
          ref={input}
          autoFocus
          value={text}
          placeholder={agent ? `Message ${agent.name}` : "@ an agent to talk to it"}
          onChange={(e) => {
            setText(e.target.value);
            mentions.follow(e.target);
          }}
          onSelect={(e) => mentions.follow(e.currentTarget)}
          onKeyDown={onKey}
          aria-label="Message"
        />
        {files.button}
        <button type="button" className="quick-send" onClick={send} disabled={agent ? !text.trim() && !files.usable.length : false} aria-label="Send">
          <Icon name="send" size={16} />
        </button>
        </div>
      </div>
    </div>
  );
}
