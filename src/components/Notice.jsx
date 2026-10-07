import { useEffect, useState } from "react";

const SHOWN = 6000; // ms; held while the pointer is on it

/* A notice at the foot of the window (App's `notify`): what just happened,
 * and Undo when it can be taken back. A new notice replaces the last one. */
export function Notice({ notice, onDone }) {
  const [held, setHeld] = useState(false);

  useEffect(() => setHeld(false), [notice?.id]);
  useEffect(() => {
    if (!notice || held) return undefined;
    const timer = setTimeout(onDone, SHOWN);
    return () => clearTimeout(timer);
  }, [notice?.id, held]);

  if (!notice) return null;
  return (
    <div className="notice" role="status" key={notice.id} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <span>{notice.text}</span>
      {notice.undo ? (
        <button
          type="button"
          onClick={() => {
            notice.undo();
            onDone();
          }}
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}
