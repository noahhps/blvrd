import { shortTokens } from "../lib/agentMetrics.js";

/* An agent's readings (lib/agentMetrics.js) drawn small enough to read at a
 * glance: heat as a thermal bar, tokens as a count over a sparkline of the
 * last turns, context left as the ten-segment "sanity" counter, and the
 * model's kind as an LLM / System 1 badge.
 *
 * `size` is how much room there is: "row" (a sidebar row: bars and numbers
 * only), "head" (a chat's header) or "card" (the rack, with labels and the
 * sparkline). */

const levelOfHeat = (h) => (h >= 75 ? "hot" : h >= 40 ? "warm" : "cool");
const levelOfContext = (left) => (left <= 10 ? "critical" : left <= 25 ? "low" : "ok");

export function Heat({ value, size = "card" }) {
  return (
    <span className="gauge gauge-heat" data-level={levelOfHeat(value)} data-size={size} title={`Heat ${value} — load over the last ten minutes, and while it answers`}>
      <span className="gauge-label">Heat</span>
      <span className="gauge-track" aria-hidden="true">
        <i style={{ width: `${Math.max(value, 2)}%` }} />
      </span>
      <span className="gauge-value">{value}</span>
    </span>
  );
}

export function Tokens({ value, spark = [], size = "card" }) {
  const max = Math.max(1, ...spark);
  const points = spark.map((v, i) => `${spark.length > 1 ? (i / (spark.length - 1)) * 100 : 50},${22 - (v / max) * 20}`).join(" ");
  return (
    <span className="gauge gauge-tokens" data-size={size} title={`About ${value.toLocaleString()} tokens used in this chat`}>
      <span className="gauge-label">Tok</span>
      {size !== "row" && spark.length > 1 ? (
        <svg className="gauge-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} />
        </svg>
      ) : null}
      <span className="gauge-value">{shortTokens(value)}</span>
    </span>
  );
}

export function Sanity({ context, size = "card" }) {
  if (!context) return null;
  const { left, used, limit } = context;
  const lit = Math.ceil(left / 10);
  return (
    <span
      className="sanity gauge"
      data-level={levelOfContext(left)}
      data-size={size}
      role="meter"
      aria-label="Sanity: context left before this chat is compacted"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={left}
      title={`Sanity ${left}% — about ${used.toLocaleString()} of ${limit.toLocaleString()} tokens used. At 0% the older part of this chat is summarized.`}
    >
      <span className="sanity-label gauge-label">Sanity</span>
      <span className="sanity-bar" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} data-on={i < lit ? "" : undefined} />
        ))}
      </span>
      <span className="sanity-value gauge-value">{left}%</span>
    </span>
  );
}

/** LLM or System 1, and -- for a System 1 model -- what it does. */
const TASKS = { decide: "Decides", embed: "Embeds", rank: "Ranks", classify: "Classifies", match: "Matches", dedupe: "Dedupes", tag: "Tags", listen: "Transcribes", see: "Detects" };

export function KindBadge({ kind, task = null, model, size = "card" }) {
  if (!kind) return <span className="kind-badge" data-kind="none" data-size={size}>No model</span>;
  const title =
    kind === "s1"
      ? "System 1: a fast, reflexive model — no conversation, one input at a time"
      : "LLM: a language model that reads, writes and holds a conversation";
  return (
    <span className="kind-badge" data-kind={kind} data-size={size} title={title}>
      <span className="kind-name">{kind === "s1" ? "SYS-1" : "LLM"}</span>
      {task && size !== "row" ? <span className="kind-task">{TASKS[task] || task}</span> : null}
      {model && size !== "row" ? <span className="kind-model">{model}</span> : null}
    </span>
  );
}

/** All three readings in a row. */
export function Gauges({ r, size = "card" }) {
  return (
    <span className="gauges" data-size={size}>
      <Heat value={r.heat} size={size} />
      <Tokens value={r.tokens} spark={r.spark} size={size} />
      <Sanity context={r.context} size={size} />
    </span>
  );
}
