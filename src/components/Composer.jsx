import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { kindOf, prepare } from "../lib/attach.js";
import { controlFor } from "../lib/thinking.js";
import { Icon } from "./Icon.jsx";

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
 * And Bom's motion: the box and its tray sit mostly below the window's edge
 * and rise to meet the cursor as it comes near (`--near`, 0 tucked to 1
 * present), with a halo that grows as it does. Focus holds it up while you
 * type; scrolling back to read tucks it away until the pointer moves again;
 * an empty chat keeps it present, since there is nothing for it to get out
 * of the way of. Off on touch screens and with reduced motion, where there is
 * no cursor to approach with -- the box simply stays.
 */

/* How far away the cursor starts to matter, and how sharply the box responds
   inside that range. At ONSET 2, halfway through REACH it has risen only a
   quarter of the way, so it doesn't stir just because the cursor is on the
   same screen -- and the curve keeps the late start from being abrupt. */
const REACH = 130;
const ONSET = 2;
const STICK_PX = 80; // a thread scrolled this close to its end counts as "at the end"
export function Composer({ agentName, disabled, provider, model, tray, focusKey, autoFocus = false, onSend, onStop }) {
  const form = useRef(null);
  const stack = useRef(null);
  const [popping, setPopping] = useState(false);
  const [value, setValue] = useState("");
  const [staged, setStaged] = useState([]); // { key, file, preview, problem }
  const [dropping, setDropping] = useState(false);
  const [control, setControl] = useState({ mode: "none" });
  const [thinking, setThinking] = useState(null);
  const input = useRef(null);
  const picker = useRef(null);
  const depth = useRef(0);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

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

  /* Proximity: where the box sits, from where the cursor is. Written as one
     custom property on the form, at most once a frame, quantised to a
     hundredth -- a hand resting on a mouse never stops twitching. Set before
     first paint, so it never flashes up and slides away. */
  useLayoutEffect(() => {
    const node = form.current;
    const box = stack.current;
    if (!node || !box) return undefined;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const enabled = () => fine.matches && !calm.matches;

    let frame = 0;
    let latest = null;
    let reading = false;
    let wrote = null;
    const set = (near) => {
      const step = Math.round(near * 100) / 100;
      if (step === wrote) return;
      wrote = step;
      node.style.setProperty("--near", step.toFixed(2));
    };
    const measure = () => {
      frame = 0;
      if (!enabled()) return set(1);
      // Typing outranks everything, streaming autoscroll included.
      if (node.contains(document.activeElement)) return set(1);
      if (reading || !latest) return set(0);
      // Distance to the nearest edge of box-and-tray; 0 anywhere inside.
      const rect = box.getBoundingClientRect();
      const dx = Math.max(rect.left - latest.x, 0, latest.x - rect.right);
      const dy = Math.max(rect.top - latest.y, 0, latest.y - rect.bottom);
      const closeness = Math.max(0, Math.min(1, 1 - Math.hypot(dx, dy) / REACH));
      set(closeness ** ONSET);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onMove = (e) => {
      latest = { x: e.clientX, y: e.clientY };
      reading = false; // moving the pointer is how you ask for it back
      schedule();
    };
    // The reader scrolling the thread wants to read, and the box is in the way.
    const onScroll = (e) => {
      if (!e.target?.classList?.contains("thread") || reading) return;
      reading = true;
      schedule();
    };
    const onLeave = () => {
      latest = null;
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    node.addEventListener("focusin", schedule);
    node.addEventListener("focusout", schedule);
    fine.addEventListener("change", schedule);
    calm.addEventListener("change", schedule);
    measure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.documentElement.removeEventListener("pointerleave", onLeave);
      node.removeEventListener("focusin", schedule);
      node.removeEventListener("focusout", schedule);
      fine.removeEventListener("change", schedule);
      calm.removeEventListener("change", schedule);
      node.style.removeProperty("--near");
    };
  }, []);

  /* The flourish, for a box that was actually tucked away when clicked: one
     springy rise, then `--near` is back in sole charge. Never on a click in a
     control, and never on a box that is already up -- that would only jerk
     something sitting still. */
  const pop = (event) => {
    if (popping || event.target.closest("button, select, label, input, a")) return;
    const near = parseFloat(form.current?.style.getPropertyValue("--near"));
    if (!(near < 0.9)) return;
    setPopping(true);
    setTimeout(() => setPopping(false), 800);
  };

  // A different agent starts with an empty box. The caret goes in only when
  // its chat is empty -- focus holds the composer up, so focusing a chat that
  // has a conversation to read would park the box over the end of it.
  useEffect(() => {
    setValue("");
    if (autoFocus) input.current?.focus();
  }, [focusKey]);

  const stage = useCallback((files) => {
    const items = [...files].map((file) => {
      const kind = kindOf(file);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}:${Math.random()}`,
        file,
        preview: kind === "image" ? URL.createObjectURL(file) : null,
        problem: kind ? null : "isn't a picture or a text file",
      };
    });
    setStaged((prev) => [...prev, ...items]);
  }, []);

  const unstage = (key) =>
    setStaged((prev) => {
      const going = prev.find((i) => i.key === key);
      if (going?.preview) URL.revokeObjectURL(going.preview);
      return prev.filter((i) => i.key !== key);
    });

  // Dropping anywhere on the window. Depth-counted, because dragenter and
  // dragleave fire for every element crossed on the way in.
  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const enter = (e) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDropping(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDropping(false);
    };
    const over = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDropping(false);
      stage(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [stage]);

  useEffect(() => () => stagedRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const usable = staged.filter((i) => !i.problem);

  const submit = async (event) => {
    event.preventDefault();
    // Enter still submits while an answer streams; clearing the box for a
    // send that is then refused would lose what was typed.
    if (disabled) return;
    if (!value.trim() && !usable.length) return;
    const text = value;
    const going = usable;
    setValue("");
    setStaged([]);
    const files = (await Promise.all(going.map((i) => prepare(i.file)))).filter((f) => !f.error);
    going.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    onSend(text.trim(), files, control.mode === "none" ? null : { control, value: thinking });
  };

  return (
    <form
      className="composer"
      ref={form}
      onSubmit={submit}
      onClick={pop}
      data-dropping={dropping ? "" : undefined}
      data-popping={popping ? "" : undefined}
    >
      <div className="composer-stack" ref={stack}>
      <div className="composer-box">
        {staged.length ? (
          <ul className="staged" aria-label="Attached">
            {staged.map((item) => (
              <li key={item.key} className="staged-item" data-problem={item.problem ? "" : undefined} title={item.problem ? `${item.file.name} ${item.problem}` : item.file.name}>
                {item.preview ? <img src={item.preview} alt="" /> : <Icon name={item.problem ? "close" : "file"} size={16} />}
                <span className="staged-name">{item.file.name}</span>
                <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => unstage(item.key)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={input}
          rows={1}
          value={value}
          placeholder={`Message ${agentName}`}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
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
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              stage(e.target.files);
              e.target.value = ""; // so picking the same file again still fires
            }}
          />
          <button type="button" className="chip icon" aria-label="Attach files" title="Attach pictures or text files" onClick={() => picker.current.click()}>
            <Icon name="paperclip" size={16} />
          </button>

          <span className="spacer" />

          <Thinking control={control} value={thinking} onChange={setThinking} disabled={disabled} />

          {disabled ? (
            <button type="button" className="round stop" aria-label="Stop" title="Stop" onClick={onStop}>
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button type="submit" className="round" aria-label="Send" title="Send" disabled={!value.trim() && !usable.length}>
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
