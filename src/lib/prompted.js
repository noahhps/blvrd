/* Tools for a model whose server can't carry tool calls -- GPT4All,
 * KoboldCpp, llama.cpp without --jinja, vLLM without a tool parser, an
 * Ollama model whose template has none -- or that fails to use them natively
 * (lib/probe.js). See docs/computer-providers.md §4.
 *
 * The tools are described at the end of the system prompt, one line each, in
 * the same words every time so a server can reuse its cache of them. The
 * model writes a call as <tool_call>{…}</tool_call>; the request stops at
 * the closing tag, so it can't go on to invent the result. Results come back
 * as a user message, since a server that can't make calls may not show a
 * `tool` message to the model at all.
 *
 * The chat keeps its calls and results in the app's own shape (lib/run.js);
 * this only changes how a request is written. So a chat can move between a
 * model that calls natively and one that doesn't. */

export const STOP = "</tool_call>";

const firstSentence = (text) => {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const cut = s.search(/(?<=[.!?])\s/);
  const one = cut === -1 ? s : s.slice(0, cut);
  return one.length > 180 ? `${one.slice(0, 179)}…` : one;
};

/** One line a tool: its name, its arguments (? when optional), what it does. */
export function toolLine(tool) {
  const props = tool.parameters?.properties || {};
  const required = new Set(tool.parameters?.required || []);
  const args = Object.keys(props).map((k) => (required.has(k) ? k : `${k}?`));
  return `${tool.name}(${args.join(", ")}) -- ${firstSentence(tool.description)}`;
}

/** The tools, and how to call one, for the end of the system prompt. */
export function toolsBlock(tools) {
  return [
    "To use a tool, reply with only the call, in this form, and wait for its result:",
    '<tool_call>{"name": "tool_name", "arguments": {"argument": "value"}}</tool_call>',
    "One call per reply. When you have what you need, answer normally, without a call.",
    "The tools:",
    ...tools.map((t) => `- ${toolLine(t)}`),
  ].join("\n");
}

const callText = (c) => `<tool_call>${JSON.stringify({ name: c.name, arguments: c.args ?? {} })}</tool_call>`;
const resultText = (m) => `<tool_result name="${m.name}">\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}\n</tool_result>`;

/** The chat as a prompted model is sent it: calls as text in the replies,
 *  results as user messages (pictures a tool returned go with them). */
export function asPrompted(messages) {
  const out = [];
  let results = null;
  // Two user messages in a row -- results, then the reader, after a turn that
  // was stopped -- become one: some templates insist turns alternate.
  const pushUser = (m) => {
    const last = out[out.length - 1];
    if (last?.role !== "user") return out.push(m);
    const files = [...(last.files || []), ...(m.files || [])];
    out[out.length - 1] = { ...last, content: [last.content, m.content].filter(Boolean).join("\n\n"), ...(files.length ? { files } : {}) };
  };
  const flush = () => {
    if (!results) return;
    pushUser({ role: "user", content: results.texts.join("\n\n"), ...(results.files.length ? { files: results.files } : {}) });
    results = null;
  };
  for (const m of messages) {
    if (m.role === "tool") {
      results ||= { texts: [], files: [] };
      results.texts.push(resultText(m));
      results.files.push(...(m.files || []));
      continue;
    }
    flush();
    if (m.role === "assistant" && m.calls?.length) {
      const { calls, raw, parts, ...rest } = m;
      out.push({ ...rest, content: [m.content, ...calls.map(callText)].filter(Boolean).join("\n") });
    } else if (m.role === "user") pushUser(m);
    else out.push(m);
  }
  flush();
  return out;
}
