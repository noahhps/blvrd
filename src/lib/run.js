/* One turn of an agent: the user's message in, the agent's answer out, with
 * as many rounds of tool calls in between as it needs.
 *
 * Each round asks the model, repairs whatever calls it made (lib/heal.js),
 * runs the ones that can run, and hands the results back. A round with no
 * calls is the answer. The loop is the app's own rather than any provider's,
 * which is what lets one agent run on Ollama today and on a hosted model
 * tomorrow with the same history.
 */

import { checkStopped, isStop, stoppedError, untilStopped } from "./abort.js";
import { callsInText, fitArgs, parseArgs, resolveName, usageOf } from "./heal.js";
import { adapterFor } from "./providers.js";
import { thinkingFields } from "./thinking.js";
import { memoryBrief } from "./agentMemory.js";
import { toolsFor } from "./tools.js";

export const MAX_ROUNDS = 8;

const newId = () => `call_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/** The system prompt: who the agent is, what it was told to be, its own
 *  memory (lib/agentMemory.js) -- the parts that stay the same from turn to
 *  turn first, so a model server can reuse its cache of them. */
export function systemFor(agent, tools, context = "", memory = "") {
  const parts = [
    `You are ${agent.name}, an assistant in blvrd, running for the user on their own computer.`,
    "Answer in Markdown when formatting helps. Be direct; say plainly when you are unsure.",
  ];
  if (tools.length) {
    parts.push(
      `You can use these tools: ${tools.map((t) => t.name).join(", ")}. Call a tool when it would make the answer more correct -- dates and times, arithmetic, anything you were asked to remember -- and not otherwise.`,
    );
  } else {
    parts.push("You have no tools in this conversation; answer from what you know and say when you cannot check something.");
  }
  if (agent.instructions?.trim()) parts.push(agent.instructions.trim());
  if (memory) parts.push(memoryBrief(memory));
  // Where the agent is answering, when that is more than a one-to-one chat --
  // a group (lib/group.js).
  if (context.trim()) parts.push(context.trim());
  return parts.join("\n\n");
}

/**
 * Run a turn. `history` already ends with the user's message. Calls `emit`
 * with { type: "text", delta } as words arrive, { type: "call", name } as a
 * tool call begins (when the provider says), and with { type: "message",
 * message } for every assistant or tool message as it is completed -- the
 * caller appends those to the chat. Resolves when the agent has answered.
 */
export async function runTurn({
  agent,
  provider,
  model,
  history,
  signal,
  emit,
  notebook,
  thinking = null,
  context = "",
  available,
  approve = null,
  note = "",
  memory = "",
}) {
  const adapter = adapterFor(provider);
  const tools = toolsFor(agent, available);
  const names = tools.map((t) => t.name);
  const system = systemFor(agent, tools, context, memory);
  const messages = withNote(history, note);
  const extra = thinkingFields(provider.kind, thinking?.control, thinking?.value);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    checkStopped(signal);
    const result = await adapter.turn({
      provider,
      model,
      system,
      messages,
      tools,
      signal,
      extra,
      onText: (delta) => emit({ type: "text", delta }),
      onCall: (name) => emit({ type: "call", name }),
    });

    let { text, calls } = result;
    // A call written into the reply as text is still a call -- small models do
    // this when their template has no tool format of its own.
    if (!calls.length && tools.length && provider.kind !== "anthropic") {
      const found = callsInText(text, names);
      if (found.calls.length) {
        calls = found.calls;
        text = found.text;
        emit({ type: "retext", text });
      }
    }

    const prepared = calls.map((call) => prepare(call, tools, names));
    const assistant = {
      role: "assistant",
      content: text,
      calls: prepared.map(({ id, name, args }) => ({ id, name, args })),
      // Text and calls in the order the model made them, when the provider
      // says (Anthropic); otherwise the text came first, then the calls.
      ...(result.parts && calls === result.calls ? { parts: orderOf(result.parts, prepared) } : {}),
      ...(result.raw ? { raw: result.raw } : {}),
      ...(result.note ? { note: result.note } : {}),
      ...(result.stop === "refusal" ? { note: "The model declined to answer this." } : {}),
      ...(result.stop === "length" && !calls.length ? { note: "The answer was cut off at the model's length limit." } : {}),
      model,
      provider: provider.id,
    };
    messages.push(assistant);
    emit({ type: "message", message: assistant });
    if (!prepared.length) return;

    for (const call of prepared) {
      checkStopped(signal);
      const message = { role: "tool", callId: call.id, name: call.name, content: "", error: false };
      if (call.problem) {
        message.content = call.problem;
        message.error = true;
      } else {
        try {
          const tool = tools.find((t) => t.name === call.name);
          // A tool that acts -- sends, adds, changes, switches -- waits for the
          // reader. No answer, or no way to ask, is a no.
          if (tool.confirm) {
            const yes = approve
              ? await untilStopped(approve({ tool, args: call.args, summary: tool.summary ? tool.summary(call.args) : `${tool.label || tool.name}` }), signal)
              : false;
            checkStopped(signal);
            if (!yes) {
              message.content = `The user declined: ${tool.label || tool.name} did not run. Don't try it again unless they ask; say what you would have done instead.`;
              message.declined = true;
              messages.push(message);
              emit({ type: "message", message });
              continue;
            }
          }
          // Not every tool listens for the signal (a connector's, an
          // AppleScript), so the turn stops waiting for it the moment the
          // reader stops -- whatever it was doing is left to finish unheard.
          // `callId` and `messages`: what the model can see, so the notebook
          // knows what an agent has already been told (lib/notebookSync.js).
          const output = await untilStopped(tool.run(call.args, { signal, ...notebook, callId: call.id, messages }), signal);
          message.content = call.notes.length
            ? `${output}\n\n(Your call was repaired: ${call.notes.join("; ")}. Spell it that way next time.)`
            : String(output);
        } catch (problem) {
          if (isStop(problem, signal)) throw signal?.aborted ? stoppedError() : problem;
          message.content = `${call.name} failed: ${problem.message || problem}`;
          message.error = true;
        }
      }
      messages.push(message);
      emit({ type: "message", message });
    }
  }

  const stopped = {
    role: "assistant",
    content: "",
    calls: [],
    note: `Stopped after ${MAX_ROUNDS} rounds of tool calls without an answer.`,
    model,
    provider: provider.id,
  };
  emit({ type: "message", message: stopped });
}

/* `note` added to the end of the user's last message, for this request only
 * -- what changes from turn to turn goes there rather than in the system
 * prompt, which a model server can then reuse its cache of. */
function withNote(history, note) {
  const messages = [...history];
  const last = messages[messages.length - 1];
  if (note && last?.role === "user") messages[messages.length - 1] = { ...last, content: [last.content, note].filter(Boolean).join("\n\n") };
  return messages;
}

/* The provider's parts with each call's id as run.js knows it. */
function orderOf(parts, prepared) {
  let i = 0;
  return parts.flatMap((p) => (p.type === "call" ? (prepared[i] ? [{ type: "call", id: prepared[i++].id }] : []) : [p]));
}

/* A call made ready to run: name resolved, arguments parsed and fitted to the
 * schema -- or a `problem` that goes back to the model instead of running. */
function prepare(call, tools, names) {
  const id = call.id || newId();
  const name = resolveName(call.name, names);
  if (!name) {
    return {
      id,
      name: String(call.name || "unknown"),
      args: {},
      notes: [],
      problem: `There is no tool called "${call.name}". The tools are: ${names.join(", ") || "none"}.`,
    };
  }
  const tool = tools.find((t) => t.name === name);
  const notes = name !== call.name ? [`"${call.name}" read as "${name}"`] : [];
  let parsed;
  try {
    parsed = typeof call.args === "string" ? JSON.parse(call.args || "{}") : call.args;
  } catch {
    try {
      parsed = parseArgs(call.args);
      notes.push("arguments were nearly JSON");
    } catch {
      return { id, name, args: {}, notes, problem: `The arguments for ${name} were not JSON. ${usageOf(tool)}` };
    }
  }
  const fitted = fitArgs(parsed, tool.parameters);
  if (fitted.error) return { id, name, args: parsed || {}, notes, problem: `${name}: ${fitted.error}. ${usageOf(tool)}` };
  return { id, name, args: fitted.args, notes: [...notes, ...fitted.notes] };
}
