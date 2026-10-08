# A computer for agents -- proposal

Agents get a computer: a shell, files, a browser, and (later) a screen. It
runs in one of two places, chosen per conversation:

- **Sandbox** -- a small Linux VM on this Mac. The agent can do anything in it
  without asking; nothing it does there touches your files or accounts.
- **This Mac** -- the same tools on the host itself, in a workspace folder,
  with anything that changes something waiting for your Allow (as connectors
  already do).

Everything below is shaped by one constraint: blvrd runs mostly **local models
and OpenAI-compatible endpoints**. That means context windows of 8k-32k
tokens, prompt processing (prefill) that is the slowest part of every turn on
a laptop, tool calling that is often slightly wrong, and usually no vision.
A computer that dumps HTML, full accessibility trees or screenshots into the
chat would be unusable on those models. So the design is text-first,
budgeted, and keeps the agent's chat almost untouched by what happens on the
computer.

---

## 1. The rules every part follows

1. **The chat sees reports, not steps.** Computer work runs in a separate
   worker context (§5). The agent's own chat gets back a short report; the
   steps are kept for the reader to open, never re-sent to the model.
2. **Every observation has a budget,** set from the model's real context
   window (§6). Nothing comes back unbounded.
3. **Overflow goes to disk, not into context.** Long output is saved in the
   computer and the model gets a head, a tail and a path it can `grep`.
4. **Actions return what they changed.** A click answers with the page as it
   now is (or what changed), so there is no separate "look" round -- each
   round re-sends the whole context, so rounds are the real cost.
5. **Several actions per call.** The browser takes a short script of steps;
   the shell takes a script. One round, many actions.
6. **The prefix never moves.** System prompt and tool list are byte-identical
   for the whole task, and history is append-only between checkpoints, so
   llama.cpp / Ollama / vLLM / SGLang reuse their KV cache and hosted
   OpenAI-compatible servers their prompt cache. Re-prefilling 20k tokens on
   a laptop is tens of seconds; reusing it is nearly free.
7. **Few tools, flat arguments.** Five tools, mostly one or two string
   parameters. Schemas cost tokens on every request and every extra tool is
   another chance for a small model to pick the wrong one.
8. **The runtime does the boring parts.** Waiting for pages, retrying a stale
   click, finding files, cutting output -- code, not model rounds.
9. **Pixels only when asked, and ideally never in the main model.** A
   screenshot is read by a vision model that answers in words (§4, `look`).

---

## 2. Shape

```
 blvrd (webview)                                     the computer
 ┌──────────────────────────────┐                  ┌──────────────────────────┐
 │ chat ── computer_task ──┐    │                  │ blvrd-computer (daemon)  │
 │                         ▼    │   MCP over stdio │  shell   (persistent bash)│
 │ lib/computer/worker.js  ─────┼──────────────────┤  files   (read/write/edit)│
 │  budget · views · checkpoint │                  │  browser (Chromium, CDP)  │
 └──────────────────────────────┘                  │  screen  (Xvfb, optional) │
              │                                    └──────────────────────────┘
   src-tauri/src/machine.rs                          runs either
   (start / stop / reset the VM)                     · inside the VM, via
              │                                        `limactl shell blvrd …`
              └──────────── or ─────────────────────── · on this Mac, as a child
                                                         process
```

**One daemon, two places, one protocol.** `blvrd-computer` is a small MCP
server spoken to over stdio. The app already runs local MCP servers this way
(`src-tauri/src/mcp.rs`, `src/lib/connectors/mcp.js`), so the toggle is only a
change of command:

| Where | Command the app spawns |
|---|---|
| Sandbox | `limactl shell blvrd -- blvrd-computer --root /work/<chat>` |
| This Mac | `<app>/blvrd-computer --root ~/blvrd/Workspace/<chat> --host` |

Same tools, same output formats, same tests. `--host` only switches on the
approval rules and the separate browser profile (§8).

The daemon is TypeScript compiled to a single binary (`bun build --compile`,
one per architecture), shipped as a Tauri sidecar for host mode and installed
in the VM image. It drives Chromium over CDP with `playwright-core` (no
bundled browsers: the VM image has Chromium; on the host it uses the
installed Chrome with its own profile directory). The shell is a long-lived
`bash` with a sentinel line after each command, so `cd` and `export` persist
and no native PTY module is needed.

---

## 3. The sandbox VM

- **Lima on Apple's Virtualization framework** (`vmType: vz`, virtiofs).
  Linux guest (Debian or Ubuntu, arm64), headless. Rosetta enabled so x86
  binaries run. Lima is a single binary; blvrd downloads a pinned release on
  first use instead of asking for Homebrew.
- **One VM for all chats**, each chat in its own folder (`/work/<chatId>`) and
  its own browser context. One VM, not one per chat, because the local model
  is already using most of the RAM: default 2 CPUs, 3 GB, growable.
- **Image**: provisioned once from a cloud image with git, python3, node,
  ripgrep, fd, jq, Chromium, Xvfb + a minimal window manager (started only
  when the screen is used). About 2-3 GB on disk. A clean snapshot is taken
  after provisioning; **Reset machine** returns to it.
- **Lifecycle** (`machine.rs`): created on first use with progress shown;
  started when a chat that uses it sends; stopped after 15 idle minutes. Boot
  after creation is a few seconds.
- **Exchange with the Mac**: one shared folder, `~/blvrd/Shared` ↔ `/shared`.
  Nothing else of the host is mounted; no keys or tokens are in the VM.
- **Network**: on by default (browsing needs it); a per-chat switch turns it
  off.

On a non-Mac host the same `Machine` interface would sit over QEMU/KVM or
WSL2; Apple's `container` tool is a possible later backend on macOS 26. Only
`machine.rs` knows which.

---

## 4. The tools

The worker (§5) gets these. Together their schemas come to about 700 tokens.

| Tool | Arguments | Returns |
|---|---|---|
| `shell` | `script`, `timeout?` | `exit 0 · 1.2s · ~/proj` then output, cut to budget |
| `read` | `path`, `from?`, `lines?` | numbered lines, a window of the file; a directory lists itself |
| `write` | `path`, `content` | `wrote 84 lines to app.py` |
| `edit` | `path`, `find`, `replace` | the changed lines with 3 lines around them |
| `browser` | `steps` | the page view after the last step (below) |
| `look` | `question` | *only with a screen and a vision model* -- a text answer |

**`edit`** is exact find-and-replace: a model fixes a line by sending ten
tokens, not by re-writing the file. A `find` that matches nothing or more than
once comes back with the nearest matches, so the next try is right.

**`browser`** takes a few lines of a small language rather than a tool per
action, because small models write `click 12` far more reliably than nested
JSON, and one call can do a whole form:

```
open https://example.com/login
type 4 noah@example.com
type 5 hunter2
click 9
```

Verbs: `open`, `click`, `type` (`… enter` to submit), `select`, `press`,
`scroll`, `back`, `tab`, `find <text>`, `wait <text>`. The runtime waits for
the page to settle after each step, and a ref that went stale is looked up
again by its role and name before failing. Lines are repaired the way
`lib/heal.js` repairs calls (`Click #12`, `go to …`, quotes).

**The page view** is the token sink in every browser agent, so it is built
for budget, not completeness:

```
Example — Sign in            https://example.com/login
# Sign in to Example
[4] textbox "Email"   [5] textbox "Password"   [6] checkbox "Remember me"
[9] button "Sign in"   [10] link "Forgot password?"
… 31 more links in header/footer (find <text> to reach one)
```

Interactive elements get short numeric refs; main-content text comes through
readable and clipped; navigation chrome is counted, not listed. After an
action on the same page the view is a **diff**: what appeared, what changed,
what went away (`+ dialog "Saved"`, `~ [6] checkbox "Remember me" ✓`). A full
view is sent again only after navigation or on `find`.

**`shell` output** is cut tail-heavy (errors are at the end): the first 15
lines, the last 60, and `… 2,310 lines in /work/.out/17.log -- grep it`.
Progress bars and carriage-return redraws are collapsed before counting.

**`look`** is how a text-only model sees. The daemon takes a screenshot; a
local vision model (any Ollama/llava/Qwen-VL the reader picks in Settings)
answers the worker's question about it in a sentence or two. The image never
enters the worker's context. If the worker's own model has vision, the reader
can let `look` return the (downscaled, 1024 px) image instead, and only the
latest image is ever kept in context.

GUI control beyond the browser (`click x y` on the virtual screen) is phase 3
and only for vision models; most tasks are done through shell, files and
browser.

---

## 5. The worker: computer work in its own context

The agent in the chat gets **one** new tool:

```
computer_task(task: string, continue?: boolean)
```

Calling it starts a worker loop on the computer -- by default the agent's own
model, optionally a different one per agent (a coder model for code). The
worker has the tools above, a step limit (30 by default, against the chat's
`MAX_ROUNDS` of 8), and a short, fixed system prompt:

> You are working on a computer for {agent}. Task: {task}.
> Keep `/work/.task/notes.md` current: the plan, what is done, what you
> learned. Finish with a report: what you did, what changed (files, pages),
> the result, and anything you need from the user.

What comes back to the chat is that report -- typically 100-300 tokens -- as
the tool result. The full step log is stored on the tool message and shown in
the chat as the existing collapsed tool call, expandable to every step; it is
never sent back to any model, and compaction (`lib/compact.js`) already cuts
tool results to 600 characters for its summary.

`continue: true` resumes on the same machine with the notes file, so "now
also add tests" doesn't redo the exploration. The notes file is the worker's
memory across tasks and across checkpoints; it costs a few hundred tokens and
saves the re-discovery that would cost thousands.

If the worker needs something only the user can give (a password, a choice),
it stops early and says so in the report; the agent asks in the chat.

**Why not give the chat agent the tools directly?** Because a ten-step
browser session would leave ten page views in a chat that has a 16k window,
and every later message would re-send them. For quick one-liners the reader
can still tick `shell` and `read` on an agent (Customize → Abilities); their
results follow the same budgets.

---

## 6. Budgets, from the model's real window

**Know the window.** Today the app sends no `num_ctx` to Ollama, so Ollama
uses its small default and silently drops the start of long prompts --
exactly the system prompt and task. Before any of this:

- Ollama: read `context_length` from `/api/show` and send `options.num_ctx`
  (capped by a reader setting, since a bigger KV cache costs RAM).
- OpenAI-compatible: use the length the server reports where it does (vLLM
  `max_model_len` on `/v1/models`, LM Studio `max_context_length`,
  OpenRouter `context_length`); otherwise a per-model setting, default 8k.

**Split it.** For a window *W*:

| Part | Share | 8k | 32k | 128k |
|---|---|---|---|---|
| System + tools + task + notes (fixed) | ≈ 2k | 2k | 2k | 2k |
| One observation (cap) | 10% of *W*, 400 – 4k | 800 | 3.2k | 4k |
| Checkpoint at | 70% of *W* | 5.6k | 22k | 90k |
| Reply room | 15% of *W* | 1.2k | 4.8k | 19k |

Token counts are the same four-characters estimate `compact.js` uses; exact
tokenizers aren't worth shipping per model.

**Checkpoint, don't slide.** When the worker's context passes the checkpoint
line, it is rewritten **once**: the task, the notes file, the last two
observations in full, and every earlier step as one line (`browser: open
example.com/login → login page`, `shell: npm test → exit 1, 3 failing`). Then
it grows append-only again. A sliding window that drops one old message per
round would change the prefix on every request and throw away the KV cache
every time; a checkpoint costs one re-prefill and keeps the cache valid until
the next one. Only the latest page view per tab and the latest read of each
file survive a checkpoint; the rest are superseded by definition.

**Keep the chat's prefix still too.** `notebookBrief()` is currently joined
into the system prompt on every turn (`App.jsx`, `answerAs`); when it changes,
the whole cached chat is re-processed. Worth moving into the latest user turn
for every agent, computer or not. Which computer a chat is on goes the same
way: a line at the end of the user's message when it changes, never into the
system prompt.

---

## 7. Getting the most out of small models

- **Tell, don't fail.** Every error says what to do next, as `heal.js` already
  does: `ref 12 is gone -- the page changed; here is the new view`, `edit:
  "foo(" not found; closest is line 41: "foo (x)"`.
- **One fixed workflow in the prompt.** Plan in the notes file, act, check,
  report. Small models do better with a routine than with freedom.
- **The runtime finishes obvious things.** Page loads, waiting for a
  selector, closing a known cookie banner on request, dismissing a `less`
  pager (`PAGER=cat`), non-interactive flags (`DEBIAN_FRONTEND=noninteractive`,
  `GIT_TERMINAL_PROMPT=0`), a timeout that kills a hung command and says so.
- **Search before reading.** `read` on a directory or a file over the budget
  returns an outline (files with sizes; for code, its top-level definitions
  via ripgrep) instead of content, so the model asks for the part it needs.
- **The right model for each part.** Worker model per agent, vision model for
  `look`, both from the existing Models screen. A small fast model can run the
  worker while a big one stays in the chat, or the other way round.
- **Measure.** Each task records rounds, tokens sent, tokens reused (where
  the server reports cache hits) and seconds. Shown on the collapsed step
  log; used to tune the budgets above with real models instead of guesses.

---

## 8. Safety, per place

**Sandbox.** Nothing asks. The VM holds no keys, sees one shared folder, and
can be reset. The reader can turn its network off per chat. Web pages can
still try to steer the worker (prompt injection); in the sandbox the worst
case is a wrecked VM and a wrong report.

**This Mac.** The same tools behind the existing approval flow (`confirm` in
`lib/run.js`, "Always allow" kept per tool):

| Action | Asks? |
|---|---|
| `read` inside the chat's workspace | no |
| `read` elsewhere | yes, "always allow" per folder |
| `write` / `edit` inside the workspace | no |
| `write` / `edit` elsewhere | yes |
| `shell` | yes, with "always allow" per command (`git status`, `npm test`) |
| `browser` | no for reading; yes for a step that submits a form |
| `look`, screen control | phase 4, behind macOS Accessibility and Screen Recording permission |

The host browser is a separate Chrome profile with no saved logins unless the
reader signs in to it on purpose. Approvals reach the reader from inside the
worker the same way they do now: the worker's `approve` is the chat's. Stop
kills the daemon's whole process group.

A chat on a **hosted** model sends everything the computer shows it to that
host; the toggle says so, as the model chip already does.

---

## 9. The per-conversation toggle

Stored alongside the chats, keyed the same way (agent id or group id):

```js
computers: { [chatId]: { where: "off" | "sandbox" | "host", network: true } }
```

Shown in the composer tray next to the model: **Computer: Off · Sandbox ·
This Mac**. Off by default. The agent is offered `computer_task` only when
it is not Off. Switching mid-chat is allowed; the worker is told on its next
task, and the old place's files stay where they were. A group chat shares one
computer among its agents. **Reset** (sandbox) clears the chat's folder and
browser context; **Reset machine** restores the clean snapshot.

---

## 10. Building it

**Phase 1 -- the computer, on this Mac (shell, files, browser, worker)**
- `computer/` -- the daemon: MCP stdio server, `shell` / `read` / `write` /
  `edit` / `browser`, page views and diffs, output spill files. Its own tests
  against fixture pages and a real bash.
- `src/lib/computer/worker.js` -- the worker loop (a variant of `runTurn`
  with its own step limit, checkpointing and report).
- `src/lib/computer/budget.js` -- window detection, the split in §6,
  observation cutting.
- `src/lib/providers.js` -- `num_ctx` for Ollama; context length discovery.
- `src/lib/store.js` -- `computers`; composer tray toggle; step log in the
  collapsed tool call.
- `src-tauri` -- the daemon as a sidecar; process-group kill on stop.

**Phase 2 -- the sandbox**
- `src-tauri/src/machine.rs` -- fetch Lima, create from a template, start,
  stop when idle, snapshot, reset, progress events.
- `computer/vm/blvrd.yaml` -- the Lima template and provisioning script.
- Settings: VM size, shared folder, Reset machine.

**Phase 3 -- the screen**
- Xvfb + window manager on demand, `look` through a vision model, `click x
  y` / `key` for vision workers.

**Phase 4 -- the Mac's own screen (maybe never)**
- macOS accessibility tree as text, behind permissions and approvals.

Phase 1 is useful on its own and proves the formats and budgets with real
local models before any VM work.

---

## Decisions this proposal makes (change any of them)

- Worker-by-default instead of computer tools in the chat.
- A one-string browser script instead of one tool per action.
- One shared VM with per-chat folders instead of a VM per chat.
- Lima + Apple Virtualization instead of Docker/OrbStack (no extra app, real
  VM boundary).
- Text first; screenshots go to a separate vision model unless the reader
  says otherwise.
