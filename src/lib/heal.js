/* Tool calls that mend themselves -- a small port of Bom's server/app/heal.py.
 *
 * Small local models often call the right tool slightly wrong: a prefixed or
 * misspelled name, an argument in the wrong case, a number sent as a string,
 * arguments wrapped in an extra object, JSON with a trailing comma, or the
 * whole call written into the reply as text. A call is repaired only where
 * there is one thing the model could have meant, and every repair is reported
 * back so the model can spell it right next time. A call that cannot be
 * repaired does not run; the model is told the tool's parameters instead.
 */

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function distance(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length];
}

/** The one name among `names` that `wanted` could mean, or null. */
export function resolveName(wanted, names) {
  if (names.includes(wanted)) return wanted;
  // "functions.read_page", "default_api:read_page", "tools/read_page"
  const bare = String(wanted || "").split(/[.:/]/).pop();
  if (names.includes(bare)) return bare;
  const key = norm(bare);
  const same = names.filter((name) => norm(name) === key);
  if (same.length === 1) return same[0];
  const close = names.filter((name) => distance(norm(name), key) <= 2);
  return close.length === 1 ? close[0] : null;
}

/** Arguments as an object, from whatever the model sent. Throws if hopeless. */
export function parseArgs(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    // nearly JSON: trailing commas, single quotes, bare keys
  }
  const mended = text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner));
  return JSON.parse(mended);
}

function coerce(value, type) {
  if (type === "number" || type === "integer") {
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return { value: Number(value), changed: true };
    }
  } else if (type === "boolean") {
    if (value === "true" || value === "false") return { value: value === "true", changed: true };
  } else if (type === "string") {
    if (typeof value === "number" || typeof value === "boolean") return { value: String(value), changed: true };
  }
  return { value, changed: false };
}

/**
 * Fit arguments to a tool's JSON schema.
 * Returns `{ args, notes }`, or `{ error }` when a required argument is missing.
 */
export function fitArgs(input, schema) {
  const notes = [];
  let args = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  const props = schema?.properties || {};
  const known = Object.keys(props);

  // {"arguments": {...}} / {"parameters": {...}} wrapped around the real ones
  for (const wrapper of ["arguments", "parameters", "args", "input"]) {
    const inner = args[wrapper];
    if (!known.includes(wrapper) && Object.keys(args).length === 1 && inner && typeof inner === "object") {
      args = { ...inner };
      notes.push(`arguments were wrapped in "${wrapper}"`);
    }
  }

  const fitted = {};
  for (const [key, value] of Object.entries(args)) {
    let name = key;
    if (!known.includes(key) && known.length) {
      const match = resolveName(key, known);
      if (match && !(match in args)) {
        name = match;
        notes.push(`"${key}" read as "${match}"`);
      } else {
        notes.push(`ignored unknown argument "${key}"`);
        continue;
      }
    }
    const { value: v, changed } = coerce(value, props[name]?.type);
    if (changed) notes.push(`"${name}" sent as ${typeof value}, read as ${props[name].type}`);
    fitted[name] = v;
  }

  const missing = (schema?.required || []).filter((key) => fitted[key] === undefined || fitted[key] === "");
  if (missing.length) return { error: `missing ${missing.map((m) => `"${m}"`).join(", ")}` };
  return { args: fitted, notes };
}

/* Calls written into the reply instead of made: <tool_call>{...}</tool_call>,
 * or a fenced JSON object with a name and arguments. Returns the calls and the
 * text with them taken out. Only names that resolve to a real tool count, so
 * an answer that merely shows some JSON is left alone. */
export function callsInText(text, names) {
  const calls = [];
  let rest = String(text || "");
  const take = (raw) => {
    let data;
    try {
      data = parseArgs(raw);
    } catch {
      return false;
    }
    const list = Array.isArray(data) ? data : [data];
    const found = [];
    for (const item of list) {
      const fn = item?.function || item;
      const name = fn && resolveName(fn.name, names);
      if (!name) return false;
      found.push({ name, args: fn.arguments ?? fn.parameters ?? {} });
    }
    calls.push(...found);
    return found.length > 0;
  };
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (all, inner) => (take(inner) ? "" : all));
  if (!calls.length) {
    rest = rest.replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g, (all, inner) => (take(inner) ? "" : all));
  }
  return { calls, text: calls.length ? rest.trim() : String(text || "") };
}

/** What a model is told when a call could not be repaired. */
export function usageOf(tool) {
  const props = tool.parameters?.properties || {};
  const required = new Set(tool.parameters?.required || []);
  const params = Object.entries(props)
    .map(([key, spec]) => `${key} (${spec.type}${required.has(key) ? ", required" : ""})`)
    .join(", ");
  return `${tool.name} takes: ${params || "no arguments"}.`;
}
