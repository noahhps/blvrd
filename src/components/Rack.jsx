import { useCallsign } from "../lib/callsigns.js";
import { shortTokens } from "../lib/agentMetrics.js";
import { Gauges, KindBadge } from "./Gauges.jsx";
import { Icon } from "./Icon.jsx";

/* The rack: every agent as a unit, grouped by the kind of model it runs on --
 * LLMs (they read, write and hold a conversation) and System 1 models (fast,
 * reflexive, one input at a time: embed, rank, classify, tag, transcribe,
 * detect) -- with its heat, tokens and context left on the face of it. A
 * unit opens its chat. Under the rack, the specialists not yet deployed,
 * each with the model it is meant for.
 *
 * `units` is [{ agent, model, readings, tagline, when }] (App works the
 * readings out, lib/agentMetrics.js). */

const BAYS = [
  { kind: "llm", title: "LLMs", note: "Language models. They read, write and hold a conversation." },
  { kind: "s1", title: "System 1", note: "Fast, reflexive models. No conversation: one input, one answer." },
  { kind: null, title: "No model", note: "Choose a model to bring these online." },
];

export function Rack({ units, specialists, onOpen, onAdd, onGallery }) {
  const call = useCallsign();
  const total = units.reduce((n, u) => n + u.readings.tokens, 0);
  const hottest = units.reduce((h, u) => (u.readings.heat > (h?.readings.heat ?? -1) ? u : h), null);
  const lowest = units.filter((u) => u.readings.context).reduce((l, u) => (u.readings.context.left < (l?.readings.context.left ?? 101) ? u : l), null);
  const active = units.filter((u) => u.readings.answering).length;
  return (
    <div className="rack">
      <header className="rack-head">
        <div className="rack-title">
          <h1>Agents</h1>
          <p className="rack-lede">Every agent at a glance: how hot it is running, how many tokens it has used, and how much context it has left.</p>
        </div>
        <dl className="rack-totals">
          <div>
            <dt>Units</dt>
            <dd>{units.length}</dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{active}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>{shortTokens(total)}</dd>
          </div>
          <div>
            <dt>Hottest</dt>
            <dd>{hottest && hottest.readings.heat > 0 ? `${call(hottest.agent.name)} · ${hottest.readings.heat}` : "—"}</dd>
          </div>
          <div>
            <dt>Least context</dt>
            <dd>{lowest ? `${call(lowest.agent.name)} · ${lowest.readings.context.left}%` : "—"}</dd>
          </div>
        </dl>
      </header>

      {BAYS.map((bay) => {
        const here = units.filter((u) => u.readings.kind === bay.kind);
        if (!here.length) return null;
        return (
          <section key={String(bay.kind)} className="rack-bay" data-kind={bay.kind ?? "none"}>
            <h2 className="rack-bay-head">
              <span className="rack-bay-title">{bay.title}</span>
              <span className="rack-bay-note">{bay.note}</span>
              <span className="rack-bay-count">{here.length}</span>
            </h2>
            <div className="rack-units">
              {here.map((u, i) => (
                <button
                  key={u.agent.id}
                  type="button"
                  className="unit"
                  data-answering={u.readings.answering ? "" : undefined}
                  data-heat={u.readings.heat >= 75 ? "hot" : u.readings.heat >= 40 ? "warm" : "cool"}
                  style={{ "--agent": u.colour }}
                  onClick={() => onOpen(u.agent.id)}
                >
                  <span className="unit-top">
                    <span className="unit-no">{String(i + 1).padStart(2, "0")}</span>
                    <span className="unit-name" title={u.agent.name}>
                      {call(u.agent.name)}
                    </span>
                    <span className="unit-state">{u.readings.answering ? "Answering" : u.when ? u.when : "Idle"}</span>
                  </span>
                  <span className="unit-task">{u.tagline}</span>
                  <KindBadge kind={u.readings.kind} task={u.readings.task} model={u.model} size="card" />
                  <Gauges r={u.readings} size="card" />
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {specialists.length ? (
        <section className="rack-bay rack-spares">
          <h2 className="rack-bay-head">
            <span className="rack-bay-title">Specialists</span>
            <span className="rack-bay-note">One narrow job each, on the kind of model it is meant for.</span>
            <button type="button" className="btn" onClick={onGallery}>
              All ready-made agents
            </button>
          </h2>
          <div className="rack-spare-list">
            {specialists.map((p) => (
              <div key={p.id} className="spare">
                <span className="spare-text">
                  <span className="spare-top">
                    <span className="spare-name">{call(p.name)}</span>
                    <KindBadge kind={p.kind} model={null} size="spare" />
                  </span>
                  <span className="spare-task">{p.tagline}</span>
                  {p.suggested ? <span className="spare-model">Runs on {p.suggested}</span> : null}
                </span>
                <button type="button" className="btn" onClick={() => onAdd(p)} aria-label={`Add ${p.name}`}>
                  <Icon name="plus" />
                  Add
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
