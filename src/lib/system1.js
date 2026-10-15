/* System 1 agents: Ollama's decision models (nimble, tev1, laya, clef,
 * clef-flash; Ollama 0.35 or later). They don't chat: /api/show lists their
 * capability as "decision", and /api/chat refuses them ("does not support
 * chat"). What Ollama expects instead is
 *
 *   POST /v1/systemone
 *   { model, state: "text" | {...}, images?: [base64...],
 *     questions: { <name>: { type, instructions, criteria? }, ... } }
 *   ->
 *   { model, answers: { <name>: answer, ... }, usage: { input_tokens, output_tokens } }
 *
 * with one answer per question, in the order asked:
 *
 *   noul    yes or no. criteria (optional): { "false": "...", "true": "..." }.
 *           -> { type, noul }  the probability of true, 0-1
 *   choice  one of 2-26 named options. criteria: { key: "description" | null }
 *           -> { type, choice, probabilities: { key: p }, confidence }
 *   score   one of 2-10 levels, lowest first. criteria: ["description", ...]
 *           -> { type, score, legend: { "0": "..." }, probabilities: { "0": p },
 *                confidence }  score = sum of level x P(level)
 *
 * 1-64 questions a request; the body must fit 64 KiB (32 MiB with images);
 * the input is never truncated, so it must fit the loaded context window.
 * Only local models -- there is no System One in Ollama's cloud.
 * (Ollama: docs/capabilities/decision.mdx, decision/systemone.go.) */

import { httpFetch } from "./http.js";

export const TYPES = [
  { id: "noul", label: "Yes / no", verb: "Decides", hint: "The probability that a statement about the input is true." },
  { id: "choice", label: "Choice", verb: "Chooses", hint: "The likeliest of 2–26 options, with each one's probability." },
  { id: "score", label: "Score", verb: "Scores", hint: "Where the input sits on 2–10 levels, lowest first: the probability-weighted level." },
];
export const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[0];

/** Ollama's decision models, for the editor's suggestions. */
export const DECISION_MODELS = ["nimble", "tev1", "tev1:0.8b", "laya", "clef", "clef-flash"];

export const LIMITS = { questions: 64, choices: [2, 26], levels: [2, 10], bytes: 64 * 1024 };

/** A new question of `type`, ready to fill in. */
export function blankQuestion(type = "noul", name = "q1") {
  if (type === "choice") return { name, type, instructions: "", criteria: [{ key: "", description: "" }, { key: "", description: "" }] };
  if (type === "score") return { name, type, instructions: "", criteria: ["", ""] };
  return { name, type: "noul", instructions: "", criteria: { false: "", true: "" } };
}

/** What a System 1 agent keeps besides its model: its questions. Agents made
 *  when System 1 meant embedding models ({ task, labels }) come back as one
 *  choice question over their labels. */
export function s1Of(agent) {
  const s1 = agent?.s1 || {};
  if (Array.isArray(s1.questions) && s1.questions.length) return { questions: s1.questions };
  if (Array.isArray(s1.labels) && s1.labels.length >= 2)
    return { questions: [{ name: "label", type: "choice", instructions: "Which label fits this text?", criteria: s1.labels.map((key) => ({ key, description: "" })) }] };
  return { questions: [blankQuestion("noul")] };
}

/** One line for the agent's badge: what it does. */
export function summaryOf(config) {
  const questions = config?.questions || [];
  if (questions.length === 1) return typeOf(questions[0].type).verb;
  return `${questions.length} questions`;
}

/* -- checking and shaping the request ---------------------------------------- */

const filled = (x) => typeof x === "string" && x.trim() !== "";

/** What is wrong with a question, or null. */
export function problemWith(q) {
  const name = q?.name ? `“${q.name}”` : "A question";
  if (!filled(q?.name)) return "Every question needs a name.";
  if (!filled(q.instructions)) return `${name} needs its question written out.`;
  if (q.type === "choice") {
    const options = (q.criteria || []).filter((o) => filled(o.key));
    const [lo, hi] = LIMITS.choices;
    if (options.length < lo || options.length > hi) return `${name} needs ${lo}–${hi} options.`;
    if (new Set(options.map((o) => o.key.trim())).size !== options.length) return `${name} has two options with the same name.`;
  } else if (q.type === "score") {
    const levels = (q.criteria || []).filter(filled);
    const [lo, hi] = LIMITS.levels;
    if (levels.length < lo || levels.length > hi) return `${name} needs ${lo}–${hi} levels.`;
  } else if (q.type !== "noul") return `${name} has no type.`;
  return null;
}

/** What is wrong with the whole set, or null. */
export function problemWithAll(config) {
  const questions = config?.questions || [];
  if (!questions.length) return "Ask at least one question.";
  if (questions.length > LIMITS.questions) return `Ask at most ${LIMITS.questions} questions.`;
  const names = questions.map((q) => String(q.name || "").trim());
  if (new Set(names).size !== names.length) return "Two questions have the same name.";
  for (const q of questions) {
    const problem = problemWith(q);
    if (problem) return problem;
  }
  return null;
}

/** The questions, as /v1/systemone takes them. */
export function questionsBody(questions) {
  const body = {};
  for (const q of questions) {
    const entry = { type: q.type, instructions: q.instructions.trim() };
    if (q.type === "choice") {
      entry.criteria = {};
      for (const o of q.criteria.filter((o) => filled(o.key))) entry.criteria[o.key.trim()] = filled(o.description) ? o.description.trim() : null;
    } else if (q.type === "score") {
      entry.criteria = q.criteria.filter(filled).map((x) => x.trim());
    } else {
      const c = q.criteria || {};
      if (filled(c.false) || filled(c.true)) {
        entry.criteria = {};
        if (filled(c.false)) entry.criteria.false = c.false.trim();
        if (filled(c.true)) entry.criteria.true = c.true.trim();
      }
    }
    body[q.name.trim()] = entry;
  }
  return body;
}

/** The input box's text as a state: JSON when it is a JSON object or array
 *  (so questions can name its fields in backticks), else the text itself. */
export function stateOf(input) {
  const text = String(input || "").trim();
  if (/^[[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* text after all */
    }
  }
  return text;
}

/* -- the call ------------------------------------------------------------------- */

const trim = (url) => String(url || "").replace(/\/+$/, "");

/** Ask `model` the questions about `state`. Returns Ollama's response. */
export async function decide({ provider, model, state, questions, images = null, signal }) {
  if (provider.kind !== "ollama") throw new Error(`System 1 runs on Ollama's decision models (Ollama 0.35 or later); ${provider.name || "this server"} doesn't have /v1/systemone.`);
  const body = JSON.stringify({ model, state, questions: questionsBody(questions), ...(images?.length ? { images } : {}) });
  if (!images?.length && new TextEncoder().encode(body).length > LIMITS.bytes) throw new Error("That's over the 64 KiB Ollama takes for one System 1 request. Shorten the input.");
  const response = await httpFetch(`${trim(provider.base)}/v1/systemone`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
  if (!response.ok) throw new Error(await problemOf(response, model));
  return response.json();
}

async function problemOf(response, model) {
  const text = await response.text().catch(() => "");
  let detail = text;
  try {
    detail = JSON.parse(text).error || text;
  } catch {
    /* plain text */
  }
  detail = String(detail || "").trim();
  const pulls = `ollama pull ${DECISION_MODELS[0]}`;
  if (response.status === 404 && !/model/i.test(detail)) return `This Ollama has no System One endpoint. It arrived in Ollama 0.35 — update Ollama, then try again.`;
  if (response.status === 404) return `Ollama doesn't have ${model}. Pull it first: ollama pull ${model}`;
  if (response.status === 413) return "That's more than Ollama takes for one System 1 request (64 KiB). Shorten the input.";
  if (/does not support System One|requires a local decision model|unsupported decision encoding/i.test(detail))
    return `${model} isn't a decision model, so it can't run as a System 1 agent. Choose one of Ollama's decision models (${DECISION_MODELS.slice(0, 4).join(", ")}…) — ${pulls} — or make this agent an LLM.`;
  if (/context/i.test(detail)) return `The input is longer than ${model} can read at once, and System 1 input is never cut short. Shorten it. (Ollama: ${detail})`;
  return `Ollama answered ${response.status}${detail ? `: ${detail}` : ""}`;
}

/* -- a run ---------------------------------------------------------------------- */

/** Run the agent's questions on `input`: returns a result for the console,
 *  and the same as Markdown for the chat's log. */
export async function run({ provider, model, input, config, images = null, signal }) {
  const problem = problemWithAll(config);
  if (problem) throw new Error(problem);
  const state = stateOf(input);
  if (state === "" || (typeof state === "object" && !Object.keys(state).length)) throw new Error("Write the input to decide about.");
  const started = Date.now();
  const data = await decide({ provider, model, state, questions: config.questions, images, signal });
  const answers = config.questions.map((q) => {
    const name = q.name.trim();
    return { name, instructions: q.instructions.trim(), ...(data.answers?.[name] || { type: q.type, missing: true }) };
  });
  const result = { model: data.model || model, answers, usage: data.usage || null, ms: Date.now() - started };
  return { result, markdown: markdownOf(result) };
}

export const pct = (x) => `${Math.round((x ?? 0) * 1000) / 10}%`;

/** Each answer in a line or two. */
export function lineOf(a) {
  if (a.missing) return "no answer";
  if (a.type === "noul") return `${a.noul >= 0.5 ? "yes" : "no"} · ${pct(a.noul >= 0.5 ? a.noul : 1 - a.noul)}`;
  if (a.type === "choice") return `${a.choice} · ${pct(a.probabilities?.[a.choice])}`;
  if (a.type === "score") {
    const top = levelOf(a);
    const levels = Object.keys(a.legend || a.probabilities || {}).length;
    return `${a.legend?.[top] ?? top} · ${a.score.toFixed(2)} / ${Math.max(0, levels - 1)}`;
  }
  return "";
}

/** A score answer's likeliest level, as its key ("0", "1", ...). */
export function levelOf(a) {
  const entries = Object.entries(a.probabilities || {});
  return entries.length ? entries.reduce((best, x) => (x[1] > best[1] ? x : best))[0] : "0";
}

export function markdownOf(r) {
  const rows = r.answers.map((a) => `| ${a.instructions.replace(/\|/g, "\\|")} | ${lineOf(a)} |`).join("\n");
  const usage = r.usage ? ` · ${r.usage.input_tokens} tokens in` : "";
  const gist = r.answers.map((a) => `${a.name}: ${lineOf(a)}`).join(" · ");
  return `${gist}\n\n| Question | Answer |\n|---|---|\n${rows}\n\n\`${r.model}\`${usage} · ${r.ms} ms`;
}
