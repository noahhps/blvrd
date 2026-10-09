/* "Test computer access": whether a model can really use tools, and how --
 * see docs/computer-providers.md §3.
 *
 * Two short turns with one made-up tool and words picked at random, so a
 * model can't pass from memory:
 *
 *   call    asked to call probe_echo with a word, it does (repairs allowed)
 *   result  asked what the tool said, it says the code it gave back -- a chat
 *           template that drops tool messages fails here
 *   chain   asked to call it again with that code, it does
 *
 * Tried the server's own way first, then with the tools in the prompt
 * (lib/prompted.js). What passes is kept on the model's profile
 * (lib/profile.js): "native", "prompted", or "none" with what went wrong. A
 * model whose window is too small for the computer's work fails whatever it
 * does. */

import { discover, getProfile, setProbe, usableWindow } from "./profile.js";
import { ADAPTERS } from "./providers.js";
import { runTurn } from "./run.js";

export const MIN_WINDOW = 6144;
const WORDS = ["amber", "cobalt", "juniper", "saffron", "tundra", "marble", "lantern", "orchid", "pewter", "quartz"];
const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
const code = () => String(1000 + Math.floor(Math.random() * 9000));

const TURN_MS = 90_000;

async function tryMode(provider, model, profile, mode, signal) {
  const word = pick();
  const secret = code();
  const heard = [];
  const echo = {
    name: "probe_echo",
    label: "Probe",
    description: "Echo a word back, with a code. Use it when asked to.",
    parameters: { type: "object", properties: { word: { type: "string", description: "The word to echo." } }, required: ["word"] },
    run: ({ word: w }) => {
      heard.push(String(w || ""));
      return heard.length === 1 ? `Echo: ${w}. The code is ${secret}.` : `Echo: ${w}.`;
    },
  };
  const said = [];
  let switched = false;
  const turn = async (history) => {
    const before = said.length;
    const timeout = AbortSignal.timeout(TURN_MS);
    await runTurn({
      agent: { name: "Probe", tools: null, instructions: "This is a short test of your tools. Do exactly what each message asks." },
      provider,
      model,
      history,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      available: [echo],
      notebook: {},
      profile: { ...profile, tools: mode === "native" ? "native" : "prompted" },
      maxRounds: 3,
      emit: (e) => {
        if (e.type !== "message") return;
        said.push(e.message);
        if (/described in its instructions/.test(e.message.note || "")) switched = true;
      },
    });
    return said.slice(before);
  };

  const steps = [];
  const step = (name, ok, detail) => {
    steps.push({ mode, step: name, ok, detail });
    return ok;
  };
  const ask1 = { role: "user", content: `Call the probe_echo tool with the word "${word}". Then tell me the code it gives back.` };
  let first;
  try {
    first = await turn([ask1]);
  } catch (problem) {
    step("call", false, problem.message || String(problem));
    return { ok: false, steps };
  }
  if (mode === "native" && switched) {
    step("call", false, "The server turned the tools down.");
    return { ok: false, steps };
  }
  if (!step("call", heard[0]?.toLowerCase().includes(word), heard.length ? `It sent "${heard[0]}".` : "It didn't call the tool.")) return { ok: false, steps };
  const reply = first.filter((m) => m.role === "assistant").map((m) => m.content || "").join(" ");
  if (!step("result", reply.includes(secret), reply.includes(secret) ? "" : "It called the tool but didn't say what it returned: its chat template may not show it tool results.")) {
    return { ok: false, steps };
  }
  try {
    await turn([ask1, ...first, { role: "user", content: "Now call probe_echo again, with that code as the word." }]);
  } catch (problem) {
    step("chain", false, problem.message || String(problem));
    return { ok: false, steps };
  }
  step("chain", heard[1]?.includes(secret), heard[1] ? `It sent "${heard[1]}".` : "It didn't call the tool again.");
  return { ok: steps.every((s) => s.ok), steps };
}

/** Test a model and keep what was found on its profile. Resolves to the
 *  profile as it now stands. */
export async function probe(provider, model, { signal = null, adapters = ADAPTERS } = {}) {
  const profile = await discover(provider, model, { adapters });
  const room = usableWindow(provider, profile);
  if (room && room < MIN_WINDOW) {
    setProbe(provider, model, {
      tools: "none",
      note: `Its context is ${room} tokens; the computer needs at least ${MIN_WINDOW}. Give it more (for Ollama, a bigger num_ctx) or use another model.`,
      steps: [],
    });
    return getProfile(provider, model);
  }
  const steps = [];
  const modes = profile.tools === "prompted" && profile.toolsFrom !== "probe" ? ["prompted"] : ["native", "prompted"];
  for (const mode of modes) {
    const found = await tryMode(provider, model, getProfile(provider, model), mode, signal);
    steps.push(...found.steps);
    if (found.ok) {
      setProbe(provider, model, { tools: mode, note: mode === "prompted" ? "Uses tools written into its instructions." : "Uses tools the server's own way.", steps });
      return getProfile(provider, model);
    }
    if (signal?.aborted) break;
  }
  const failed = steps.filter((s) => !s.ok).at(-1);
  setProbe(provider, model, { tools: "none", note: failed?.detail || "It couldn't use a tool either way.", steps });
  return getProfile(provider, model);
}
