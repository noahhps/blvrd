import { useEffect, useMemo, useRef, useState } from "react";

import { COLOURS, DOTS_MAX, DOTS_MIN, colourIdOf, dotsOf } from "../lib/agents.js";
import { avatarFrom } from "../lib/attach.js";
import { TOOLS } from "../lib/tools.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { BrandLogo } from "./BrandLogo.jsx";
import { Icon } from "./Icon.jsx";
import { ModelPicker } from "./ModelPicker.jsx";

function draftFrom(agent) {
  return {
    name: agent?.name || "",
    instructions: agent?.instructions || "",
    all: agent?.tools == null,
    chosen: new Set(agent?.tools || TOOLS.filter((t) => !t.network).map((t) => t.name)),
    colour: colourIdOf(agent) || "red",
    dots: dotsOf(agent?.look),
    image: agent?.look?.image || null,
    model: agent?.model || null,
  };
}

/**
 * Customise an agent: its colour, what it is for, which model it runs on,
 * and what it may use. One sheet for a new agent, one from a preset, and one
 * being changed -- `agent` is the stored agent, or null for a new one;
 * `initial` is what a new one starts from.
 */
export function AgentEditor({ agent, initial, providers, defaultModel, groups = [], onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(() => draftFrom(agent || initial));
  const [error, setError] = useState("");
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const look = useMemo(
    () => ({
      colour: draft.colour,
      dots: draft.dots,
      ...(draft.image ? { image: draft.image } : {}),
    }),
    [draft.colour, draft.dots, draft.image],
  );
  const picker = useRef(null);

  const choosePicture = async (file) => {
    if (!file) return;
    try {
      const image = await avatarFrom(file);
      set({ image });
      setError("");
    } catch (problem) {
      setError(problem.message || "That picture couldn't be read.");
    }
  };

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
      // Built-in tools by name, connectors as `group:<id>` -- so a connector's
      // tools added later (a refreshed MCP server) come with it.
      tools: draft.all
        ? null
        : [...TOOLS.map((t) => t.name), ...groups.map((g) => `group:${g.id}`)].filter((n) => draft.chosen.has(n)),
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
          {/* The picture is chosen on the avatar itself: a camera at its
              bottom-right, and -- once there is a picture -- a cross at its
              top-right that goes back to the dots. */}
          <div className="avatar-edit">
            <AgentAvatar look={look} name={draft.name} size={80} />
            <button
              type="button"
              className="avatar-badge avatar-choose"
              aria-label={draft.image ? "Choose another picture" : "Use a picture"}
              title={draft.image ? "Choose another picture" : "Use a picture"}
              onClick={() => picker.current.click()}
            >
              <Icon name="camera" size={14} />
            </button>
            {draft.image ? (
              <button
                type="button"
                className="avatar-badge avatar-remove"
                aria-label="Remove the picture and go back to dots"
                title="Remove picture"
                onClick={() => set({ image: null })}
              >
                <Icon name="close" size={12} />
              </button>
            ) : null}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                choosePicture(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
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
            <span className="label">Avatar</span>
            {draft.image ? (
              <p className="hint">A picture of your own. Remove it (the × on the picture) to go back to dots.</p>
            ) : (
              <>
                <label className="dots-range">
                  <span>Dots</span>
                  <input
                    type="range"
                    min={DOTS_MIN}
                    max={DOTS_MAX}
                    step={1}
                    value={draft.dots}
                    aria-valuetext={`${draft.dots} dots`}
                    onChange={(e) => set({ dots: Number(e.target.value) })}
                  />
                  <output>{draft.dots}</output>
                </label>
                <div className="wear-row" role="radiogroup" aria-label="Colour">
                  {COLOURS.map((colour) => (
                    <button
                      key={colour.id}
                      type="button"
                      role="radio"
                      className="wear"
                      aria-checked={draft.colour === colour.id}
                      title={colour.label}
                      onClick={() => set({ colour: colour.id })}
                    >
                      <AgentAvatar look={{ colour: colour.id, dots: draft.dots }} size={30} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <label className="field">
            <span className="label">Instructions</span>
            <textarea
              value={draft.instructions}
              placeholder="What this agent is for and how it works — its role, its voice, what it should always or never do. Given to the model as its system prompt."
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
                {groups.map((g) => (
                  <label key={g.id} className="check">
                    <input type="checkbox" checked={draft.chosen.has(`group:${g.id}`)} onChange={() => toggle(`group:${g.id}`)} />
                    <BrandLogo id={g.logo} name={g.label} size={14} tile={false} />
                    <span>
                      {g.label}
                      <span className="tag">
                        {g.count} tool{g.count === 1 ? "" : "s"}
                        {g.acts ? " · asks before acting" : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="hint">
                Includes reading web pages, which reaches the internet
                {groups.length ? `, and ${groups.map((g) => g.label).join(", ")}` : ""}. Anything that sends, adds or changes
                something asks you first. Untick to choose.
              </p>
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
