import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* A small menu at a point: the sidebar's right-click (and ⋯) menu for an
 * agent's or a group's chat. Closes on a choice, a click elsewhere, Escape,
 * scrolling, or the window losing focus. ↑ ↓ move between items. */
export function RowMenu({ at, items, onClose }) {
  const menu = useRef(null);
  const [place, setPlace] = useState({ left: at.x, top: at.y });

  // Kept inside the window.
  useLayoutEffect(() => {
    const box = menu.current.getBoundingClientRect();
    setPlace({
      left: Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - box.height - 8)),
    });
    menu.current.querySelector("button:not(:disabled)")?.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const away = (e) => {
      if (!menu.current?.contains(e.target)) onClose();
    };
    const key = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const move = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...menu.current.querySelectorAll("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement);
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className="row-menu" role="menu" ref={menu} style={place} onKeyDown={move}>
      {items.map((item, i) =>
        item === "-" ? (
          <hr key={i} />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
