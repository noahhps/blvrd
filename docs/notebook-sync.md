# The Notebook as shared, versioned memory — design

Status: design, nothing built yet. Refines `docs/memory-proposal.md`: this is
how the Notebook itself works as memory (versions, sync, undo) and where each
agent keeps memory of its own. The proposal's tidy-up, diary, index and forget
build on top of it unchanged.

## In one paragraph

The Notebook becomes a versioned document shared by the user and every agent.
Every saved change makes a new **version key** (`v1`, `v2`, … for the whole
notebook). Each agent keeps a **cursor** — the version key it last saw — and
every notebook tool call is a **sync**: the agent is sent only what changed
since its cursor, its own edits are applied on top (and refused where they'd
overwrite something it hasn't seen), and its cursor moves to the new head.
Agents never re-read the whole notebook to stay current. The user's edits
collect as a **draft** and become a version when saved — by hand, or after the
notebook has been out of focus for a few seconds. Every change, saved or not,
sits in an in-memory **undo/redo** stack; saved versions also sit in a log on
disk. Besides the shared notebook, each agent has a **`MEMORY.md`** of its own —
a real Markdown file the user can read and edit in that agent's settings.

```
                ┌──────────────────────────── user ─────────────────────────────┐
                │  edits → DRAFT (in memory, undoable)                          │
                │        └─ save: ⌘S / Save, or 3 s out of focus ─┐             │
                └─────────────────────────────────────────────────┼─────────────┘
                                                                  ▼
   agents ──── notebook_* call = SYNC ──────────────▶  ┌──────────────────────┐
   Planner  cursor v41 ── "since v41: 3 changes" ◀──── │  NOTEBOOK  head v57  │
   Research cursor v57 ── "nothing new"          ◀──── │  sections at head    │
                         edits → v58 (one call = one   │  version log v1…v57  │
                         version, checked vs cursor)   └──────────────────────┘
                                                                  ▲
   each agent: MEMORY.md (its own, private) — injected whole,     │ undo / redo:
   edited by the agent with my_memory, by the user in Customize   │ memory stack + log
```

---

## 1. Versions

### 1.1 The version key

- One counter for the whole notebook: `head`, starting at `1`. Every **commit**
  — one user save, or one agent tool call that changed something — takes
  `head + 1`. Shown to agents and the user as `v57`.
- Live sections (calendar, now playing, agents, groups, setup) are kept by the
  app, not written, so they never make versions. Moving and resizing widgets on
  the page (`at`, sidebar order) isn't memory either and doesn't make versions.
- Each section records the version that last changed it (`v`), and so does each
  entry (row, item, note). That's what makes a cheap "what changed since v41"
  and per-entry conflict checks possible.

### 1.2 What a version holds

A commit is a list of **operations**, each with what was there before and what
is there after, so it can be shown, undone and diffed without keeping whole
copies of the notebook:

```js
// IndexedDB "blvrd-notebook" › store "versions", key v
{
  v: 57,
  by: "user" | agentId,
  at: 1759900000000,
  chat: "agt_planner" | null,         // the chat an agent was answering in
  label: "Saved" | null,              // an optional name for a manual save
  revertOf: null | 52,                // set when this version undoes another
  ops: [
    { kind: "set",    sec: "sec_about", row: "r_3", before: { key: "Birthday", value: "15 March" }, after: { key: "Birthday", value: "14 March" } },
    { kind: "add",    sec: "sec_places", item: "i_9", after: { text: "Nopa", done: false } },
    { kind: "text",   sec: "sec_work", before: "Mornings are for deep work.", after: "Mornings are for deep work.\n\nNo meetings Fridays." },
    { kind: "create", sec: "sec_run", after: { title: "Running", type: "facts", data: { rows: [] } } },
    { kind: "rename", sec: "sec_run", before: "Running", after: "Running & races" },
    { kind: "remove", sec: "sec_old", before: { …the whole section… } },
  ],
}
```

Facts rows gain an `id` (today they are found by label), so renaming a label
is an edit to a row rather than a remove and an add — and so an agent's edit can
point at exactly the row it saw.

### 1.3 The log on disk

- `versions`: every commit, newest kept. Trimmed to the last **1,000 versions or
  90 days**, whichever keeps more.
- `snapshots`: the full notebook every **50 versions**, so any version can be
  rebuilt (nearest snapshot + the ops after it) for "view as of v40" and for
  syncing an agent whose cursor is old.
- When the log is trimmed past an agent's cursor, that agent's next sync is a
  full read (§2.4) — nothing breaks, it just costs more once.

---

## 2. Agents: every call is a sync

### 2.1 The cursor

What an agent knows of the notebook is what's in its context window — so the
cursor belongs to an agent *in a conversation*, not to the agent in general.
The same agent in its own chat and in a group has seen different things.

```js
// IndexedDB "blvrd-notebook" › store "cursors", key `${agentId}|${chatId}`
{
  v: 41,                         // the head when it last synced
  sections: { sec_work: 55 },    // sections read in full later than v (rare; see 2.3)
  anchor: "m_x1",                // the message its last notebook result is in
}
```

The cursor is only good while the agent can still *see* what it was told. Before
each turn the app checks that `anchor` is still among the messages sent to the
model (`sinceSummary(chat).rest`). If the chat was compacted past it, or the
chat was cleared, the cursor is dropped and the next sync is a full read.
Without this rule an agent would be sent "3 changes since v41" with nothing to
apply them to.

This replaces today's `section.seen[agentId]` (per section, per agent, not per
chat). Everything `changedBy()` does — telling an agent that someone else wrote
in the notebook — now comes from the delta itself.

### 2.2 The tools

Three tools, all `always` on as today. **Every one of them returns the catch-up
first**, then its own result, and moves the cursor to the new head. That is the
"reads and updates" rule: an agent can't touch the notebook without being
brought up to date, and is never sent the whole notebook to be brought up to
date.

| Tool | Arguments | Does |
|---|---|---|
| `notebook_sync` | none | Just the catch-up. Replaces `notebook_contents`. |
| `notebook_read` | `section` | Catch-up, then that one section in full. |
| `notebook_edit` | `section`, `action`, and `key`/`value`, `item`, `text`, `old`/`new`; or `changes: [ … ]` for several at once | Catch-up, then applies the edits as **one version**, checked against the cursor (§2.5). |

`notebook_edit` keeps today's actions (`set`/`remove` for facts;
`add`/`check`/`uncheck`/`remove` for lists; `append`/`replace` for notes) and
gains `revise` for notes — replace `old` with `new`, refused unless `old`
occurs exactly once — so changing one sentence doesn't mean rewriting a note
someone else may have just added to. The flat one-edit form stays because small
models get it right far more often than an array; `changes` is there for
models that can.

### 2.3 The catch-up

What changed between the cursor and the head, from the version log, **collapsed
to net effect** (three edits to one row are one line; an add then a remove is
nothing), and **minus the agent's own changes** unless someone else has since
changed or undone them:

```
Notebook v57 — you last saw v41. Since then:
- About › Birthday: "15 March" → "14 March" (the user, v44)
- Places to try: added "Nopa" (Planner, another assistant, v49)
- Work (note): added "No meetings Fridays." (the user, v55)
- New section "Running" (facts, empty) (the user, v56)
- The user undid your change to Gift ideas (v57): "Vinyl" is no longer there.
```

or `Notebook v57 — nothing has changed since you last looked.`

- Note and text sections are shown as the lines added and removed, not the
  whole text, unless more than half of it changed — then the new text in full.
- A section only the agent's `sections` map covers is diffed from its own key.
- Scope rules (sections kept from some agents, or from hosted models — see the
  proposal §3.2) apply here too: a hidden section's changes are never in a
  catch-up.
- A catch-up longer than a budget (~1,500 tokens) lists the changed sections by
  name and count instead, and says to `notebook_read` the ones that matter.

### 2.4 The full read

When there's no usable cursor — the first time an agent meets the notebook in a
conversation, after compaction, or when the log no longer reaches back far
enough — the catch-up is a full read instead:

```
Notebook v57. Its sections:
- About (facts, 6 rows) — who the user is
- Places to try (list, 4 open, 2 done)
- Work (note, 120 words)
- Running (facts, empty)
- Calendar (kept current by the app; read-only)
About:
- Name: Noah
- Birthday: 14 March
…
```

Small sections are included in full up to a budget; the rest by title, size and
"when to use" line, for `notebook_read`. The cursor is then set to the head
(sections not shown in full are still covered: a later `notebook_read` of one
of them adds it to `sections` at that read's version).

### 2.5 Edits against a cursor: no silent overwrites

An agent's edit is based on what it has seen. Before applying, each operation
is checked against its target:

| Edit | Refused when |
|---|---|
| facts `set` / `remove` on an existing row | the row changed after the agent's cursor for that section |
| list `check` / `uncheck` / `remove` | the item changed after the cursor |
| list `add`, facts `set` of a new label | the same item or label was added after the cursor (it's a duplicate) |
| note `append` | never — appends don't clash |
| note `revise` | `old` isn't there exactly once (it was changed under it) |
| note `replace` | the note changed after the cursor |

A refused operation doesn't fail the others in the same call. The answer says
what happened and why, with the current value, so the model can decide again:

```
Saved as v58: added "Film camera" to Gift ideas.
Not saved: About › Birthday — the user changed it at v44 to "14 March" after
you last saw it. If your change is still right, make it again.
```

The catch-up that comes first in the same answer already contains the newer
value, so the agent has everything it needs to retry.

Agents in a group answer one after another, and a turn's tool calls run in
order, so two agents never commit at the same instant; the version counter and
the per-entry check are enough. (If a second window ever writes the notebook,
a `BroadcastChannel` tells the other to reload before its next commit.)

### 2.6 Telling the agent it's behind — without breaking the cache

The system prompt keeps only what doesn't change between turns: the sections'
titles and "when to use" lines, and the agent's `MEMORY.md` (§4). The one fact
that changes — *the notebook has moved on since you last looked* — is added to
the end of the user's latest message **as sent to the model** (not as stored
in the chat):

```
(Notebook: v57, you last saw v41 — 4 changes, in About, Places to try, Work and
Running. notebook_sync to catch up.)
```

That keeps the long, stable prefix byte-identical so Ollama and llama.cpp can
reuse their KV-cache, and hosted models bill it as cached. Nothing is said when
the agent is up to date.

### 2.7 When agents' edits wait for the user

Today's "agents ask first" switch still works: an agent's `notebook_edit`
waits for Allow (`confirm`) as now. The check of §2.5 runs again at the moment
the user allows it, against the head *then*, so an edit that waited while the
user changed the same row is refused rather than applied over them.

---

## 3. The user's side: drafts, saves, undo

### 3.1 The draft

The user's edits apply to the page at once — what they see is what they
typed — but go into a **draft**, not a version. Agents read the head, not the
draft.

```js
// in memory, mirrored to IndexedDB "draft" so a crash loses nothing
draft = {
  base: 57,                          // the head the draft started from
  ops: [ …same shape as a version's ops… ],
  dirty: Set(["sec_about", "sec_work"]),
}
```

The page marks sections with unsaved changes (a small dot by the title) and
shows **"Unsaved changes · Save ⌘S"** at the top of the Notebook.

### 3.2 When the draft becomes a version

1. **By hand** — ⌘S / Ctrl+S on the Notebook, or the Save button. A long-press
   (or the button's menu) lets the user name the version ("Before the move").
2. **Out of focus for 3 seconds** — focus leaves the notebook page (clicked into
   a chat, the sidebar, another app; `focusout` from the page root, `blur` on
   the window, or the view changing) and doesn't come back within **3 s**.
   Coming back inside the 3 s cancels it, so moving between two fields of the
   notebook never saves halfway. The delay is a Setting (1–30 s, or "only when I
   save").
3. **Before an agent reads** — when an agent's turn is about to start, a pending
   draft is saved first, so an agent the user is talking to is never behind
   what's on the user's screen. (Sending a message means focus already left the
   notebook; this covers the Quick window and group chats where the 3 s may not
   have run out yet.)
4. **When the app hides or quits** — `visibilitychange` / Tauri's close request.

Each save is **one version** however many edits the draft holds, `by: "user"`.
An empty draft makes nothing.

Inside a single field, typing isn't an operation per keystroke: the field keeps
the browser's own undo while it has focus, and becomes **one** operation when it
loses focus or after 800 ms without typing — the same moment `NotebookView`
calls `notebook.write` today.

### 3.3 An agent saves while the user has a draft

The draft is **rebased**: its operations are re-applied on the new head.
Operations on entries the agent didn't touch just move across. If the agent
changed an entry the draft also changed, the user's version stays on screen
(it's their page) and the entry shows a marker — *"Planner changed this to
'14 March' while you were editing · Keep mine · Use theirs"*. Saving with the
marker unresolved keeps the user's.

### 3.4 Undo and redo

Two stacks, in memory, for the life of the window:

```js
undo = [ { ops, v: null | 57, by, label } , … ]   // newest last, up to 200 steps
redo = [ … ]                                      // cleared by any new edit
```

- **⌘Z / ⇧⌘Z** on the Notebook (outside a field that is being typed in, which
  keeps its own undo first).
- **Undoing an unsaved step** applies the step's inverse to the page and drops it
  from the draft. No version, nothing for agents to see.
- **Undoing a saved step** never rewrites history (an agent may already have
  read it): it makes a **new version** with `revertOf` set, applying the inverse
  of the operations. If some of those entries have changed since — by an agent,
  say — those parts are left alone and the user is told: *"Undid 2 of 3 changes;
  'Birthday' was changed by Planner since."* Redo reverts the revert.
- The stack holds the **user's** steps. Agents' versions are undone from the
  history (§3.5), not by ⌘Z — pressing ⌘Z should never undo something the user
  didn't do.
- The stacks are memory only; after a restart, undo still works from the
  history panel, which reads the log on disk.

Memory: an operation is small (before/after of one entry); 200 steps is well
under a megabyte even for long notes.

### 3.5 History

A panel on the Notebook (and a section's menu, filtered to that section):

```
v57  You · undid "Vinyl" in Gift ideas              2 min ago      View · Undo
v56  You · Saved · new section Running               5 min ago      View · Undo
v55  You · Work: added "No meetings Fridays."       1 h ago        View · Undo
v49  Planner · Places to try: added "Nopa"          yesterday      View · Undo · Open chat
```

- **View** shows the notebook (or section) as of that version, read-only, with
  the changes highlighted.
- **Undo** on any version — the user's or an agent's — makes a revert version as
  in §3.4.
- **Restore this version** (from View) makes one version that sets the section
  back to how it was then.
- **Open chat** jumps to the message the agent was answering.

---

## 4. Each agent's own memory: `MEMORY.md`

### 4.1 What it's for

The Notebook is about **the user**, shared by everyone. `MEMORY.md` is the
agent's **own** — how it does its job, what it's in the middle of, what it has
learned that only matters to it ("the user wants citations as footnotes",
"tracking the Lisbon trip: hotel still open"). It replaces today's hidden
per-agent notes (`state.notes`, the `remember`/`recall` tools) with something
the user can see.

### 4.2 Where it lives

A real file, one per agent:

```
~/Library/Application Support/us.stivers.blvrd/agents/<agentId>/MEMORY.md
```

(the Tauri app data directory, so the same layout on Windows and Linux). It is
read and written through three small Rust commands — `agent_memory_read`,
`agent_memory_write`, `agent_memory_reveal` — that only accept an agent id and
build the path themselves, so the webview gets no general file access. Writes
go to a temporary file and are renamed into place, so a crash never leaves half
a file. In the browser build (`npm run dev`) the same three functions are
backed by IndexedDB.

A new agent's file starts as:

```markdown
# Planner's memory

## How I work with the user

## In progress

## Learned
```

### 4.3 How the agent uses it

- **Read: always, whole.** It is short and it is the agent's own, so it goes into
  the system prompt in full, right after the agent's instructions — a stable
  spot that only changes when the file does. Capped at ~2,000 tokens; over the
  cap the agent is told so and asked to tidy it.
- **Write: one tool**, `my_memory`, with the same exact-match style as the
  notebook:

| Action | Arguments | Does |
|---|---|---|
| `append` | `text`, optional `heading` | Adds a line under that heading (made if missing), or at the end |
| `revise` | `old`, `new` | Replaces `old`, refused unless it occurs exactly once |
| `remove` | `text` | Removes the line containing `text`, refused unless exactly one does |

  The answer is the changed part of the file and its new size. `remember` and
  `recall` stay as aliases (`remember` → `append` under "Learned"; `recall` →
  the file, which the agent already has), so an agent with them in its list
  keeps working.

- **Not versioned like the notebook.** Only the agent and the user write it, so
  there are no cursors. But each change by either of them is pushed onto that
  agent's own undo stack (§4.4), and the last 20 versions of the file are kept
  beside it (`MEMORY.md` plus `.history/` with timestamped copies) so a bad
  rewrite can be rolled back after a restart.

### 4.4 Where the user sees it

A **Memory** section in the agent's Customize sheet (`AgentEditor.jsx`), under
Instructions:

- The file rendered as Markdown, with **Edit** to switch to a plain editor.
- The same save rules as the notebook: ⌘S, or 3 s after focus leaves the editor;
  ⌘Z / ⇧⌘Z through the agent's stack; an "Unsaved" mark until saved.
- If the agent writes while the user is editing, the editor shows *"Planner
  updated its memory · Show"*, and the user's text is kept until they choose.
- If the file was changed in another editor, the app notices (by its modified
  time, checked when the sheet opens and before each of the agent's turns) and
  reloads it.
- **Reveal in Finder**, **Clear**, a size meter (*~640 of 2,000 tokens*), and a
  line under it: *"In this chat, Planner last saw the notebook at v41 (now
  v57)."*
- Deleting the agent keeps its folder until the existing undo for deleting an
  agent has passed, then removes it.

---

## 5. Prompt layout

```
system  ┌ You are Planner…                         stable
        │ instructions                              stable
        │ ── Your memory (MEMORY.md) ──             stable until the file changes
        │ ── The notebook: section titles + "when to use" ── stable until sections change
        └ summary of earlier conversation           stable until compaction
messages  … the chat …
          last user message + "(Notebook: v57, you last saw v41 — …)"   volatile
```

---

## 6. Changes to the code

| File | Change |
|---|---|
| `src/lib/notebook.js` | `head`; per-section and per-entry `v`; row ids; `commit(ops, by)` making a version; the draft (`edit`, `save`, `discard`, rebase); undo/redo stacks; IndexedDB stores `versions`, `snapshots`, `cursors`, `draft` (database version 2, with an upgrade that gives existing rows ids and sets `head` to 1) |
| `src/lib/notebookSync.js` *(new)* | `catchUp(cursor, head)` — collapse the log to net changes, minus own, within budget; `fullRead()`; `checkAgainst(cursor, op)`; cursor load/save/validate (anchor still in history) |
| `src/lib/notebookTools.js` | `notebook_sync`, `notebook_read`, `notebook_edit` (with `revise`, `changes`) all through the sync; `notebookBrief` → stable titles block; `behindNote()` for the last message |
| `src/lib/agentMemory.js` *(new)* | `read`, `write`, `reveal` over Tauri or IndexedDB; the `my_memory` tool; template; history copies; migrating `state.notes` into each agent's file once |
| `src/lib/tools.js` | `remember`/`recall` become aliases into `agentMemory.js` |
| `src/lib/run.js` | `systemFor` takes the agent's memory text; the "behind" note added to the last user message for the request only |
| `src/App.jsx` | `notebookOf` ctx gains `chatId` and the history being sent (for the anchor check); save the notebook draft before a turn; keep `MEMORY.md` with agent delete/undo |
| `src/components/NotebookView.jsx` | draft markers, Save, ⌘S/⌘Z/⇧⌘Z, the 3 s out-of-focus timer, conflict markers, History panel |
| `src/components/AgentEditor.jsx` | the Memory section |
| `src-tauri/src/lib.rs` (+ a new `memory.rs`) | the three commands, path fixed to the app data directory |

## 7. Tests

In `test/notebook.test.mjs` and a new `test/sync.test.mjs`, without a browser
(the store already falls back when IndexedDB is missing):

- every commit raises `head` by one; live sections and moving widgets don't;
- a catch-up from v41 to v57 shows net changes, leaves out the agent's own, and
  says when someone undid them;
- an agent's `set` on a row changed after its cursor is refused with the
  current value, while another edit in the same call is saved;
- `revise` refuses when `old` occurs zero or two times;
- a cursor whose anchor message was compacted away gives a full read;
- user draft: three edits then a save make one version; the out-of-focus timer
  saves after 3 s and not if focus comes back at 2 s; an agent turn saves a
  pending draft first;
- rebase: an agent commit under a draft keeps the user's value and marks the
  clash;
- undo of an unsaved step makes no version; undo of a saved step makes a revert
  version and skips entries changed since;
- `my_memory` append/revise/remove; aliases for `remember`/`recall`; the
  migration from `state.notes` runs once.

## 8. Build order

1. **Versions and the log** — `head`, ops, commit, row ids, the upgrade. The
   current tools keep working on top.
2. **Sync** — cursors, catch-up, full read, the checks, the new tools, the
   "behind" note.
3. **Draft, save, undo/redo, history** — the user's side.
4. **`MEMORY.md`** — Rust commands, `agentMemory.js`, `my_memory`, the
   Customize section, migration of `state.notes`.

## 9. Decisions to confirm

1. **Out-of-focus delay: 3 s.** Short enough that agents are rarely behind,
   long enough to click away and back. Adjustable in Settings.
2. **One version per agent tool call**, not per turn — so a second agent in a
   group sees the first one's change at once, and each can be undone on its
   own.
3. **Cursor per agent per conversation**, not one per agent — the only way the
   "since v41" catch-up is always about something the agent can still see.
4. **⌘Z undoes only the user's own steps**; agents' changes are undone from
   History.
5. **`MEMORY.md` is in the prompt whole**, capped, rather than searched — it is
   the agent's working memory, not an archive.
