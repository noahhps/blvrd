/* Run in a page by the blvrd extension: what a step does to it -- clicking,
 * filling, choosing, ticking, pressing a key, scrolling -- on the element a
 * ref (collect.js) names. Self-contained, as collect.js is: each is sent into
 * the page as it is.
 *
 * A value is set through the element's own setter and then announced with
 * input and change events, so pages built with React and the like see it as
 * typed. */

export function ACT(kind, ref, payload = {}) {
  const el = document.querySelector(`[data-blvrd-ref="${ref}"]`);
  if (!el) return { error: `there is no [${ref}] on the page now -- look at the page again for the current numbers` };
  el.scrollIntoView({ block: "center", inline: "center" });
  const fire = (type, Kind = Event, init = {}) => el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, ...init }));
  const enter = () => {
    const key = { key: "Enter", code: "Enter", keyCode: 13, which: 13 };
    const go = fire("keydown", KeyboardEvent, key);
    fire("keypress", KeyboardEvent, key);
    fire("keyup", KeyboardEvent, key);
    if (go && el.form) {
      if (el.form.requestSubmit) el.form.requestSubmit();
      else el.form.submit();
    }
  };
  if (el.disabled) return { error: `[${ref}] is disabled` };
  if (kind === "click") {
    for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup"]) fire(type, type.startsWith("pointer") ? PointerEvent : MouseEvent);
    el.focus?.();
    el.click();
    return { ok: true };
  }
  if (kind === "fill") {
    el.focus?.();
    const text = String(payload.text ?? "");
    if (el.isContentEditable) {
      el.textContent = text;
      fire("input", InputEvent, { inputType: "insertText", data: text });
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (set) set.call(el, text);
      else el.value = text;
      fire("input", InputEvent, { inputType: "insertText", data: text });
      fire("change");
    }
    if (payload.submit) enter();
    return { ok: true };
  }
  if (kind === "select") {
    if (el.tagName !== "SELECT") return { error: `[${ref}] isn't a list to choose from` };
    const want = String(payload.label ?? "").trim().toLowerCase();
    const option = [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) || [...el.options].find((o) => o.text.toLowerCase().includes(want));
    if (!option) return { error: `[${ref}] has no option "${payload.label}"; it has: ${[...el.options].map((o) => o.text.trim()).slice(0, 15).join(", ")}` };
    el.value = option.value;
    fire("input");
    fire("change");
    return { ok: true };
  }
  if (kind === "check") {
    const on = Boolean(payload.on);
    const now = el.checked ?? el.getAttribute("aria-checked") === "true";
    if (now !== on) el.click();
    return { ok: true };
  }
  return { error: `can't ${kind}` };
}

/* A key pressed where the page's focus is. */
export function PRESS(key) {
  const target = document.activeElement || document.body;
  const parts = String(key).split("+");
  const main = parts.pop();
  const mods = { ctrlKey: parts.includes("Control"), metaKey: parts.includes("Meta"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift") };
  const init = { key: main, code: main.length === 1 ? `Key${main.toUpperCase()}` : main, bubbles: true, cancelable: true, composed: true, ...mods };
  const go = target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  if (go && main === "Enter" && target.form) target.form.requestSubmit ? target.form.requestSubmit() : target.form.submit();
  if (go && main === "Escape") document.querySelector("dialog[open]")?.close?.();
  return { ok: true };
}

export function SCROLL(dir) {
  if (dir === "top") scrollTo(0, 0);
  else if (dir === "bottom") scrollTo(0, document.documentElement.scrollHeight);
  else scrollBy(0, (dir === "up" ? -0.8 : 0.8) * innerHeight);
  return { ok: true };
}

export function HAS_TEXT(text) {
  return document.body?.innerText.includes(text) || false;
}
