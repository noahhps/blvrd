import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "./Icon.jsx";

/* A font menu whose every choice is set in its own face -- a native one can't
 * show that. Pointing at a choice, or moving to it with ↑ ↓, previews it
 * (`onPreview(id)`, null when the menu closes); a click or Enter picks it.
 * It opens upward when there's no room below, and without its little grow
 * when opened from the keyboard (it's quicker that way).
 *
 *   options  [{ id, label, stack, group?, note? }] -- a heading over each
 *            new group */
const ROOM = 280; // what the list needs below the button before it opens up

export function FontPicker({ id, label, value, options, onChange, onPreview = () => {} }) {
  const [open, setOpen] = useState(null); // null, or { up, keyboard }
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const list = useRef(null);
  const button = useRef(null);
  const chosen = options.find((o) => o.id === value) || options[0];

  const show = (at) => {
    setActive(at);
    onPreview(options[at].id);
  };
  const openMenu = (keyboard) => {
    const box = button.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    setOpen({ up: below < ROOM && box.top > below, keyboard });
    show(Math.max(0, options.indexOf(chosen)));
  };
  const close = (refocus = true) => {
    setOpen(null);
    onPreview(null);
    if (refocus) button.current?.focus();
  };
  const pick = (at) => {
    onChange(options[at].id);
    close();
  };

  // Opened: focus in the list, the chosen font in the middle of it. Only the
  // list scrolls (scrollIntoView would move the page under it too).
  useLayoutEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    reveal(list.current, true);
  }, [Boolean(open)]);
  // Then kept in view as ↑ ↓ move through it.
  useLayoutEffect(() => {
    if (open) reveal(list.current, false);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (!root.current?.contains(e.target)) close(false);
    };
    const left = () => close(false);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", left);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", left);
    };
  });

  const onKey = (e) => {
    const last = options.length - 1;
    const to = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      show(to);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
    }
  };

  return (
    <div className="font-picker" ref={root}>
      <button
        ref={button}
        id={id}
        type="button"
        className="font-picker-button"
        aria-haspopup="listbox"
        aria-expanded={Boolean(open)}
        aria-label={`${label}: ${chosen.label}`}
        onClick={(e) => (open ? close() : openMenu(e.detail === 0))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu(true);
          }
        }}
      >
        <span className="font-picker-name" style={{ fontFamily: chosen.stack }}>
          {chosen.label}
        </span>
        {chosen.note ? <span className="font-picker-note">{chosen.note}</span> : null}
        <Icon name="updown" size={14} />
      </button>
      {open ? (
        <ul
          ref={list}
          className="font-picker-list"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${options[active].id}`}
          data-up={open.up ? "" : undefined}
          data-instant={open.keyboard ? "" : undefined}
          onKeyDown={onKey}
        >
          {options.map((o, i) => (
            <FontOption
              key={o.id}
              id={`${id}-${o.id}`}
              option={o}
              heading={o.group && o.group !== options[i - 1]?.group ? o.group : null}
              rule={!o.group && options[i + 1]?.group}
              active={i === active}
              selected={o.id === value}
              onPoint={() => i !== active && show(i)}
              onPick={() => pick(i)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* The active choice brought into the list's view: centred, or just enough --
 * clear of the group heading stuck at the top. */
function reveal(ul, centre) {
  const li = ul?.querySelector("[data-active]");
  if (!li) return;
  if (centre) return void (ul.scrollTop = li.offsetTop - (ul.clientHeight - li.offsetHeight) / 2);
  const head = ul.querySelector(".font-picker-group")?.offsetHeight || 0;
  if (li.offsetTop - head < ul.scrollTop) ul.scrollTop = li.offsetTop - head;
  else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight + 4;
}

const FontOption = ({ id, option, heading, rule, active, selected, onPoint, onPick }) => (
  <>
    {heading ? (
      <li className="font-picker-group" role="presentation">
        {heading}
      </li>
    ) : null}
    <li
      id={id}
      role="option"
      aria-selected={selected}
      data-active={active ? "" : undefined}
      onPointerMove={onPoint}
      onClick={onPick}
    >
      <span className="font-picker-name" style={{ fontFamily: option.stack }}>
        {option.label}
      </span>
      {option.note ? <span className="font-picker-note">{option.note}</span> : null}
      {selected ? <Icon name="check" size={14} /> : null}
    </li>
    {rule ? <li className="font-picker-rule" role="separator" /> : null}
  </>
);
