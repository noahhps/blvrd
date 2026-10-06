/* Reading a streamed response body: newline-delimited JSON (Ollama) and
 * server-sent events (OpenAI-compatible servers).
 *
 * The splitting is separate from the reading so the tests can feed it chunks
 * that break mid-line, mid-character and mid-event, which is what a real
 * network does. */

/** Split a buffer into complete lines and the unfinished remainder. */
export function splitLines(buffer) {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop();
  return { lines: parts, rest };
}

/** The decoded text of a body, chunk by chunk. */
export async function* chunks(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock?.();
  }
}

/** Complete lines from a sequence of text chunks. */
export async function* linesOf(texts) {
  let buffer = "";
  for await (const text of texts) {
    buffer += text;
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) yield line;
  }
  if (buffer) yield buffer;
}

/** NDJSON objects: one per non-empty line. */
export async function* ndjson(texts) {
  for await (const line of linesOf(texts)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

/** Server-sent events as `{ event, data }`, `data` being the joined data lines. */
export async function* sse(texts) {
  let event = "message";
  let data = [];
  for await (const line of linesOf(texts)) {
    if (line === "") {
      if (data.length) yield { event, data: data.join("\n") };
      event = "message";
      data = [];
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length) yield { event, data: data.join("\n") };
}
