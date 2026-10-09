# Every provider's models on the computer

Companion to `docs/computer.md`. This is **phase 0**: before any computer
tool is built, make sure every model server in `src/lib/catalog.js` can
drive it, and that the app knows, for each model, *how* it can.

**Built** (problems below by number): the profile and window discovery for
Ollama, llama.cpp, LM Studio, vLLM, OpenRouter, Groq, Together, Mistral and
Anthropic, with `num_ctx` sent to Ollama and compaction kept inside the
loaded window (3); refusals classified and learned from -- tools, schemas,
null content, ids -- with prompted mode in place of talk-only (1, 2, 5, 6);
`<think>` kept apart (7); the wider `callsInText`, and cut-off calls named
(8, 9); pictures in tool results for all three wires (4); waiting out
429/503 (10); the probe and Models → Computer access. In `src/lib/profile.js`,
`prompted.js`, `probe.js`, `providers.js`, `run.js`, `heal.js`, `http.js`;
tests in `test/dialects.test.mjs` and `test/probe.test.mjs`.

**Still to do:** the live run of the probe against real servers (§7, by hand,
on a machine running them -- the "verify" cells in §5 stay until then), the
vision step of the probe (with `look`, phase 3), and fresh-conversation
checkpoints (11), which belong to the worker in phase 1.

---

## What "access" means here

No provider ever connects to the VM or to this Mac. The app is the only thing
that talks to the computer (MCP over stdio, `docs/computer.md` §2), and it
relays: model asks for a tool → app runs it → app sends the result back in that
provider's wire format. So reaching the sandbox and reaching the host are the
same path for every provider, local or hosted, and no port is ever opened.

That leaves four things a model needs, and they differ per provider:

1. **Call tools** -- natively, or by writing calls in its text.
2. **Read tool results** -- some chat templates silently drop `tool` messages.
3. **Fit the loop** -- a real context window big enough for the worker
   (minimum 6k tokens; §6 of the proposal), and output room for a `write`.
4. **Last 30 steps** -- no rate limit or truncation that kills a task halfway.

Every model ends up in one of three states, shown on the Models screen and in
the chat's computer toggle:

| State | Meaning |
|---|---|
| **Native** | The server's own tool calls work, round trip checked |
| **Prompted** | Tools are described in the prompt and calls parsed from text |
| **Can't** | And why: window too small, can't follow either protocol, … |

---

## 1. What stands in the way today

Found reading `providers.js`, `run.js`, `heal.js`:

| # | Problem | Where | Effect on the computer |
|---|---|---|---|
| 1 | A model that refuses tools is re-asked **without** them and becomes talk-only | `ollama.turn`, `openai.turn` | The model is never told the tools exist, so `callsInText` can never fire. Every such model loses the computer. |
| 2 | OpenAI-compatible: any 4xx whose message contains "tool" counts as "won't take tools" | `openai.turn` | A schema complaint (Gemini), a vLLM started without `--enable-auto-tool-choice`, or a bad id (Mistral) all silently become talk-only. |
| 3 | No context window is known or set; Ollama gets no `num_ctx` | `ollama.turn` | Ollama's small default truncates the front of the prompt -- the system prompt and task go first. |
| 4 | Tool results are text only (`asText`) | all three `to*` functions | `look` can't return an image to a vision worker. |
| 5 | Ids made by the app (`call_…`) go to every provider | `run.js` `newId` | Mistral accepts only 9 alphanumeric characters (to confirm in the probe); a chat moved from Ollama to Mistral would fail. |
| 6 | Assistant turn with calls sends `content: null` | `toOpenAI` | Some OpenAI-compatible servers want `""` (to confirm per server). |
| 7 | `<think>…</think>` in content is kept, re-sent and parsed | `openai.turn`, `callsInText` | Wastes context every round; a call *considered* in thinking can be run. |
| 8 | Calls in text are found only as `<tool_call>` or fenced JSON | `heal.js` `callsInText` | Misses Mistral `[TOOL_CALLS]`, Llama `<\|python_tag\|>` / bare `{"name":…,"parameters":…}`, `<function=…>`. |
| 9 | Ollama never reports a cut-off answer (`stop: "end"` always) | `ollama.turn` | A `write` cut off by the output limit arrives as broken JSON with no hint why. |
| 10 | No retry on 429 / `retry-after` | `http.js` | Groq, Cerebras and other free tiers will stop a 30-step task midway. |
| 11 | Checkpoints would rewrite history | (proposal §6) | Claude's thinking blocks are bound to unedited history; an edited history can 400. |

---

## 2. The capability profile

One record per server + model, kept in the store next to providers:

```js
models: {
  "ollama|qwen3:14b": {
    tools: "native" | "prompted" | "none",
    window: 32768,           // tokens actually usable
    windowFrom: "server" | "probe" | "reader",
    output: 8192,            // room for one reply, for `write` budgets
    vision: false,
    ids: "any" | "alnum9",   // tool call id style the server accepts
    nullContent: true,       // assistant content null allowed with calls
    stopSeqs: true,          // honours `stop` (prompted mode uses it)
    probedAt: 1760000000000,
    note: "",                // why, when tools is "none"
  },
}
```

Filled in this order, each later source overriding the one before:

1. **What the server says** (§5 lists where each one says it).
2. **The probe** (§3).
3. **The reader** -- Models screen, per model: tools mode, window, vision.

`lib/run.js` and the worker read the profile instead of guessing from errors.
The fallback in problem 1 becomes: *switch to prompted mode and say so*, never
talk-only while the computer is on.

---

## 3. The probe -- "Test computer access"

A button per model on the Models screen; also run automatically the first time
the computer is turned on for a chat whose model has no profile (or whose
server version changed). Four small requests, about 1.5k tokens in all, a few
seconds on a local model.

| Step | Sends | Passes when |
|---|---|---|
| 1. Window | (no request) server's reported length | known, or asked of the reader with a default of 8k |
| 2. Call | one tool `probe_echo(word)`; "call probe_echo with the word *amber*" | a call to `probe_echo` with `amber` arrives -- after `heal.js` repairs, which are recorded |
| 3. Result | the tool result: `the code is 4817`; "say the code" | the reply contains `4817` -- proves the template renders tool messages |
| 4. Chain | "call probe_echo again with the code" | a second call with `4817` -- proves it can act on a result |

- Step 2 fails natively (error, or no call) → repeat 2-4 in **prompted** mode.
- Both fail → **Can't**, with what failed shown.
- Window under 6k → **Can't** ("raise the context to at least 6k in Ollama /
  your server, or pick another model"), whatever the rest says.
- Vision models chosen for `look` get one more step: a generated 64×64 image
  of a digit, "what digit is this?".

The words and codes are random each run so a model can't pass from memory.

---

## 4. Prompted mode

For every model whose server can't carry tool calls: GPT4All, KoboldCpp,
text-generation-webui, llama.cpp without `--jinja`, vLLM/SGLang without a
tool parser, Ollama models whose template has no tools, and any model that
fails the native probe.

- **Tools in the system prompt**, compact and byte-stable for the whole task:
  ```
  Tools. To use one, reply with only:
  <tool_call>{"name": "shell", "arguments": {"script": "ls"}}</tool_call>
  shell(script) -- run a bash script; returns exit code and output
  read(path, from?, lines?) -- numbered lines of a file
  …
  ```
  About 250 tokens for the five tools -- less than their JSON schemas.
- **One call per reply**, and `</tool_call>` sent as a **stop sequence**
  (`stop` on OpenAI-compatible, `options.stop` on Ollama) so the model can't
  go on to invent the result. Where the server ignores `stop`, anything after
  the first call is cut off before parsing.
- **Results go back as user messages**, `<tool_result name="shell">…
  </tool_result>`, since a server without tool support may not render a
  `tool` role at all.
- Parsed by `callsInText`, extended (problem 8), then repaired by `fitArgs`
  as today. The browser's one-string `steps` argument (`docs/computer.md` §4)
  is what makes this mode workable: there is almost nothing to get wrong.

The same history can switch modes: the worker keeps calls in the app's own
message shape, and each adapter renders them natively or as text.

---

## 5. Per provider

Wire: **O** Ollama, **C** OpenAI-compatible, **A** Anthropic. "Verify" means
the probe and the fixture tests (§7) decide; the plan does not assume it.

### On this computer

| Server | Wire | Window from | Vision from | To handle |
|---|---|---|---|---|
| Ollama | O | `/api/show` model info `…context_length`; send `options.num_ctx` (capped by a reader setting -- the KV cache costs RAM) | `/api/show` capabilities `vision` | `tools` capability absent → prompted; map `done_reason: "length"` |
| LM Studio | C | its `/api/v0/models` (`max_context_length`, loaded length) -- verify | same list, `type: "vlm"` -- verify | tool support depends on model; probe |
| llama.cpp server | C | `/props` → `n_ctx` | `/props` modalities -- verify | without `--jinja` tools are ignored → prompted, and the Models screen says to add it |
| llamafile, LocalAI, MLX LM (port 8080) | C | `/props` where present, else reader | reader | expect prompted for MLX LM; probe the others |
| Unsloth | C | reader | reader | needs its own key (already handled); probe |
| Jan | C | reader | reader | llama.cpp underneath; probe |
| vLLM | C | `/v1/models` → `max_model_len` | reader | 400 "auto tool choice requires…" means started without a parser → prompted, with the flags shown (the catalog note already has them) |
| SGLang | C | reader (verify `/get_model_info`) | reader | same as vLLM: no `--tool-call-parser` → prompted |
| KoboldCpp | C | reader | reader | expect prompted |
| text-generation-webui / TabbyAPI | C | reader | reader | expect prompted (TabbyAPI may do native -- probe) |
| GPT4All | C | reader | -- | expect prompted; its default window is small, likely **Can't** until raised |

### Hosted, open models

All OpenAI-compatible. Native tools depend on the model, so the probe runs per
model, not per host.

| Host | Window from | Vision from | To handle |
|---|---|---|---|
| OpenRouter | `/models` → `context_length` | `/models` → `architecture.input_modalities` | `/models` also lists `supported_parameters`; no `tools` there → prompted without a failed request first |
| Groq | `/models` → `context_window` | reader | low per-minute token limits on free keys → 429 backoff (problem 10), and the worker waits rather than fails |
| Together | `/models` → `context_length` | reader | probe |
| Mistral | `/models` → `max_context_length` | `/models` capabilities -- verify | ids: 9 alphanumeric (problem 5); `capabilities.function_calling` false → prompted |
| DeepSeek | reader (model table) | -- | `reasoning_content` is never sent back (already true); keep it that way in the worker |
| Fireworks, DeepInfra, Cerebras, SambaNova, Nebius, Hyperbolic, Novita, Hugging Face router | reader, or `/models` where it says (verify each) | reader | probe; Cerebras and others have per-minute limits like Groq; schema strictness → §6 |

### Hosted, closed

| Host | Wire | Window from | To handle |
|---|---|---|---|
| OpenAI | C | reader (model table; `/models` doesn't say) | tool messages are text only → an image result goes as a user message straight after the tool results |
| Google Gemini | C | reader (the compatibility `/models` may not say) | stricter schemas (§6); calls may come without ids → app ids (already) |
| xAI | C | reader | probe |
| Anthropic | A | Models API `max_input_tokens`; `capabilities` for vision | images go inside `tool_result` natively; checkpoints start a **new** conversation (problem 11); add a cache breakpoint on the worker's stable prefix |

---

## 6. Changes, by file

**`src/lib/providers.js`**
- Ollama: `options.num_ctx` from the profile; `done_reason` → `stop`;
  `options.stop` in prompted mode; no talk-only fallback while the computer
  is on.
- OpenAI-compatible: split "won't take tools" from "rejected this schema" and
  "bad request"; schema errors retry once with the plain subset, then report;
  `stop` in prompted mode; strip `<think>…</think>` from content (shown in the
  step log, never re-sent); `null` vs `""` content per profile; ids rewritten
  per profile (`alnum9`: a stable 9-character hash of the app's id, so the
  same call keeps the same id on every request -- the prompt cache depends on
  it).
- All three: a tool message may carry an image. Anthropic puts it in the
  `tool_result`; OpenAI-compatible and Ollama send the text result, then one
  user message with the image(s).
- A `render` step for prompted mode: tools into the system prompt, calls as
  `<tool_call>` text, results as user messages.

**`src/lib/heal.js`** -- `callsInText` learns `[TOOL_CALLS][…]`,
`<|python_tag|>…`, a reply that is only `{"name":…,"parameters":…}`,
`<function=name>{…}</function>`; ignores anything inside `<think>`. Each
format gets a fixture.

**`src/lib/models.js`** (new) -- the profile: read what the server says,
run the probe, keep the result, expose `profileFor(provider, model)`.

**`src/lib/http.js`** -- 429 and 503 with `retry-after`: wait and retry (up
to 3 times, at most 60 s), with the wait shown in the step log.

**Computer tool schemas** -- the plain subset every provider accepts: an
object of `string` and `integer` properties, `description`s, `required`. No
`enum`, `default`, `format`, nested objects, arrays, `oneOf`/`anyOf`,
`additionalProperties`. A test fails if one creeps in. `write` gets an
`append` flag so a model with little output room writes a long file in parts;
a cut-off `write` is answered with "your call was cut off at the output limit
-- write it in parts with append".

**Worker checkpoints** -- always a fresh conversation (task, notes file, last
two observations), never an edit of the old one. Same cache cost as an edit,
and it can't trip any provider's history checks.

**Models screen** -- per model: the state badge (Native / Prompted / Can't
and why), window and where it came from, *Test computer access*, and the
reader's overrides.

---

## 7. Tests

**Fixtures, no network (`npm test`)** -- one fake server per dialect, each
driving the *same* scripted worker task against a fake computer ("write
`hi.txt`, read it back, report"):

- Ollama: native calls; "does not support tools" → prompted; `done_reason:
  length` in the middle of a `write`.
- OpenAI-compatible, streamed calls: with `index`, without `index`, whole call
  in one chunk, several calls in one reply, `finish_reason: length` mid-call.
- OpenAI-compatible, calls in text: `<tool_call>`, `[TOOL_CALLS]`,
  `<|python_tag|>`, bare JSON, `<function=…>`, a call inside `<think>` (must
  not run).
- OpenAI-compatible errors: vLLM's no-parser 400, a schema 400, a Mistral-style
  id 400, 429 with `retry-after`.
- A template that drops `tool` messages (the fake answers as if it never saw
  the result) → the probe's step 3 fails → prompted.
- Anthropic (the SDK against a fake): native calls, an image result inside
  `tool_result`, a checkpoint starting a new conversation.
- The probe itself, on each fake, ends in the state expected.

**Live, by hand (`npm run probe`)** -- runs the probe against every provider
and model the developer has set up, prints the table of states. Run before
each release; its output is how the "verify" cells in §5 get settled and
replaced with facts.

---

## 8. Order, and when phase 0 is done

1. Profile + window discovery + `num_ctx` (problems 3, 9) -- helps every chat
   today, computer or not.
2. Error classification and no talk-only fallback (1, 2); ids and null
   content (5, 6); `<think>` stripping (7).
3. Prompted mode and the wider `callsInText` (8).
4. Image tool results (4); 429 backoff (10); fresh-conversation checkpoints
   (11).
5. The probe and the Models screen badge.
6. Fixture suite green; live probe run across the providers available.

Done when: the fixture suite passes for every dialect; the live probe has been
run against Ollama, LM Studio, llama.cpp, vLLM and at least three hosted
OpenAI-compatible hosts; and every model either reaches the computer
(Native or Prompted) or says on the Models screen exactly why it can't.

The computer toggle (`docs/computer.md` §9) is enabled only for a chat whose
model is Native or Prompted.
