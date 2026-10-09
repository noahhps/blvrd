/* The three protocols, behind one shape.
 *
 *   listModels(provider)            -> [{ id }]
 *   turn({ provider, model, system, messages, tools, signal, onText, extra,
 *          profile, stop, onWait })
 *                                   (`extra`: request fields such as thinking;
 *                                   `profile`: what the model can do and what
 *                                   its server wants, lib/profile.js; `stop`:
 *                                   strings to end the reply at)
 *                                   -> { text, calls, parts?, raw, stop, note }
 *
 * `messages` are the app's own (lib/run.js):
 *   { role: "user", content, files: [{ name, kind: "image"|"text", dataUrl?, text? }] }
 *   { role: "assistant", content, calls: [{ id, name, args }], raw }
 *   { role: "tool", callId, name, content, error, files? }   (files: pictures
 *                                   a tool returned, e.g. a screenshot)
 * Each adapter translates them to its wire format and back, so a chat can move
 * from a local model to a hosted one and keep its history.
 *
 * A server that won't take something it was sent throws `Refused`, saying
 * what: its tools at all ("tools"), their schemas ("schema"), a reply with no
 * text ("content"), or the call ids ("ids"). lib/run.js learns from it
 * (lib/profile.js) and sends the turn again the way the server wants -- for
 * "tools", with the tools described in the prompt (lib/prompted.js) -- so a
 * model without tool calls still gets to use them.
 */

import Anthropic from "@anthropic-ai/sdk";

import { splitDataUrl, textWithFiles } from "./attach.js";
import { failure, fetchPatiently, httpFetch } from "./http.js";
import { ollamaContext } from "./profile.js";
import { chunks, ndjson, sse } from "./stream.js";

const trimBase = (base) => String(base || "").replace(/\/+$/, "");

const asText = (content) => (typeof content === "string" ? content : JSON.stringify(content));

/** A server turned down part of a request; `kind` says which part. */
export class Refused extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "tools" | "schema" | "content" | "ids"
  }
}

/* What a refusal is about, from the words servers use. */
export function refusalOf(message, { hadTools = false } = {}) {
  const m = String(message || "");
  if (hadTools && /does not support tools|tools? (are|is)? ?not supported|(tool|function).?(use|call(ing|s)?).{0,40}not (supported|enabled|available)|auto.?tool.?choice|tool.?choice.{0,40}(requires|not supported)|--enable-auto-tool-choice|tool-call-parser|no tools? (are )?allowed|tools.{0,20}unsupported/i.test(m)) return "tools";
  if (/tool.?call.?id|tool_call_id/i.test(m) && /(invalid|must|should|format|length|9|pattern|match)/i.test(m)) return "ids";
  if (/content/i.test(m) && /(null|none|must be a string|not be empty|is required|expected .*string)/i.test(m)) return "content";
  if (hadTools && /(schema|parameters|properties|additionalProperties|\$schema|enum|anyOf|oneOf|default|format).{0,80}(invalid|not (supported|allowed)|unknown|unexpected|unrecognized)|(invalid|unsupported|unknown).{0,80}(schema|parameters|properties|function declaration)/i.test(m)) return "schema";
  return null;
}

/* A tool's parameters with nothing but what every server reads: types,
 * names, descriptions, which are required -- for a server that turned the
 * full schema down. */
export function plainSchema(schema) {
  const props = schema?.properties || {};
  const plain = {};
  for (const [k, v] of Object.entries(props)) {
    let type = Array.isArray(v?.type) ? v.type.find((t) => t !== "null") : v?.type;
    if (!["string", "integer", "number", "boolean"].includes(type)) type = "string";
    plain[k] = { type, ...(v?.description ? { description: String(v.description).slice(0, 300) } : {}) };
  }
  const required = (schema?.required || []).filter((k) => k in plain);
  return { type: "object", properties: plain, required };
}

/* A call id as a server wants it. Mistral takes only nine letters and digits;
 * an id made by the app or another server is turned into nine, the same nine
 * every time, so the call and its result still match. */
const ALNUM = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function idFor(id, style = "any") {
  const s = String(id || "");
  if (style !== "alnum9" || /^[a-zA-Z0-9]{9}$/.test(s)) return s;
  let h = 2166136261;
  let out = "";
  for (let round = 0; out.length < 9; round++) {
    for (const ch of `${round}:${s}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    let n = h;
    for (let i = 0; i < 4 && out.length < 9; i++, n = Math.floor(n / 62)) out += ALNUM[n % 62];
  }
  return out;
}

/* The pictures among a tool's results (a screenshot), which every protocol
 * but Anthropic's can only take in a user message. */
const toolImages = (m) => (m.files || []).filter((f) => f.kind === "image" && f.dataUrl);
const PICTURES_NOTE = "(The pictures the tools above returned.)";

/* A user message's pictures, and its text with any text files folded in. */
const imagesOf = (m) => (m.files || []).filter((f) => f.kind === "image" && f.dataUrl);
const userText = (m) => textWithFiles(m.content, m.files);

/* -- Ollama ------------------------------------------------------------------ */

function toOllama(system, messages) {
  const out = system ? [{ role: "system", content: system }] : [];
  let pictures = [];
  const flushPictures = () => {
    if (pictures.length) out.push({ role: "user", content: PICTURES_NOTE, images: pictures });
    pictures = [];
  };
  for (const m of messages) {
    if (m.role !== "tool") flushPictures();
    if (m.role === "user") {
      const images = imagesOf(m).map((f) => splitDataUrl(f.dataUrl)[1]);
      out.push({ role: "user", content: userText(m), ...(images.length ? { images } : {}) });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || "",
        ...(m.calls?.length
          ? { tool_calls: m.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
          : {}),
      });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_name: m.name, content: asText(m.content) });
      pictures.push(...toolImages(m).map((f) => splitDataUrl(f.dataUrl)[1]));
    }
  }
  flushPictures();
  return out;
}

const ollama = {
  async listModels(provider) {
    const response = await httpFetch(`${trimBase(provider.base)}/api/tags`);
    if (!response.ok) throw await failure(response, provider.name);
    const data = await response.json();
    return (data.models || []).map((m) => ({ id: m.name || m.model, size: m.size }));
  },

  async turn({ provider, model, system, messages, tools, signal, onText, extra = {}, profile = null, stop = null, onWait = null }) {
    // The context the model is loaded with is said every time: Ollama's own
    // default is a few thousand tokens, and it drops the start of anything
    // longer -- the system prompt first.
    const options = {
      ...(profile ? { num_ctx: ollamaContext(profile) } : {}),
      ...(stop?.length ? { stop } : {}),
      ...(extra.options || {}),
    };
    const body = {
      model,
      stream: true,
      ...extra,
      ...(Object.keys(options).length ? { options } : {}),
      messages: toOllama(system, messages),
      ...(tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: profile?.plainSchemas ? plainSchema(t.parameters) : t.parameters } })) }
        : {}),
    };
    const response = await fetchPatiently(
      `${trimBase(provider.base)}/api/chat`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal },
      { onWait },
    );
    if (!response.ok) {
      const error = await failure(response, provider.name);
      const kind = refusalOf(error.message, { hadTools: tools.length > 0 });
      if (kind) throw new Refused(kind, error.message);
      throw error;
    }
    let text = "";
    let ended = "end";
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
      if (data.done && data.done_reason === "length") ended = "length";
    }
    return { text, calls, stop: ended };
  },
};

/* -- OpenAI-compatible --------------------------------------------------------- */

function toOpenAI(system, messages, { ids = "any", emptyContent = false } = {}) {
  const out = system ? [{ role: "system", content: system }] : [];
  let pictures = [];
  const flushPictures = () => {
    if (pictures.length) out.push({ role: "user", content: [{ type: "text", text: PICTURES_NOTE }, ...pictures.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }))] });
    pictures = [];
  };
  for (const m of messages) {
    if (m.role !== "tool") flushPictures();
    if (m.role === "user") {
      const images = imagesOf(m);
      out.push({
        role: "user",
        content: images.length
          ? [{ type: "text", text: userText(m) }, ...images.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }))]
          : userText(m),
      });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || (m.calls?.length && !emptyContent ? null : ""),
        ...(m.calls?.length
          ? {
              tool_calls: m.calls.map((c) => ({
                id: idFor(c.id, ids),
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: idFor(m.callId, ids), content: asText(m.content) });
      pictures.push(...toolImages(m));
    }
  }
  flushPictures();
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

  async turn({ provider, model, system, messages, tools, signal, onText, extra = {}, profile = null, stop = null, onWait = null }) {
    const body = {
      model,
      stream: true,
      ...extra,
      ...(stop?.length ? { stop } : {}),
      messages: toOpenAI(system, messages, { ids: profile?.ids, emptyContent: profile?.emptyContent }),
      ...(tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: profile?.plainSchemas ? plainSchema(t.parameters) : t.parameters } })) }
        : {}),
    };
    const response = await fetchPatiently(
      `${trimBase(provider.base)}/chat/completions`,
      { method: "POST", headers: headersFor(provider), body: JSON.stringify(body), signal },
      { onWait },
    );
    if (!response.ok) {
      const error = await failure(response, provider.name);
      const kind = response.status < 500 ? refusalOf(error.message, { hadTools: tools.length > 0 }) : null;
      if (kind) throw new Refused(kind, error.message);
      throw error;
    }
    let text = "";
    let ended = "end";
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
      if (choice.finish_reason === "length") ended = "length";
    }
    return { text, calls: [...pending.values()], stop: ended };
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
      const pictures = toolImages(m).map((f) => {
        const [media_type, data] = splitDataUrl(f.dataUrl);
        return { type: "image", source: { type: "base64", media_type, data } };
      });
      results.push({
        type: "tool_result",
        tool_use_id: m.callId,
        // A screenshot goes inside the result it belongs to.
        content: pictures.length ? [{ type: "text", text: asText(m.content) }, ...pictures] : asText(m.content),
        ...(m.error ? { is_error: true } : {}),
      });
      continue;
    }
    flush();
    if (m.role === "user") {
      const images = imagesOf(m);
      if (!images.length) out.push({ role: "user", content: userText(m) });
      else {
        // Pictures before the words, which is the order Claude reads best.
        const blocks = images.map((f) => {
          const [media_type, data] = splitDataUrl(f.dataUrl);
          return { type: "image", source: { type: "base64", media_type, data } };
        });
        const text = userText(m);
        out.push({ role: "user", content: text ? [...blocks, { type: "text", text }] : blocks });
      }
    } else if (m.role === "assistant") {
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

  /** What the Models API says of a model: its context, and that it sees. */
  async info(provider, model) {
    const m = await clientFor(provider).models.retrieve(model);
    return { window: m.max_input_tokens || null, vision: true, tools: "native" };
  },

  async turn({ provider, model, system, messages, tools, signal, onText, onCall, extra = {}, stop = null }) {
    const client = clientFor(provider);
    const params = {
      model,
      max_tokens: 64000,
      ...extra,
      ...(stop?.length ? { stop_sequences: stop } : {}),
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
    // A tool call starting between stretches of text, so it can be shown
    // where the model made it rather than after everything it wrote.
    if (onCall) {
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") onCall(event.content_block.name);
      });
    }
    const message = await stream.finalMessage();

    // The blocks in the order the model wrote them: text and calls interleaved.
    const parts = message.content.flatMap((b) =>
      b.type === "text" && b.text.trim() ? [{ type: "text", text: b.text }] : b.type === "tool_use" ? [{ type: "call", id: b.id }] : [],
    );
    const text = parts.filter((p) => p.type === "text").map((p) => p.text.trim()).join("\n\n");
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
    return { text, calls, parts, raw, stop: message.stop_reason === "max_tokens" ? "length" : "end" };
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
