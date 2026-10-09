/* The worker: computer work in a context of its own (docs/computer.md §5).
 *
 * The agent in the chat calls `computer_task` with a task; this runs it on
 * the computer with the shell, file and browser tools, and gives back a short
 * report. The steps are kept for the reader to open, never sent to any model
 * again -- a ten-step browser session would otherwise sit in a small window
 * for the rest of the chat.
 *
 * History grows append-only, so the model server reuses its cache of it.
 * When it passes the checkpoint (lib/computer/budget.js) it starts afresh --
 * the task, the notes file, every step so far as one line, the last two
 * results in full -- once, and grows again from there. A fresh conversation,
 * not an edited one: the same cost to the cache, and no server's history
 * checks to trip. */

import { sizeOf } from "../compact.js";
import { runTurn } from "../run.js";
import { budgetFor } from "./budget.js";
import { computerTools } from "./tools.js";

export const MAX_STEPS = 30;
const SLICE = 6; // rounds between looks at the context's size
export const NOTES = ".task/notes.md";

const clip = (text, n) => {
  const s = String(text || "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const firstLine = (s, n = 100) => clip(String(s || "").trim().split("\n")[0], n);

/** The worker's standing instructions: the same bytes for the whole task. */
export function workerInstructions({ task, where, root }) {
  const place = where === "host" ? `the user's Mac, in the folder ${root}` : `a sandbox Linux machine of your own, in ${root}`;
  return [
    `You are working on a computer -- ${place} -- to do one task for the user, then report back.`,
    `The task: ${task}`,
    "How to work:",
    `- Plan briefly, then act, and check that what you did worked. Keep notes in ${root}/${NOTES}: the plan, what's done, what you learned. Update them as you go; they are what you'll have if your earlier steps are folded away.`,
    "- The shell for commands and code, read/write/edit for files, the browser for the web. Prefer edit to writing a file again.",
    "- Answers are cut to fit. When one says the rest is in a file, grep or read that file instead of asking for everything again.",
    where === "host" ? "- Commands, and changes outside that folder, wait for the user's yes. If one is declined, find another way or say what you needed." : "",
    "When the task is done -- or you can't go on -- reply without a tool call: what you did, what changed (files, pages), the result, and anything you need from the user. Keep it short.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** One line for a call, as the reader and the checkpoint see it. */
export function callLine(call) {
  const a = call.args || {};
  if (call.name === "shell") return `shell: ${firstLine(a.script)}`;
  if (call.name === "browser") return `browser: ${String(a.steps || "").trim().split("\n").map((l) => l.trim()).join(" · ").slice(0, 120)}`;
  if (call.name === "edit") return `edit ${a.path}`;
  if (call.name === "write") return `${a.append ? "add to" : "write"} ${a.path}`;
  if (call.name === "read") return `read ${a.path}${a.from ? ` from ${a.from}` : ""}`;
  return call.name;
}

/* Every call with its result, in order. */
function stepsOf(messages) {
  const results = new Map(messages.filter((m) => m.role === "tool").map((m) => [m.callId, m]));
  const out = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.calls || []) {
      const r = results.get(c.id);
      out.push({ line: callLine(c), name: c.name, result: r ? clip(r.content, 4000) : "", error: Boolean(r?.error), declined: Boolean(r?.declined) });
    }
  }
  return out;
}

async function notesOf(client, root, limit) {
  try {
    const text = await client.call("shell", { script: `cat ${JSON.stringify(`${root}/${NOTES}`)} 2>/dev/null`, _limit: limit });
    return text.split("\n").slice(1).join("\n").replace(/^\(no output\)$/, "").trim();
  } catch {
    return "";
  }
}

/* The fresh start at a checkpoint. */
async function checkpoint({ task, history, client, root, budget }) {
  const notes = await notesOf(client, root, budget.observationChars);
  const steps = stepsOf(history);
  const lines = steps.map((s) => `- ${s.line} → ${s.declined ? "not allowed" : s.error ? "failed: " : ""}${firstLine(s.result, 90)}`);
  const recent = history.filter((m) => m.role === "tool").slice(-2);
  const half = Math.floor(budget.observationChars / 2);
  return [
    {
      role: "user",
      content: [
        `The task: ${task}`,
        notes ? `Your notes (${NOTES}):\n${clip(notes, budget.observationChars)}` : `(You have no notes yet in ${NOTES}.)`,
        `What you have done so far, a line each:\n${lines.slice(-40).join("\n")}${lines.length > 40 ? `\n(and ${lines.length - 40} steps before those)` : ""}`,
        recent.length ? `The last results in full:\n${recent.map((r) => `[${r.name}]\n${clip(r.content, half)}`).join("\n\n")}` : "",
        "Carry on from here.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

/** Do `task` on the computer. Resolves to { text, detail }: the report for
 *  the chat's model, and the steps for the reader. `watch` hears each step
 *  as it starts and ends -- { kind: "start", id, line } and { kind: "end",
 *  id, result, error, declined } -- so the reader can follow along. */
export async function runWorker({ task, agent, provider, model, profile, client, where, root, signal, approve = null, progress = null, watch = null, resume = false }) {
  const budget = budgetFor(provider, profile);
  if (!budget.enough) {
    return { text: `The computer needs a model that can take at least 6k tokens; ${model} has ${budget.window}. Use another model for this agent, or give this one a bigger context.`, detail: null };
  }
  const tools = computerTools({ client, where, limit: budget.observationChars });
  const worker = { name: agent.name, tools: null, instructions: workerInstructions({ task, where, root }) };
  const started = Date.now();
  const notes = resume ? await notesOf(client, root, budget.observationChars) : "";
  let history = [{ role: "user", content: notes ? `You worked on this before. Your notes:\n${notes}\n\nCarry on with the task.` : "Start." }];
  const log = [];
  let rounds = 0;
  let checkpoints = 0;
  let report = null;

  while (rounds < MAX_STEPS) {
    const said = [];
    await runTurn({
      agent: worker,
      provider,
      model,
      profile,
      history,
      signal,
      available: tools,
      approve,
      maxRounds: Math.min(SLICE, MAX_STEPS - rounds),
      notebook: {},
      emit: (e) => {
        if (e.type !== "message") return;
        const m = e.message;
        said.push(m);
        if (m.role === "assistant" && m.calls?.length) {
          progress?.(`On the computer: ${callLine(m.calls[0])}`);
          for (const c of m.calls) watch?.({ kind: "start", id: c.id, line: callLine(c) });
        } else if (m.role === "tool") {
          watch?.({ kind: "end", id: m.callId, result: clip(m.content, 2000), error: Boolean(m.error), declined: Boolean(m.declined) });
        }
      },
    });
    // The slice's end isn't part of the work.
    const kept = said.filter((m) => !(m.role === "assistant" && !m.calls?.length && !m.content && /^Stopped after/.test(m.note || "")));
    log.push(...kept);
    rounds += kept.filter((m) => m.role === "assistant").length || 1;
    const last = kept.at(-1);
    if (last?.role === "assistant" && !last.calls?.length) {
      report = last.content?.trim() || last.note || "";
      break;
    }
    history = [...history, ...kept];
    if (sizeOf(history) > budget.checkpoint) {
      progress?.("On the computer: folding up its earlier steps…");
      history = await checkpoint({ task, history, client, root, budget });
      checkpoints += 1;
    }
  }
  const steps = stepsOf(log);
  if (!report) {
    report = `Stopped after ${MAX_STEPS} steps without finishing. The last: ${steps.slice(-3).map((s) => s.line).join("; ")}. Notes are in ${root}/${NOTES}; continue to carry on.`;
  }
  return { text: report, detail: { kind: "computer", where, root, steps, rounds, checkpoints, ms: Date.now() - started } };
}
