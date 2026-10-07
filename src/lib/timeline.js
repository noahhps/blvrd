/* The chat as it reads: an answer that mixed text and tool calls (lib/run.js
   `parts`) is laid out in the order the model made them -- each call's step
   right after the text that led to it -- instead of all its text first. */
export function timeline(messages, running = false) {
  const results = new Map(messages.filter((m) => m.role === "tool" && m.callId).map((m) => [m.callId, m]));
  const placed = new Set();
  const lastAnswer = messages.findLastIndex((m) => m.role === "assistant");
  const out = [];
  messages.forEach((m, at) => {
    if (m.role === "tool" && placed.has(m.callId)) return;
    if (m.role !== "assistant" || m.failure || !m.parts?.length) {
      out.push({ key: m.id || `m${at}`, message: m });
      return;
    }
    const lastText = m.parts.findLastIndex((p) => p.type === "text");
    m.parts.forEach((part, i) => {
      if (part.type === "text") {
        out.push({ key: `${m.id}:${i}`, message: { ...m, content: part.text, note: i === lastText ? m.note : undefined } });
        return;
      }
      const result = results.get(part.id);
      if (result) {
        placed.add(part.id);
        out.push({ key: result.id || part.id, message: result });
      } else if (!(running && at === lastAnswer)) {
        // Still running is said once, under the turn (LiveTurn); a call left
        // without a result by a stop is said here, where it was made.
        const name = m.calls?.find((c) => c.id === part.id)?.name || "a tool";
        out.push({ key: `${m.id}:${i}`, message: { role: "tool", unfinished: true, name, agentId: m.agentId } });
      }
    });
    if (lastText === -1 && m.note) out.push({ key: `${m.id}:note`, message: { ...m, content: "" } });
  });
  return chained(out);
}

/* Calls made back to back -- no text between, by the same agent -- read as one
   chain, shown and opened as one step. A lone call stays as it is. */
function chained(entries) {
  const out = [];
  for (const entry of entries) {
    const prev = out[out.length - 1];
    const last = prev?.message.role === "chain" ? prev.message.steps.at(-1) : prev?.message;
    if (entry.message.role === "tool" && last?.role === "tool" && last.agentId === entry.message.agentId) {
      const steps = prev.message.role === "chain" ? prev.message.steps : [prev.message];
      out[out.length - 1] = { key: prev.key, message: { role: "chain", agentId: entry.message.agentId, steps: [...steps, entry.message] } };
    } else out.push(entry);
  }
  return out;
}
