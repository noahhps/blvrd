/* The three protocols, behind one shape.
 *
 *   listModels(provider)            -> [{ id }]
 *   turn({ provider, model, system, messages, tools, signal, onText })
 *                                   -> { text, calls, raw, stop, note }
 *
 * `messages` are the app's own (lib/run.js):
 *   { role: "user", content }
 *   { role: "assistant", content, calls: [{ id, name, args }], raw }
 *   { role: "tool", callId, name, content, error }
 * Each adapter translates them to its wire format and back, so a chat can move
 * from a local model to a hosted one and keep its history.
 *
 * A model that will not take tools at all is not an error: the turn is sent
 * again without them and `note` says so, because most small local models are
 * still useful to talk to.
 */

import Anthropic from "@anthropic-ai/sdk";

import { failure, httpFetch } from "./http.js";
import { chunks, ndjson, sse } from "./stream.js";

const trimBase = (base) => String(base || "").replace(/\/+$/, "");

const asText = (content) => (typeof content === "string" ? content : JSON.stringify(content));

/* -- Ollama ------------------------------------------------------------------ */

function toOllama(system, messages) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || "",
        ...(m.calls?.length
          ? { tool_calls: m.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
          : {}),
      });
    } else if (m.role === "tool") out.push({ role: "tool", tool_name: m.name, content: asText(m.content) });
  }
  return out;
}

const refusesTools = (message) => /does not support tools|tools? (are )?not supported|tool.?(use|calling).*not/i.test(message);

const ollama = {
  async listModels(provider) {
    const response = await httpFetch(`${trimBase(provider.base)}/api/tags`);
    if (!response.ok) throw await failure(response, provider.name);
    const data = await response.json();
    return (data.models || []).map((m) => ({ id: m.name || m.model, size: m.size }));
  },

  async turn({ provider, model, system, messages, tools, signal, onText }, withTools = true) {
    const body = {
      model,
      stream: true,
      messages: toOllama(system, messages),
      ...(withTools && tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
    };
    const response = await httpFetch(`${trimBase(provider.base)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const error = await failure(response, provider.name);
      if (withTools && tools.length && refusesTools(error.message)) {
        const result = await ollama.turn({ provider, model, system, messages, tools, signal, onText }, false);
        return { ...result, note: `${model} does not take tools, so this agent can only talk.` };
      }
      throw error;
    }
    let text = "";
    const calls = [];
    for await (const data of ndjson(chunks(response.body))) {
      if (data.error) throw new Error(`${provider.name}: ${data.error}`);
      const message = data.message || {};
      if (message.content) {
        text += message.content;
        onText(message.content);
      }
      for (const call of message.tool_calls || []) {
        calls.push({ name: call.function?.name, args: call.function?.arguments });
      }
    }
    return { text, calls, stop: "end" };
  },
};

/* -- OpenAI-compatible --------------------------------------------------------- */

function toOpenAI(system, messages) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || (m.calls?.length ? null : ""),
        ...(m.calls?.length
          ? {
              tool_calls: m.calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.callId, content: asText(m.content) });
  }
  return out;
}

const headersFor = (provider) => ({
  "Content-Type": "application/json",
  ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}),
  ...(provider.id === "openrouter" ? { "X-Title": "blvrd" } : {}),
});

const openai = {
  async listModels(provider) {
    const response = await httpFetch(`${trimBase(provider.base)}/models`, { headers: headersFor(provider) });
    if (!response.ok) throw await failure(response, provider.name);
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    return list.map((m) => ({ id: m.id || m.name })).filter((m) => m.id);
  },

  async turn({ provider, model, system, messages, tools, signal, onText }, withTools = true) {
    const body = {
      model,
      stream: true,
      messages: toOpenAI(system, messages),
      ...(withTools && tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
    };
    const response = await httpFetch(`${trimBase(provider.base)}/chat/completions`, {
      method: "POST",
      headers: headersFor(provider),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const error = await failure(response, provider.name);
      if (withTools && tools.length && response.status < 500 && /tool/i.test(error.message)) {
        const result = await openai.turn({ provider, model, system, messages, tools, signal, onText }, false);
        return { ...result, note: `${model} on ${provider.name} would not take tools, so this agent can only talk.` };
      }
      throw error;
    }
    let text = "";
    let stop = "end";
    const pending = new Map(); // index -> { id, name, args }
    for await (const { data } of sse(chunks(response.body))) {
      if (data === "[DONE]") break;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new Error(`${provider.name}: ${event.error.message || JSON.stringify(event.error)}`);
      const choice = event.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        text += delta.content;
        onText(delta.content);
      }
      for (const part of delta.tool_calls || []) {
        const index = part.index ?? pending.size;
        const call = pending.get(index) || { id: part.id, name: "", args: "" };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.args += part.function.arguments;
        pending.set(index, call);
      }
      if (choice.finish_reason === "length") stop = "length";
    }
    return { text, calls: [...pending.values()], stop };
  },
};

/* -- Anthropic ------------------------------------------------------------------ */

/* Claude through the official SDK, its HTTP sent through httpFetch like every
 * other request. `dangerouslyAllowBrowser` is what the SDK asks for before it
 * will run in a webview; the key stays on this machine either way. */
const clientFor = (provider) =>
  new Anthropic({
    apiKey: provider.key,
    baseURL: trimBase(provider.base) || undefined,
    dangerouslyAllowBrowser: true,
    fetch: httpFetch,
  });

/* The models that can hand a refused request to another model server-side,
 * rather than end the answer with nothing. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export const CLAUDE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-4-5",
  "claude-fable-5-1",
];

function toAnthropic(messages, model) {
  const out = [];
  let results = null;
  const flush = () => {
    if (results) out.push({ role: "user", content: results });
    results = null;
  };
  for (const m of messages) {
    if (m.role === "tool") {
      // Every result of one turn goes back in a single user message.
      results ||= [];
      results.push({
        type: "tool_result",
        tool_use_id: m.callId,
        content: asText(m.content),
        ...(m.error ? { is_error: true } : {}),
      });
      continue;
    }
    flush();
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      // Claude's own turn is sent back exactly as it came -- thinking blocks
      // included -- when the next turn goes to the same model. Anything else
      // is rebuilt from the text and the calls.
      if (m.raw?.provider === "anthropic" && m.raw.model === model) {
        out.push({ role: "assistant", content: m.raw.content });
        continue;
      }
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.calls || []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} });
      if (content.length) out.push({ role: "assistant", content });
    }
  }
  flush();
  return out;
}

const anthropic = {
  async listModels(provider) {
    const client = clientFor(provider);
    const ids = [];
    for await (const model of client.models.list()) ids.push({ id: model.id });
    return ids;
  },

  async turn({ provider, model, system, messages, tools, signal, onText }) {
    const client = clientFor(provider);
    const params = {
      model,
      max_tokens: 64000,
      ...(system ? { system } : {}),
      messages: toAnthropic(messages, model),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
              // Inputs stream as they are written; run.js validates each one
              // against the schema before the tool runs.
              eager_input_streaming: true,
            })),
          }
        : {}),
    };
    const stream = FALLBACK_MODELS.has(model)
      ? client.beta.messages.stream(
          { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
          { signal },
        )
      : client.messages.stream(params, { signal });
    stream.on("text", onText);
    const message = await stream.finalMessage();

    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const raw = { provider: "anthropic", model, content: message.content };
    if (message.stop_reason === "refusal") {
      return { text, calls: [], raw, stop: "refusal" };
    }
    const calls = message.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: b.input }));
    if (message.stop_reason === "max_tokens" && calls.length) {
      throw new Error("The answer ran out of room in the middle of a tool call. Ask again, or for less at once.");
    }
    return { text, calls, raw, stop: message.stop_reason === "max_tokens" ? "length" : "end" };
  },
};

export const ADAPTERS = { ollama, openai, anthropic };

export function adapterFor(provider) {
  const adapter = ADAPTERS[provider?.kind];
  if (!adapter) throw new Error(`No way to talk to a "${provider?.kind}" server.`);
  return adapter;
}

// Exported for the tests.
export const _wire = { toOllama, toOpenAI, toAnthropic };
