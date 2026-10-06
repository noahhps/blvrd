# blvrd

Agents on your own models. A desktop app (Tauri + React) where each agent is a
model with a job: its own instructions, the abilities it may use, and one
ongoing chat with you. Built for models you run yourself, with hosted ones as
an option.

Agents started in [Bom](../Bom); this is them on their own, with no server to
run -- the app talks to model servers directly.

## Run it

```bash
npm install
npm run tauri:dev
```

`npm run tauri:build` makes the `.app` and `.dmg`. `npm run dev` runs the
interface alone in a browser at http://localhost:5180 (enough for Ollama, which
allows browser requests; other local servers need the desktop app -- see
below).

Then open **Models**, press **Find local servers**, and pick a default model.

## Where models come from

**On this computer** -- found automatically by their usual ports:

| Server | Address |
|---|---|
| Ollama (default) | `http://127.0.0.1:11434` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama.cpp server (also llamafile, LocalAI, MLX LM) | `http://127.0.0.1:8080/v1` |
| Jan | `http://127.0.0.1:1337/v1` |
| vLLM | `http://127.0.0.1:8000/v1` |
| SGLang | `http://127.0.0.1:30000/v1` |
| KoboldCpp | `http://127.0.0.1:5001/v1` |
| text-generation-webui / TabbyAPI | `http://127.0.0.1:5000/v1` |
| GPT4All | `http://127.0.0.1:4891/v1` |

Any address can be changed, and a server on another machine on your network
counts as local.

**Hosted open models** (your key): Hugging Face, Together AI, Groq, Fireworks,
DeepInfra, Cerebras, SambaNova, Nebius AI Studio, Hyperbolic, Novita,
OpenRouter, Mistral, DeepSeek.

**Closed APIs** (your key): Anthropic, OpenAI, Google Gemini, xAI.

**Anything else** that speaks the OpenAI-compatible chat API, by URL.

A hosted server is sent every message you write to an agent that uses it; the
app labels it wherever it is chosen. Claude goes through the official
`@anthropic-ai/sdk`; on the models that support it, a refused request is
handed to another model server-side (`fallbacks: "default"`) rather than
ending with nothing.

## What an agent can do

| Ability | |
|---|---|
| Clock | today's date and time |
| Calculator | exact arithmetic, parsed rather than `eval`ed |
| Notes | remember and recall facts, per agent, between chats |
| Read a web page | fetch a URL and read its text -- **the one that uses the internet** |

An agent can be limited to any subset. Small local models often call tools
slightly wrong; a call is repaired when there is only one thing the model
could have meant (a prefixed or misspelled name, wrong-case or wrapped
arguments, a number sent as text, nearly-JSON, a call written into the reply
as text), and the model is told what was fixed. A model that won't take tools
at all still works as a chat. See `src/lib/heal.js` and `src/lib/run.js`.

## How it fits together

```
src/lib/catalog.js     every server the app knows
src/lib/providers.js   Ollama, OpenAI-compatible and Anthropic, behind one shape
src/lib/run.js         an agent's turn: ask, repair calls, run tools, repeat
src/lib/heal.js        tool-call repair
src/lib/tools.js       the abilities
src/lib/store.js       everything kept, in the app's own storage
src/components/        the screens; AgentAvatar is the four-dot ring
src-tauri/             the desktop shell: HTTP (no CORS, streams) and link opening
```

Requests go through Tauri's HTTP plugin, not the webview's `fetch`, so local
servers that send no CORS headers (llama.cpp, LM Studio, vLLM) still answer.

## Privacy

Agents, chats, notes and API keys stay on this computer, in the app's storage.
Keys are stored in plain text there.

## Tests

```bash
npm test
```

Covers stream parsing, tool-call repair, the calculator, Markdown escaping,
the three wire formats, and whole agent turns against a fake Ollama.
