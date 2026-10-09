import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { controlFor } from "../lib/thinking.js";
import { useAttachments } from "./Attachments.jsx";
import { Icon } from "./Icon.jsx";
import { useMentions } from "./Mentions.jsx";

/**
 * Bom's composer, in blvrd's clothes: one box with the text on its own line,
 * and a row beneath it with attaching at the left and the reasoning control
 * and send at the right -- the controls that are about *this message*.
 *
 * What the conversation is *for* -- which model this agent runs on, what it
 * may use -- sits in a tray tucked under the box rather than in it. Those are
 * set once and left, so they don't crowd the row the hand goes to on every
 * send.
 *
 * Files can be picked or dropped anywhere on the window; the box lights up
 * while something is held over the app.
 *
 * It stays where it is, at the foot of the conversation: no tucking away,
 * no rising to meet the cursor.
 */

const STICK_PX = 80; // a thread scrolled this close to its end counts as "at the end"
// `disabled`: an answer is under way (Send becomes Stop). `blocked`: why this
// chat can't take a message at all, said in the box; what's typed is kept.
// `queued`: messages written while it was answering, waiting their turn
// (App.jsx `queue`); sending while `disabled` adds to them.
export function Composer({ agentName, disabled, blocked = null, provider, model, tray, focusKey, autoFocus = false, mentions = null, onSend, onStop, queued = [], onUnqueue = null }) {
  const form = useRef(null);
  const [value, setValue] = useState("");
  const [control, setControl] = useState({ mode: "none" });
  const [thinking, setThinking] = useState(null);
  const input = useRef(null);
  const files = useAttachments();
  const { usable, dropping } = files;

  // The reasoning control follows the model: asked for whenever it changes,
  // and reset to that model's own default.
  useEffect(() => {
    let live = true;
    controlFor(provider, model).then((c) => {
      if (!live) return;
      setControl(c);
      setThinking(c.mode === "none" ? null : c.default);
    });
    return () => {
      live = false;
    };
  }, [provider?.id, provider?.base, model]);

  const autosize = useCallback(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, (window.innerHeight || 800) * 0.4) + "px";
  }, []);
  useLayoutEffect(autosize, [autosize, value]);

  /* The room the thread keeps clear under its last turn: the whole composer,
     raised, whatever it is doing -- so the conversation never moves while the
     box slides. When the composer itself grows (a second line, a staged file)
     a reader already at the end is kept there. */
  useEffect(() => {
    const node = form.current;
    const area = node?.parentElement;
    if (!node || !area) return undefined;
    const publish = () => {
      const thread = area.querySelector(".thread");
      const atEnd = thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < STICK_PX;
      area.style.setProperty("--composer-reserve", `${Math.round(node.offsetHeight)}px`);
      if (thread && atEnd) thread.scrollTop = thread.scrollHeight;
    };
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    publish();
    return () => observer.disconnect();
  }, []);

    // A different agent starts with an empty box. The caret goes in only when
  // its chat is empty -- focus holds the composer up, so focusing a chat that
  // has a conversation to read would park the box over the end of it.
  useEffect(() => {
    setValue("");
    if (autoFocus) input.current?.focus();
  }, [focusKey]);

  // In a group, @ brings up its members (components/Mentions.jsx); taking one
  // writes "@Name " where the @ was, which is how a group hears who answers.
  const at = useMentions(mentions || [], (chosen, { start, query }) => {
    const before = `${value.slice(0, start)}@${chosen.name} `;
    const after = value.slice(start + 1 + query.length).replace(/^\s+/, "");
    setValue(before + after);
    requestAnimationFrame(() => input.current?.setSelectionRange(before.length, before.length));
  });

  const submit = async (event) => {
    event.preventDefault();
    // While an answer streams, a send is queued: it goes when it's done.
    if (blocked) return;
    if (!value.trim() && !usable.length) return;
    const text = value;
    setValue("");
    const ready = await files.take();
    onSend(text.trim(), ready, control.mode === "none" ? null : { control, value: thinking });
  };

  return (
    <form
      className="composer"
      ref={form}
      onSubmit={submit}
      data-dropping={dropping ? "" : undefined}
    >
      <div className="composer-stack">
      {mentions ? at.list : null}
      {queued.length ? (
        <ul className="queued" aria-label="Queued messages">
          {queued.map((q) => (
            <li key={q.id}>
              <Icon name="clock" size={13} />
              <span className="queued-text">{q.text || `${q.files?.length || 0} file${q.files?.length === 1 ? "" : "s"}`}</span>
              {onUnqueue ? (
                <button type="button" className="btn icon-only" aria-label="Take it out of the queue" title="Don't send it" onClick={() => onUnqueue(q.id)}>
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </li>
          ))}
          <li className="queued-note">Sent in turn, when {disabled ? `${agentName} is done` : "the agent answering elsewhere is done"}.</li>
        </ul>
      ) : null}
      <div className="composer-box">
        {files.list}

        <textarea
          ref={input}
          rows={1}
          value={value}
          placeholder={blocked || (disabled ? `Queue a message for ${agentName}` : `Message ${agentName}`)}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value);
            if (mentions) at.follow(e.target);
          }}
          onSelect={mentions ? (e) => at.follow(e.currentTarget) : undefined}
          onKeyDown={(e) => {
            if (mentions && at.onKey(e)) return;
            // Enter sends on a real keyboard; on a phone it is the only way to
            // get a new line.
            const touch = window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form.requestSubmit();
            }
          }}
        />

        <div className="composer-row">
          {files.button}

          <span className="spacer" />

          <Thinking control={control} value={thinking} onChange={setThinking} disabled={disabled} />

          {disabled ? (
            <>
              {value.trim() || usable.length ? (
                <button type="submit" className="round" aria-label="Queue" title={`Queue it: sent when ${agentName} is done`}>
                  <Icon name="clock" size={16} />
                </button>
              ) : null}
              <button type="button" className="round stop" aria-label="Stop" title="Stop" onClick={onStop}>
                <Icon name="stop" size={16} />
              </button>
            </>
          ) : (
            <button type="submit" className="round" aria-label="Send" title="Send" disabled={Boolean(blocked) || (!value.trim() && !usable.length)}>
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>

      {tray ? <div className="composer-tray">{tray}</div> : null}
      </div>
    </form>
  );
}

/* The reasoning control, in whichever shape the model takes. */
function Thinking({ control, value, onChange, disabled }) {
  if (control.mode === "effort") {
    return (
      <div className="effort" role="group" aria-label={control.label}>
        {control.options.map((level) => (
          <button key={level} type="button" aria-pressed={value === level} disabled={disabled} onClick={() => onChange(level)}>
            {level}
          </button>
        ))}
      </div>
    );
  }
  if (control.mode === "switch") {
    return (
      <button
        type="button"
        className="chip"
        role="switch"
        aria-checked={value === true}
        disabled={disabled}
        onClick={() => onChange(value !== true)}
      >
        {control.label}
      </button>
    );
  }
  return null;
}
