import { useEffect, useRef, useState } from "react";

import { MEMORY_LIMIT, readMemory, redoMemory, revealMemory, template, undoMemory, useMemory, writeMemory } from "../lib/agentMemory.js";
import { inDesktop } from "../lib/http.js";
import { renderMarkdown } from "../lib/markdown.js";
import { notebook } from "../lib/notebook.js";
import { Icon } from "./Icon.jsx";

/* An agent's own memory (lib/agentMemory.js), in its Customize sheet: the
 * MEMORY.md file it keeps, shown as Markdown, editable here or in any editor.
 *
 * Like the Notebook, what's typed is saved with ⌘S, or a few seconds after
 * the caret leaves the box, or when the sheet closes. Undo and Redo step
 * through the saves, the agent's as well as the user's. If the agent writes
 * while the user is mid-edit, the user's text stays until they choose. */

const SAVE_AFTER = 3000;

export function AgentMemory({ agent }) {
  const { text, by, canUndo, canRedo, path } = useMemory(agent.id);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // null: nothing typed since the last save
  const [base, setBase] = useState(null); // the text the draft started from
  const timer = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    readMemory(agent.id, agent.name).then(() => setLoaded(true));
  }, [agent.id, agent.name]);

  const shown = text ?? template(agent.name);
  const theirs = draft != null && base != null && text != null && text !== base; // the agent wrote under the draft

  const save = (value = draft) => {
    clearTimeout(timer.current);
    timer.current = null;
    if (value == null) return;
    setDraft(null);
    setBase(null);
    writeMemory(agent.id, value, "user");
  };
  // Saved as the sheet closes, too.
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => () => latest.current(), []);

  const type = (value) => {
    if (draft == null) setBase(text);
    setDraft(value);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(), SAVE_AFTER);
  };
  const back = () => clearTimeout(timer.current);

  const size = (draft ?? shown).length;
  const cursor = notebook.cursor(agent.id, agent.id);
  const { head } = notebook.head();

  return (
    <section className="field memory">
      <span className="label memory-label">
        Memory
        <span className="memory-actions">
          <button type="button" className="btn icon-only" disabled={!canUndo || draft != null} onClick={() => undoMemory(agent.id)} aria-label="Undo the last save" title="Undo the last save">
            <Icon name="undo" size={16} />
          </button>
          <button type="button" className="btn icon-only" disabled={!canRedo || draft != null} onClick={() => redoMemory(agent.id)} aria-label="Redo" title="Redo">
            <Icon name="redo" size={16} />
          </button>
          <button type="button" className="btn" aria-pressed={editing} onClick={() => (editing ? (save(), setEditing(false)) : setEditing(true))}>
            {editing ? "Done" : "Edit"}
          </button>
        </span>
      </span>

      {theirs ? (
        <p className="nb-clash">
          {agent.name} updated its memory while you were editing.
          <button type="button" className="nb-clash-button" onClick={() => save()}>
            Keep mine
          </button>
          <button
            type="button"
            className="nb-clash-button"
            onClick={() => {
              setDraft(null);
              setBase(null);
            }}
          >
            Use theirs
          </button>
        </p>
      ) : null}

      {!loaded ? (
        <p className="hint">Reading…</p>
      ) : editing ? (
        <textarea
          ref={box}
          className="memory-text"
          value={draft ?? shown}
          spellCheck={false}
          aria-label={`${agent.name}'s memory, in Markdown`}
          onChange={(e) => type(e.target.value)}
          onFocus={back}
          onBlur={leave}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              save();
            }
            // Escape leaves the box, not the sheet.
            if (e.key === "Escape") {
              e.stopPropagation();
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <div className="memory-view md" onDoubleClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: renderMarkdown(shown) }} />
      )}

      <p className="hint memory-foot">
        <span>
          {draft != null ? "Unsaved · " : by && by !== "user" ? `Last written by ${agent.name} · ` : ""}~{Math.ceil(size / 4).toLocaleString()} of {Math.ceil(MEMORY_LIMIT / 4).toLocaleString()} tokens
          {cursor ? ` · In its chat it last saw the notebook at v${cursor.v}${cursor.v < head ? ` (now v${head})` : ""}` : ""}
        </span>
        <span className="memory-links">
          {inDesktop() && path ? (
            <button type="button" className="nb-clash-button" onClick={() => revealMemory(agent.id).catch(() => {})}>
              Show the file
            </button>
          ) : null}
          <button type="button" className="nb-clash-button" onClick={() => save(template(agent.name))}>
            Clear
          </button>
        </span>
      </p>
      <p className="hint">Only {agent.name} and you see this. It’s given to {agent.name} in full every turn; what’s about you belongs in the Notebook, which every agent shares.</p>
    </section>
  );
}
