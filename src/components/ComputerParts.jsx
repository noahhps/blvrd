import { useCallback, useEffect, useState } from "react";

import { WHERE, screenOf } from "../lib/computer/connection.js";
import { Icon } from "./Icon.jsx";

/* A chat's computer, from the chat's side (lib/computer): where it is, and
 * its screen in a column beside the conversation. The same in an agent's
 * chat and a group's. */

/** The screen column's state for the chat `chatId`: shut again on moving to
 *  another chat. */
export function useScreen(chatId) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [chatId]);
  const screen = useCallback(() => screenOf(chatId), [chatId]);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return { open, setOpen, close, toggle, screen };
}

/** Where the chat's computer is, in the tray under the box. */
export function ComputerChoice({ value, onChange }) {
  return (
    <span className="computer-choice">
      <span className="tray-label">Computer</span>
      <select
        className="computer-where"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={value === "host" ? "Works on this Mac, in its own folder; commands ask you first" : value === "sandbox" ? "Works in a sandbox Linux machine; nothing asks" : "No computer in this chat"}
        aria-label="This chat's computer"
      >
        {WHERE.map((w) => (
          <option key={w.id} value={w.id} disabled={w.soon}>
            {w.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The header's way to the screen column. */
export function ScreenButton({ open, onClick }) {
  return (
    <button type="button" className="btn" aria-pressed={open} title="The computer's screen, as it is now" onClick={onClick}>
      <Icon name="screen" />
      Screen
    </button>
  );
}

/* The computer's screen -- its browser's page -- in a column beside the
   conversation, which makes room for it; refreshed while it's open. For the
   reader: the model never sees these pictures. Esc or ✕ puts it away. */
export function ScreenPanel({ open, onClose, screen, status }) {
  const [shot, setShot] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let going = true;
    const look = async () => {
      const next = await screen().catch(() => null);
      if (going) setShot(next || { none: true });
    };
    look();
    const timer = setInterval(look, 1200);
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      going = false;
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, screen, onClose]);
  return (
    <aside className="screen-panel" data-open={open ? "" : undefined} aria-hidden={!open} aria-label="The computer's screen">
      <div className="screen-panel-inner">
        <div className="screen-panel-head">
          <Icon name="screen" size={16} />
          <span>The computer’s screen</span>
          <span className="spacer" />
          <button type="button" className="btn icon-only" aria-label="Close the screen" title="Close (Esc)" onClick={onClose} tabIndex={open ? 0 : -1}>
            <Icon name="close" />
          </button>
        </div>
        {status ? <p className="screen-panel-status">{status}</p> : null}
        {shot?.image ? (
          <figure className="live-screen">
            <img src={shot.image} alt={`The computer's browser: ${shot.title || shot.url}`} />
            <figcaption>
              {shot.title ? `${shot.title} — ` : ""}
              {shot.url}
            </figcaption>
          </figure>
        ) : (
          <p className="hint">{shot?.none ? "No browser open on the computer yet. It shows here once the agent opens one." : "Looking…"}</p>
        )}
      </div>
    </aside>
  );
}
