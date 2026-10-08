import { AgentAvatar } from "./AgentAvatar.jsx";
import { Mascot } from "./Mascot.jsx";
import { Icon } from "./Icon.jsx";

/* Adding agents: the ready-made ones, and a blank one to make your own. "Add"
 * takes a preset as it is; the pencil opens it in the editor first. */
export function Gallery({ presets, onNew, onAdd, onCustomize, firstRun, mood = "idle" }) {
  return (
    <div className="gallery">
      <header className="gallery-head">
        {/* The first thing you meet: blvrd, large, looking about. */}
        {firstRun ? <Mascot shape="arc" colour="var(--red)" mood={mood} size={72} label="blvrd" /> : null}
        <h1>{firstRun ? "Start with an agent" : "Add an agent"}</h1>
        <p>
          An agent is a model with a job: its own instructions, the abilities it may use, and
          one ongoing chat with you. It runs on whichever model you give it — one on this
          computer by default.
        </p>
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon name="plus" />
          Make your own
        </button>
      </header>

      <section>
        <h2 className="label">Ready-made</h2>
        <div className="presets">
          {presets.map((preset) => (
            <div key={preset.id} className="preset">
              <AgentAvatar look={preset.look} name={preset.name} size={42} />
              <span className="preset-text">
                <span className="preset-name">{preset.name}</span>
                <span className="preset-tagline">{preset.tagline}</span>
              </span>
              <span className="preset-actions">
                <button
                  type="button"
                  className="btn icon-only"
                  title="Adjust it before adding"
                  aria-label={`Customize ${preset.name} before adding`}
                  onClick={() => onCustomize(preset)}
                >
                  <Icon name="pen" />
                </button>
                <button type="button" className="btn primary" onClick={() => onAdd(preset)}>
                  <Icon name="plus" />
                  Add
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
