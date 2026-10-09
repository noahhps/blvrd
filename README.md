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

## Talking to agents

Write while an agent is still answering -- in its chat or another -- and the
message is queued: it shows above the box, can be taken out, and goes in
turn as soon as nothing else is answering, before any scheduled task. A
turn may take up to 40 rounds of tool calls (a computer task up to 150
steps); a call repeated more than three times in one turn is turned back so
a looping model tries something else.

## What an agent can do

| Ability | |
|---|---|
| Clock | today's date and time |
| Calculator | exact arithmetic, parsed rather than `eval`ed |
| Notebook | read and keep up to date the notebook you share with every agent (always on) |
| Memory | its own `MEMORY.md`, which you can read and edit under Customize (always on) |
| Read a web page | fetch a URL and read its text -- **the one that uses the internet** |

An agent can be limited to any subset. Small local models often call tools
slightly wrong; a call is repaired when there is only one thing the model
could have meant (a prefixed or misspelled name, wrong-case or wrapped
arguments, a number sent as text, nearly-JSON, a call written into the reply
as text -- in any of the forms Qwen, Mistral and Llama models use), and the
model is told what was fixed. A model whose server can't carry tool calls
(GPT4All, KoboldCpp, llama.cpp without `--jinja`, vLLM without a tool parser,
an Ollama model whose template has none) is given its tools in its
instructions instead and writes its calls out; the app learns which models
need that, and what else their servers refuse, and remembers. Thinking a model
writes into its reply (`<think>`) is folded away and never sent back. See
`src/lib/heal.js`, `src/lib/prompted.js` and `src/lib/run.js`.

Each model's real context is asked of its server (`src/lib/profile.js`):
Ollama is told how much to load a model with, rather than left at its small
default, and a chat is compacted before it outgrows what its model can take.
Under **Models → Computer access**, *Test computer access* checks that a model
calls a tool, reads what came back, and acts on it -- the server's own way or
written into its instructions -- and says which works (`src/lib/probe.js`).

## Memory

**The Notebook** is one page shared by you and every agent. It is kept in
versions: each save of yours, and each change an agent makes, is the next
version (`v57`). An agent remembers, per conversation, the version it last saw,
and every notebook call first tells it only what changed since -- never the
whole notebook again. An edit to something someone else changed after the
agent last looked isn't saved; the agent is told what it now says.

Your own edits show at once and are saved with ⌘S, or a few seconds after you
leave the notebook (and always before an agent answers). ⌘Z / ⇧⌘Z undo and redo
your steps; **History** lists every version, agents' included, and can undo
any of them.

**Each agent's `MEMORY.md`** is its own: how it works with you, what it's in the
middle of. It's a real file (`<app data>/agents/<id>/MEMORY.md`, with its last
20 saves kept beside it), given to the agent in full every turn, and shown under
Customize, where you can edit it, undo, or open the file.

See `docs/notebook-sync.md`.

## Tasks

Ask an agent to do something later -- "every weekday at 8, summarize my unread
email", "in 20 minutes, remind me to call Sam", "every hour, tell me if the
build page changes" -- and it asks you first, showing when the app read that
as ("every weekday at 08:00, next tomorrow at 08:00"). The time is read by the
app from your own words (`src/lib/when.js`), not worked out by the model. At
the time, the agent does the task in a small turn of its own and posts what it
found in the chat it was asked in, with a notification if blvrd isn't in
front; a task can be told to stay quiet unless there's something worth saying.

Everything is on the **Tasks** screen: run now, pause, edit, delete, and what a
task may do without asking -- sending or changing anything is off for a task
until you tick it there or on the card. While tasks are waiting, closing the
window leaves blvrd in the menu bar so they still run. See `docs/tasks.md`.

## The computer

Each chat can give its agent a computer: a shell, files and a web browser,
switched on in the chat (**Computer: Off · This Mac · Sandbox**, next to the
model). The agent gets one tool, `computer_task`; a worker does the task on
the computer in a context of its own and hands back a short report, so a
long session doesn't fill the chat -- its steps are under the report, to
open. Answers are cut to what the model's window can afford, with the rest
kept in a file it can grep (`docs/computer.md`).

While it works you can follow along: each step shows in the chat as it
starts, ticked or crossed as it ends, open for what it said -- and **Screen**
(in the chat's header, or *Watch the screen* under the steps) opens a column
beside the conversation with the computer's browser as it is, refreshed every
second or so. The pictures are for you; the model never sees them.

**This Mac**: the work happens in `~/blvrd/Workspace/<chat>`, and the
browser is your own -- Dia, Chrome, Arc, Brave, Edge, whichever you use, with
your logins -- through the blvrd extension: under **Models → The computer's
browser**, *Add blvrd to Dia* (or whichever) opens the browser's extensions
page and the extension's folder (`~/blvrd/Extension`); turn on Developer mode
there and drag the folder onto the page, and the card turns green when the
browser connects. Each chat's agent then works in a window of its own and
your tabs are left alone; keep the browser open while it works. If you'd
rather it didn't use your logins, choose *A separate browser* there: any built
on Chromium (the first one found, or the one you pick), started with a profile
of its own (`~/blvrd/Browser/<browser>`). Every command -- and anything that
reaches outside the folder, or sends a form -- waits for your Allow; "Always
allow" covers that one command. It needs Node.js on the Mac.
**Sandbox**: a Linux VM of its own (Lima on Apple's Virtualization
framework, made the first time a chat uses it), where nothing asks. It holds
none of your files or keys and sees one folder of yours, `~/blvrd/Shared`;
each chat works in `/work/<chat>` in it. Stop or reset it under **Models →
Sandbox**.

The computer itself is `computer/` -- an MCP server on stdio, the same program
on the Mac and in the VM -- and `src/lib/computer/` is the app's side of it.

## Connectors

Under **Connectors**, agents can be given your accounts and apps. Each is off
until you connect it, and an agent only gets one you tick under Customize →
Abilities. Reading never asks; **anything that sends, adds, changes or
switches something waits for your Allow in the chat** -- "Always allow" is
remembered per tool and can be taken back on the Connectors screen.

| Connector | What agents can do | How it signs in |
|---|---|---|
| Google Workspace | Search and read Gmail, draft and send; list and add Calendar events; search and read Drive, Docs and Sheets; list and add Tasks | Your own Google Cloud "Desktop app" client ID (the screen walks through it), then your browser |
| Apple Calendar & Reminders | List and add events; list, add and complete reminders -- every account those apps hold | macOS asks once (Automation) |
| Home Assistant | Find devices and sensors, read state, control anything (lights, climate, locks, scenes...) | Address and a long-lived access token |
| MCP servers | Whatever the server offers. Ready-made: Notion, Linear, Jira & Confluence, GitHub, Sentry, Stripe, Supabase, Vercel, Hugging Face, DeepWiki, files in a folder | OAuth in your browser (discovered from the server), a token, or nothing; local servers run as a command |

Apple's scripts are fixed and compiled into the app (`src-tauri/scripts`);
arguments reach them as data, never as code. Local MCP servers start through
your login shell, so `npx` and `uvx` are found as in Terminal.

## How it fits together

```
src/lib/catalog.js     every server the app knows
src/lib/providers.js   Ollama, OpenAI-compatible and Anthropic, behind one shape
src/lib/run.js         an agent's turn: ask, repair calls, run tools, repeat
src/lib/heal.js        tool-call repair, calls written as text, <think>
src/lib/prompted.js    tools in the instructions, for models without tool calls
src/lib/profile.js     what each model can take and do, and its server's quirks
src/lib/probe.js       "Test computer access"
src/lib/computer/      the computer from the app: computer_task, the worker,
                       budgets, the tools and their approvals
computer/              the computer itself: shell, files, browser (MCP, stdio)
src/lib/tools.js       the built-in abilities
src/lib/when.js        "every weekday at 8" -> a rule, and when it next comes round
src/lib/schedule.js    tasks: the tools, a run, retries, what the chat is told
src/lib/connectors/    Google, Apple, Home Assistant, MCP -- tools from your accounts
src/lib/oauth.js       browser sign-in: PKCE, loopback redirect, MCP discovery
src/lib/group.js       group chats: who answers, what each agent sees
src/lib/notebook.js    the Notebook: versions, the user's draft, undo, history
src/lib/versions.js    a change as operations: diff, apply, undo, net effect
src/lib/notebookSync.js  agents catching up from the version they last saw
src/lib/agentMemory.js each agent's MEMORY.md
src/lib/store.js       everything kept, in the app's own storage
src/components/        the screens; AgentAvatar is the four-dot ring
src-tauri/             the desktop shell: HTTP (no CORS, streams), links, sign-in
                       listener, Apple scripts, local MCP servers, MEMORY.md files
```

Requests go through Tauri's HTTP plugin, not the webview's `fetch`, so local
servers that send no CORS headers (llama.cpp, LM Studio, vLLM) still answer.

## Privacy

Agents, chats, the Notebook, agents' memory files and API keys stay on this
computer, in the app's storage and data folder.
Keys are stored in plain text there.

## Tests

```bash
npm test
```

Covers stream parsing, tool-call repair, the calculator, Markdown escaping,
the three wire formats, and whole agent turns against a fake Ollama.
