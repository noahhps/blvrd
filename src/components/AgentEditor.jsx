import { useEffect, useMemo, useState } from "react";

import { COLOURS, colourIdOf } from "../lib/agents.js";
import { TOOLS } from "../lib/tools.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Icon } from "./Icon.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

function draftFrom(agent) {
  return {
    name: agent?.name || "",
    instructions: agent?.instructions || "",
    all: agent?.tools == null,
    chosen: new Set(agent?.tools || TOOLS.filter((t) => !t.network).map((t) => t.name)),
    colour: colourIdOf(agent) || "red",
    model: agent?.model || null,
  };
}

/**
 * Customise an agent: its colour, what it is for, which model it runs on,
 * and what it may use. One sheet for a new agent, one from a preset, and one
 * being changed -- `agent` is the stored agent, or null for a new one;
 * `initial` is what a new one starts from.
 */
export function AgentEditor({ agent, initial, providers, defaultModel, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(() => draftFrom(agent || initial));
  const [error, setError] = useState("");
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const look = useMemo(() => ({ colour: draft.colour }), [draft.colour]);

  const toggle = (name) =>
    setDraft((d) => {
      const chosen = new Set(d.chosen);
      if (chosen.has(name)) chosen.delete(name);
      else chosen.add(name);
      return { ...d, chosen };
    });

  const save = () => {
    const name = draft.name.trim();
    if (!name) return setError("An agent needs a name.");
    if (draft.model && !draft.model.model) return setError("Choose a model, or use the default.");
    onSave({
      name,
      instructions: draft.instructions.trim(),
      tools: draft.all ? null : TOOLS.map((t) => t.name).filter((n) => draft.chosen.has(n)),
      look,
      model: draft.model,
    });
  };

  const defaultLabel = defaultModel?.model ? `Use the default (${defaultModel.model})` : "Use the default model";

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Customize agent">
        <button type="button" className="sheet-close btn icon-only" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>

        <div className="sheet-head">
          <AgentAvatar look={look} size={80} />
          <input
            className="sheet-name"
            type="text"
            value={draft.name}
            placeholder="Name your agent"
            aria-label="Name"
            autoFocus={!agent}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>

        <div className="sheet-body">
          <section className="field">
            <span className="label">Colour</span>
            <div className="wear-row" role="radiogroup" aria-label="Colour">
              {COLOURS.map((colour) => (
                <button
                  key={colour.id}
                  type="button"
                  role="radio"
                  className="wear"
                  aria-checked={draft.colour === colour.id}
                  aria-pressed={draft.colour === colour.id}
                  title={colour.label}
                  onClick={() => set({ colour: colour.id })}
                >
                  <AgentAvatar look={{ colour: colour.id }} size={30} />
                </button>
              ))}
            </div>
          </section>

          <label className="field">
            <span className="label">Instructions</span>
            <textarea
              value={draft.instructions}
              placeholder="What this agent is for and how it works -- its role, its voice, what it should always or never do. Given to the model as its system prompt."
              onChange={(e) => set({ instructions: e.target.value })}
            />
          </label>

          <section className="field">
            <span className="label">Model</span>
            <ModelPicker
              providers={providers}
              value={draft.model}
              onChange={(model) => set({ model })}
              allowDefault
              defaultLabel={defaultLabel}
            />
          </section>

          <section className="field">
            <span className="label">Abilities</span>
            <label className="check">
              <input type="checkbox" checked={draft.all} onChange={(e) => set({ all: e.target.checked })} />
              <span>Everything blvrd can do</span>
            </label>
            {!draft.all ? (
              <div className="checks">
                {TOOLS.map((tool) => (
                  <label key={tool.name} className="check">
                    <input type="checkbox" checked={draft.chosen.has(tool.name)} onChange={() => toggle(tool.name)} />
                    <span>
                      {tool.label}
                      {tool.network ? <span className="tag">uses the internet</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="hint">Includes reading web pages, which reaches the internet. Untick to choose.</p>
            )}
          </section>
        </div>

        {error ? <p className="error-line">{error}</p> : null}

        <div className="sheet-actions">
          {agent ? (
            <button type="button" className="btn danger" onClick={() => onDelete(agent)}>
              <Icon name="trash" />
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save}>
            {agent ? "Save" : "Add agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
