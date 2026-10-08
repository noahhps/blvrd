# Memory for blvrd agents — a proposal

Status: proposal, nothing built yet. Builds on the Notebook (`src/lib/notebook.js`,
`src/lib/notebookTools.js`) rather than replacing it.

How the Notebook itself is versioned and synced between agents and the user —
version keys, per-agent cursors, drafts, undo/redo — and each agent's own
`MEMORY.md` are designed in detail in **`docs/notebook-sync.md`**. Where the two
differ (the section `log` in §3.2, per-agent private sections in §3.2 and §6),
that document wins.

## In one paragraph

Keep the Notebook as the one place memory lives and the one place the user
looks. Make every line in it *answerable* — who wrote it, when, from which
message, until when it holds — and give it four quiet helpers around it: a
**tidy-up** that reads finished chats and proposes notebook changes (checked
against the words actually said), a **diary** of dated day pages that keeps
the episodes the notebook doesn't, an **index** that lets agents find any of it
without a tool call, and a **forget** that takes a fact out everywhere and
keeps it out. Agents read a budgeted slice of the notebook every turn instead
of having to remember to look. Nothing leaves the machine that the user hasn't
marked as allowed to.

---

## 1. What there is today

| Piece | Where | What it does | What's missing |
|---|---|---|---|
| **The Notebook** | `lib/notebook.js` (IndexedDB) | User-made sections — facts, lists, notes, free text, live widgets. Shared by every agent. `version` + `seen[agentId]` tell an agent when someone else changed a section. An "agents ask first" switch. | No provenance (which message a row came from). No history or undo of agent edits. Agents can't add a section, so anything that doesn't fit an existing one is dropped. Nothing ever expires. |
| **Notebook tools** | `lib/notebookTools.js` | `notebook_contents`, `notebook_read`, `notebook_edit`, always on. | The prompt lists section *titles* only (`notebookBrief`). The agent must decide to call `notebook_read` — the step small local models most often skip. |
| **Per-agent notes** | `lib/tools.js` `remember` / `recall`, `state.notes` in localStorage | One-sentence notes per agent, substring search. | A second, invisible memory: no screen shows these notes, the user can't edit or delete them, and they duplicate the Notebook. |
| **Compaction** | `lib/compact.js` | Folds an old stretch of a chat into a summary message. | Episodes live only inside their own chat's summary. "What did we decide last Tuesday?" can't be answered from another chat. The summary keeps no pointers back to the messages it replaced. |
| **Learning** | — | Only happens if, mid-answer, the agent chooses to call `notebook_edit`. | No pass after the conversation that notices what was learned. |

The Notebook already gets several things right that the bigger systems
struggle with, and the proposal keeps them:

- **The user owns the structure.** Sections are made by the user; memory is a
  page they can read, not a hidden vector store.
- **Typed sections with checked edits.** `apply()` validates every edit the same
  way for hand and tool, and the error text teaches the model. Structured,
  narrow operations are exactly what small models can do reliably.
- **Change awareness between agents.** `changedBy()` is a cheap version of what
  multi-agent memory systems call write attribution.
- **Live sections.** Calendar, music, setup are read like memory but kept by the
  app — the right split between *remembered* and *looked up*.

---

## 2. What other systems teach

Sources are listed at the end of this section. The pages of most commercial
products couldn't be fetched directly, so their descriptions come from search
summaries of their docs and coverage — read them as *probably right*, not
verified. The open-source ones (Mem0, Letta, Graphiti, LangMem, Generative
Agents, Anthropic's memory tool) were read from source or docs.

### 2.1 Meta's Muse (from the diagram)

Seven parts, two loops:

- **Hot path** — the live agent writes `MEMORY.md` (curated facts,
  preferences, commitments) and dated `memory/YYYY-MM-DD.md` notes straight away.
- **Hourly consolidation, only when there's new signal** — extracted claims are
  *checked against the chat messages*, each stored with a quote, message ids,
  kind and salience. Durable claims are promoted; the rest stay in the daily
  log; newer claims supersede older ones (`supersedes_claim_id`).
- **Derived, source-cited markdown** — `bank/world.md`, `experience.md`,
  `opinions.md`, `reflections.md`, plus `people/` and `groups/` pages kept by
  relationship jobs. Every line points back to a source file and line.
- **An index** in Postgres: chunks with `memory://` URIs and a privacy class,
  384-dim embeddings, and a `claims` table (evidence, confidence, status,
  supersedes).
- **Nightly "dreams"** — a prose review of recent interactions, distilled into
  `ALIGNMENT_SYNTHESIS.md` (preferences, boundaries, current friction, how to
  respond) plus structured companions (`REPAIR_THREADS.yaml`, …). The dream
  prose itself is **not** injected (`prompt_hoisted: false`); only the
  synthesis guides later conversations.
- **Recall**: `memory_search` returns claim ids; `memory_explain` returns the
  evidence and citations.
- **Forgetting** is its own workflow: stage claim ids, retract the claim and
  everything derived from it (banks, people pages, dreams, synthesis), rebuild
  the index, and *keep later jobs from restoring removed facts*.

**Take:** verified claims with quotes; promote-durable / log-the-rest;
supersession; citations on everything derived; raw reflections never
injected, only the distilled guidance; forgetting that follows derivations and
sticks. **Leave:** two stores that must be kept in sync (files *and*
Postgres), and four overlapping "bank" files — for one person on one laptop,
the Notebook plus one index is enough.

### 2.2 Grok

*Grok Bot* (Aug 2026) makes the agent, not the chat, the unit: each Bot has
its own memory — "stable preferences, role context, and summaries of prior
work", reportedly kept as a profile plus dated logs. Team Bots split memory
into **team memory** (read by everyone; written only when someone says the
whole team should know, and the write is announced) and **per-person notes**.
A skill taught in one person's chat becomes a *draft* that the owner promotes.
The docs call memory **advisory**: "for important decisions, ask the Bot to
check the current source rather than relying on memory." Weak spot: no screen
to view or edit individual memories. The older *Grok chat memory* (2025) shows,
under each answer, which past chats it drew on, with a per-item Forget, and a
private mode that neither reads nor writes memory.

**Take:** scopes with explicit promotion between them; advisory framing;
"sources used" under an answer; a private chat that doesn't touch memory.

### 2.3 Dots

*OpenAI Dots* (Sep 2026): persistent agents that inherit the user's ChatGPT
memory, then keep **private notes** of their own — including on what they read
in connected apps unprompted. Background research is read-only; anything that
acts goes through a proceed / ask / hand-back review. But individual memories
can't be viewed, edited or deleted — only the whole dot reset — and
disconnecting an app keeps what was learned from it. It is the clearest
example of what not to ship.

*New Computer's Dot* (2023–2025), the companion app, published the most useful
lessons: memories are **structured at write time** (with `status` and dates
usable as filters), retrieval is **hybrid** (semantic + BM25 + metadata,
+50% recall / +40% precision over semantic alone), and the prompt merges an
**always-present "theory of mind" of the user** with episodic summaries
(pulled in by time-based questions), entity records and procedures. They
measured on synthetic users with labelled relevant memories. They also found
users won't maintain an entity database by hand, and that a memory should be
written with "what this means for future behaviour".

**Take:** an always-in profile plus retrieved detail; status/dates on items as
filters; hybrid retrieval; a synthetic-user eval set; tag everything with
where it came from, so revoking a source can remove what was learned from it.

### 2.4 Manus and Cue

*Cue by Manus* (Sep 2026) gives each agent its own conversation and memory,
lets agents share a group chat and hand work over, and advertises "Memory and
Dream" — the latter undocumented, most likely offline consolidation. The solid
material is Manus's **context-engineering** write-up:

- keep the prompt prefix stable and serialisation deterministic, so the
  KV-cache hits (cached tokens ~10× cheaper — and on local hardware, far faster);
- mask tools rather than removing them mid-session;
- treat files as unlimited external memory, and compress *restorably* — drop
  the content, keep the path or URL;
- recite the task list at the end of context to keep goals in attention (later
  moved to a planner, because it cost a third of all actions);
- leave errors in context.

*Manus Knowledge* caps the user's knowledge base at 50–100 entries (more
degrades quality); each entry reportedly has a **"when to use"** trigger and an
on/off switch.

**Take:** cache-stable prompt layout; restorable compression; a "when to use"
line and an on/off switch per section; a size budget.

### 2.5 The rest, briefly

| System | Mechanism | Take |
|---|---|---|
| **ChatGPT** | Saved memories (editable) + implicit chat-history reference; since 2026 a background "Dreaming" pass rebuilds a categorised summary and *ages* facts (a future trip becomes past). "Don't mention this again" suppresses without deleting. Temporary chats skip memory. | Background re-synthesis; aging; suppress ≠ delete; sources per answer |
| **Claude** | Memory tool: the model edits files under `/memories` (`view`, `create`, `str_replace` that must match exactly once, …), stored by the app; told to view memory before anything else. App memory is a daily synthesis, scoped per project. | Exact-match edits small models can do; project scoping |
| **Letta / MemGPT** | Core memory = labelled blocks (description + character limit) always in context; `memory_insert` (append, safe for many writers), `memory_replace` (fails if the text changed), `memory_rethink` (rewrite). Recall = conversation search; archival = vector store. Sleep-time agent ("dreaming") consolidates; MemFS keeps memory in git. | Different tools for different write safety; one consolidator; history of every edit |
| **Mem0** | Extract facts → fetch similar → LLM emits ADD / UPDATE / DELETE / NONE. The newer path is **add-only with links** to superseded memories, and resolves relative dates against the observation date. | Ops lists; supersede with links, don't silently delete; absolute dates |
| **Zep / Graphiti** | Temporal graph: facts carry `valid_at` / `invalid_at`, are invalidated not deleted, and keep the raw episode as provenance. Hybrid retrieval. | Valid-from / valid-until on every fact |
| **Generative Agents** | Memory stream; score = 0.5·recency + 3·relevance + 2·importance (each normalised; recency decays 0.99 per step); **reflection fires when summed importance passes a threshold**. | The ranker; importance-triggered reflection |
| **LangMem** | Semantic memory as a **profile** (one document updated in place, easy for a user to edit) or a **collection**; episodic and procedural memory; hot-path tools *and* a debounced background manager. | Facts sections are profiles, lists/notes collections; debounce |

### 2.6 What they agree on

1. **Memory the user can't see is a liability** (Dots), memory they can edit is
   trusted (ChatGPT, Grok's Forget, the Notebook already).
2. **Learn in the background, off the answer** — Muse hourly, Letta sleep-time,
   ChatGPT Dreaming, LangMem's manager, Cue's Dream.
3. **Structured ops beat free rewrites** — Mem0's events, Letta's insert vs
   replace, Claude's exact-match `str_replace`, the Notebook's `apply()`.
4. **Evidence and time on every fact** — Muse quotes, Graphiti validity
   windows, Mem0 links.
5. **Supersede, don't delete; but forget thoroughly when asked** — Graphiti and
   Mem0 vs Muse's forget workflow.
6. **A small always-in core, the rest retrieved** — Letta blocks, Dot's theory
   of mind, Manus's knowledge budget.
7. **Hybrid retrieval with filters** — Dot's numbers, Graphiti, Muse.
8. **Reflection produces guidance, not just facts** — Muse's synthesis,
   Generative Agents' reflections, Dot's "what this means for future
   behaviour" — and the raw reflection stays out of the prompt.
9. **Scopes and promotion** — Grok team vs personal, Cue per-agent, Claude
   projects.
10. **The prompt layout is a performance feature** — Manus.

Sources: x.ai/news/designing-grok-bot · docs.x.ai/grok-bot (overview, team-bots,
faq) · datacamp.com/blog/grok-bot · techcrunch.com/2025/04/16/xai-adds-a-memory-feature-to-grok ·
help.openai.com/en/articles/20001529 · thenextweb.com (OpenAI Dots, DevDay) ·
langchain.com/blog/customers-new-computer · leverage.to/learn/dev/ai_memory/sam ·
manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus ·
manus.im/blog/introducing-manus-2-0 · help.manus.im (knowledge base limit) ·
openai.com/index/memory-and-new-controls-for-chatgpt ·
platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool ·
docs.letta.com · github.com/letta-ai/letta-code · github.com/mem0ai/mem0 (`configs/prompts.py`) ·
arxiv.org/abs/2504.19413 · github.com/getzep/graphiti · arxiv.org/abs/2501.13956 ·
github.com/joonspk-research/generative_agents · github.com/langchain-ai/langmem

---

## 3. The design

### 3.1 Layers

```
                 ┌──────────────────────────────────────────────┐
  every turn     │  THE NOTEBOOK  (curated, user-visible)        │  ← injected, budgeted
                 │  sections → entries with provenance & expiry  │
                 │  + Inbox (proposals)  + "Working with you"     │
                 └───────▲───────────────────────▲──────────────┘
                         │ propose / apply       │ distil (weekly)
                 ┌───────┴────────┐      ┌───────┴──────────────┐
  after a chat   │   TIDY-UP      │      │   DIARY               │  ← searched, not injected
  goes quiet     │ extract → verify│      │ day pages per chat    │
                 │ quote → ops    │──────▶ with message citations│
                 └───────▲────────┘      └───────▲──────────────┘
                         │                       │
                 ┌───────┴───────────────────────┴──────────────┐
  always         │  CHATS (raw episodes, already kept)           │
                 └──────────────────────────────────────────────┘
                 ┌──────────────────────────────────────────────┐
  on write       │  INDEX  BM25 (+ local embeddings if present)  │  ← pre-turn recall,
                 │  over entries, day pages, messages            │    memory_search
                 └──────────────────────────────────────────────┘
                 ┌──────────────────────────────────────────────┐
  on request     │  FORGET  retract + tombstone + reindex        │
                 └──────────────────────────────────────────────┘
```

One rule ties it together: **the Notebook is the only thing injected as
standing knowledge.** The diary, the index and chat history are evidence an
agent can search; they never speak in the agent's prompt on their own. (Muse
arrives at the same rule — its nightly "dream" prose is `prompt_hoisted:
false`; only the distilled synthesis guides responses.)

### 3.2 The entry: every line answerable

Rows (facts), items (lists) and notes gain a small `meta`. Existing sections
read fine without it; it fills in as things are written.

```js
// a facts row, a list item, or a note (whole text)
{
  key: "Sister's birthday", value: "14 March",        // as today
  meta: {
    by: "agt_planner" | "user" | "tidy",               // who wrote it
    at: 1759900000000,                                  // when
    src: [{ chat: "agt_planner", msg: "m_x1", quote: "my sister's birthday is the 14th of March" }],
    how: "said" | "inferred",                           // stated by the user, or concluded
    hush: false,                                        // "don't bring this up": kept, not injected
    until: null | 1760500000000,                        // stops holding (trip, this week's focus)
    was: [{ value: "15 March", by: "user", at: …, until: … }],   // superseded values
  },
}
```

```js
// a section gains
{
  …,
  use: "When planning trips or gifts",   // "when to use": shown to agents beside the title
  on: true,                              // off: kept, but no agent sees it
  pin: false,                            // always in the prompt (§3.3)
  trust: "edit" | "suggest" | "read",   // replaces the single global `approve` switch
  scope: { agents: null | [agentId],   // null: every agent; a list: only these
           local: false },             // true: never sent to a hosted model
  log: [{ op, entry, before, after, by, at }],   // last ~100 changes, for undo & "what changed"
}
```

- **Provenance is automatic, not asked of the model.** The tool `ctx` already
  carries `agentId`; it gains `chatId` and the id of the user message being
  answered. `notebook_edit` attaches `src` itself. The model may *optionally*
  pass `quote`; if it does, the quote is checked against that message and
  dropped (with a note back) if it isn't there.
- **Supersede, don't overwrite.** A `set` on an existing key moves the old value
  into `was` with `until: now` — Zep/Graphiti's valid-from/valid-until idea at
  the scale of one row. "What was my old address?" stays answerable; the prompt
  only ever shows the current value.
- **Expiry.** `until` lets "I'm in Lisbon this week" fade by itself. Expired
  entries drop out of the prompt and show greyed in the Notebook with a
  one-click "still true".
- **`local: true`** is the local-first idea none of the hosted systems need: a
  section the user marks *keep on this computer* is left out of the prompt —
  and out of search results — whenever the agent's model is hosted
  (`catalog.js` already knows which servers are). Health, money, other people.
- **Per-agent scope** replaces the invisible per-agent `notes`: an agent's
  private memory is just a section scoped to it, visible and editable like any
  other. Moving an entry from a private section into a shared one is a
  promotion the user makes (Grok's team memory works this way).
- **"When to use" and an on/off switch** per section (Manus Knowledge). The
  `use` line is what the agent reads beside the title, so a section explains
  itself; switching a section off keeps it but hides it from every agent.
- **Hush, not delete.** "Don't bring this up" (ChatGPT) keeps an entry for the
  record but leaves it out of the prompt — for things that are true but
  sensitive or tiresome. Forgetting (§3.8) is the other, stronger action.
- **Where it came from, including connectors.** If what an agent learned came
  from a connector's tool result (an email, a calendar event), `src` records the
  connector. Disconnecting it then offers to forget what was learned from it —
  the gap Dots leaves open, where revoking an app keeps what was read.

### 3.3 Reading: memory that arrives without being asked for

Today an agent sees section titles and must call `notebook_read`. Small models
mostly don't. Instead, `notebookBrief()` becomes `memoryBlock(agent, message,
budget)`, assembled before each turn:

1. **Standing** — sections the user pins (and "Working with you", §3.6),
   rendered with `asText`, current values only. Always in, in a fixed order.
2. **Relevant** — entries and day-page lines the index ranks highest for the
   user's latest message, each tagged with where it lives
   (`[Notebook › About › Birthday]`, `[Diary 3 Oct, with Planner]`).
3. **The rest** — titles of the remaining sections, as today, so the agent knows
   what it can `notebook_read`.

The block opens with one line of framing, taken from Grok Bot's docs: *these
are notes, possibly out of date; before acting on one that matters (sending,
paying, booking), check the source.*

Budget: ~10% of the agent's context (derive from `compactAtOf`), standing
first, then relevant until full. Ranking for (2) is Generative Agents'
*recency × importance × relevance*: relevance from the index, recency from
`meta.at` with a slow decay, importance from pinned/section weight and how
often the entry has been used. Status and due dates on list items work as
filters (Dot's lesson: metadata filters beat similarity alone for "what's open
this week?").

**Cache-friendly ordering.** Local servers (Ollama, llama.cpp) reuse the
KV-cache for an unchanged prompt prefix, and hosted ones bill a cached prefix
for less. So: the system prompt keeps the stable parts (who the agent is, its
instructions, the standing sections) at the top and byte-identical between
turns; the per-message *relevant* block goes last, after the summary. The
serialisation is deterministic (same order, no timestamps in the stable part),
and the tool list stays the same for the whole chat. This is the first lesson in
Manus's context-engineering write-up; on a laptop running a local model, a
cache hit means the server doesn't re-read thousands of tokens of prompt before
it starts answering.

**Private chats.** A chat can be started private: it neither reads memory nor
leaves anything in it — no tidy-up, no diary (Grok, ChatGPT and Claude all
have this).

The tools stay for going deeper:

| Tool | Change |
|---|---|
| `notebook_contents`, `notebook_read` | unchanged; `read` shows `until` and "(was …)" where present |
| `notebook_edit` | attaches provenance; optional `quote`, `until`; respects `trust` (edit / ask / refuse). Notes gain an exact-match `revise` (`old` → `new`, fails unless `old` occurs once — Claude's `str_replace`, Letta's `memory_replace`), so an agent no longer has to `replace` a whole note to change a sentence, and two agents can't silently overwrite each other |
| `notebook_suggest` *(new)* | propose a new section, or an entry for a section the agent may only suggest to — lands in the **Inbox** |
| `memory_search` *(new)* | search notebook, diary and old messages; results carry citations |
| `memory_source` *(new)* | given an entry or diary line, return the original message(s) around it — Muse's `memory_explain`, and Manus's "compress, but keep it restorable" |
| `remember`, `recall` | retired: `remember` becomes an alias for `notebook_suggest` into the Inbox (heal.js already maps near-names), `recall` for `memory_search` |

### 3.4 Writing: the tidy-up

Learning mid-answer stays, but stops being the only way. When a chat has been
quiet for ~10 minutes (or is compacted, or the app is about to quit), a
**tidy-up** job runs over the messages since that chat's checkpoint:

1. **Extract.** One narrow call to the agent's own model (or a "memory model"
   chosen in Settings — a small local model is fine), with a JSON schema
   (Ollama's `format`, Anthropic tools, OpenAI `response_format`). Input: the
   new messages with their ids, the current notebook as text, the tombstones.
   Output, Mem0-style, a list of operations:
   ```json
   [{ "op": "set", "section": "About", "key": "Sister's birthday",
      "value": "14 March", "msg": "m_x1",
      "quote": "my sister's birthday is the 14th of March",
      "how": "said", "until": null, "importance": 2 },
    { "op": "add", "section": "Gift ideas", "item": "Film camera for Ana", … },
    { "op": "new_section", "title": "Running", "type": "facts", … },
    { "op": "none" }]
   ```
2. **Verify.** Each op's `quote` must occur (normalised for case/whitespace) in
   message `msg`, and `msg` must be from the user unless `how` is `inferred`.
   Ops that fail are dropped, not repaired — this one check removes most
   hallucinated memories, which matter more with small models. Relative dates
   ("next Friday", "in two weeks") are resolved to absolute ones against the
   message's own date before anything is written (Mem0). Ops that match a
   tombstone are dropped. Ops are run through `apply()` against a copy, so a
   bad action fails the same way it would for a tool.
3. **Land.** Per section `trust`: `edit` applies it (marked `by: "tidy"`, with
   the agent's colour), `suggest` puts it in the Inbox, `read` drops it. New
   sections always go to the Inbox. Low-value candidates that aren't durable
   ("wants pizza tonight") go to the day page instead (Muse: *promote durable
   details; keep the rest in daily logs*).
4. **Receipt.** Each run writes a line to a memory activity log: chat, model,
   ops proposed / applied / rejected and why. The Notebook's "What changed"
   view reads from this and from the section `log`s.

Checkpoint per chat (`lastConsolidated: messageId`) means each message is
tidied once; a crash re-runs from the checkpoint; the job is cancellable and
never runs while the user is waiting on that model.

### 3.5 The diary: episodes, not facts

The notebook holds what's *true*; the diary holds what *happened*. Once a day
(first launch of a day, for the previous day), and also whenever a chat is
compacted, a day page is written per chat that had activity:

```
Diary › 7 Oct 2026 › with Planner
- Planned the Lisbon trip; settled on 14–18 Oct, flights not booked yet. [m_a1, m_a7]
- User asked to keep mornings meeting-free. → Notebook › Work (tidy) [m_b2]
- Open: find a hotel near Alfama under €150. [m_c4]
```

Each line cites the messages it came from, so `memory_source` can open them.
Day pages are indexed and searchable; they are never injected wholesale. They
make "what did we decide last week?" answerable across chats, and they give
compaction something better than a dead end: the compaction summary can end
with pointers into the diary and the original messages instead of being the
only record.

### 3.6 Reflection: "Working with you"

When enough has been learned — the summed `importance` of what the tidy-up
wrote since the last reflection passes a threshold (Generative Agents' trigger,
rather than a timer) — or on demand, a reflection pass reads the last week's diary and the
Notebook's recent changes and proposes edits to one fixed note section,
**Working with you** — standing guidance on how the user likes to be answered:
format, length, tone, what annoyed them, what to stop doing, open threads to
come back to. This is Muse's `ALIGNMENT_SYNTHESIS.md`, Generative Agents'
reflections and Letta's sleep-time agent, reduced to one short section the user
can read and edit. It goes through the Inbox the first time and whenever it
changes by more than a few lines, and it is pinned into the standing block.
The reasoning that produced it stays in the activity log, not the prompt — the
same line Muse draws between dream prose and its synthesis. New Computer's Dot
found the same from the other side: a memory is most useful written down with
*what it means for how to behave next time*.

### 3.7 The index

A small local search over notebook entries, diary lines and chat messages,
kept in IndexedDB and updated on write:

- **BM25** in plain JS (no dependency) — works everywhere, instantly.
- **Embeddings when available**: if an Ollama server has an embedding model
  (`nomic-embed-text`, `all-minilm`, `embeddinggemma`), vectors via
  `/api/embed`, cosine similarity in JS, blended with BM25 (reciprocal-rank
  fusion). A few thousand 384–768-dim vectors is a few MB — no vector DB
  needed. If none is present, Settings offers to pull one; nothing is ever sent
  to a hosted embedding API unless the user picks one.
- Results respect `scope` and `local` exactly as the prompt does.

### 3.8 Forgetting

"Forget" on an entry, a section, a diary line, or a message ("forget what was
learned from this"):

1. Collect everything linked by provenance: the entry and its `was` history,
   diary lines citing the same messages, Inbox proposals, index rows, and lines
   in "Working with you" that came from it.
2. Show the list, remove on confirm (optionally the source messages too).
3. Write a **tombstone** — the section/key and a normalised hash of the quote —
   so a later tidy-up re-reading old messages doesn't learn it again. This is
   the step most memory systems leave out and Muse's diagram calls out
   explicitly ("keep later jobs from restoring removed facts").
4. Reindex.

Undo for ordinary edits comes from the section `log`; forgetting is the
deliberate, thorough version.

### 3.9 In the interface

- Entries an agent wrote show its colour as a small dot; hovering shows *"From
  your chat with Planner, 7 Oct: 'my sister's birthday is the 14th of March'"*,
  and clicking opens that message.
- **Inbox** — a fixed section at the top of the Notebook (and an optional
  sidebar widget) with proposals: accept, edit, dismiss, "always allow for this
  section" (which flips its `trust` to `edit`). Grok Bot's draft skills and
  team-memory promotion work this way: the agent proposes, the user decides.
- Each section's menu: *Agents may edit / suggest / only read*, *Only these
  agents…*, *Keep on this computer*.
- **What changed** — a feed of recent edits and tidy-up receipts, with undo.
- In a chat, a memory the agent used is shown like a tool step ("Used 2
  notebook entries"), collapsed, so the user can see why it knew something.

---

## 4. Small local models — what the design does for them

| Problem | Answer here |
|---|---|
| Forget to call memory tools | Memory is injected before the turn (§3.3); tools are for depth only |
| Call tools wrong | Same `apply()` validation + `heal.js` repair; retired names alias to new tools |
| Invent memories | Tidy-up ops must quote the user's own words, checked verbatim (§3.4) |
| Small context | Budgeted memory block; diary and index searched, not stuffed |
| Slow prefill | Stable prompt prefix for KV-cache reuse; volatile memory last |
| Weak at open-ended judgement | Extraction is one narrow, schema-constrained job, not a side-task during chat |

---

## 5. Storage

All local, as now. The Notebook keeps its IndexedDB database (`blvrd-notebook`),
with `meta`, `trust`, `scope` and `log` added to sections. A second database,
`blvrd-memory`:

| Store | Holds |
|---|---|
| `days` | `{ id, date, chatId, lines: [{ text, cites: [msgId] }] }` |
| `index` | `{ id, kind: "entry"|"day"|"message", ref, text, terms, vec?, at }` |
| `tombstones` | `{ section, key, quoteHash, at }` |
| `jobs` | per-chat checkpoints; activity log (receipts) |

Chats stay in `state.chats`; legacy `state.notes` migrates once (§6) and is
then left empty.

---

## 6. Migration

1. Each agent's `state.notes[agentId]` becomes a list section **"Notes from
   ‹Agent›"**, scoped to that agent, with `meta.at` from each note's `at` and
   `by` the agent. The user now sees them for the first time — say so once, in a
   notice.
2. `remember` / `recall` are removed from `TOOLS`; their names are kept as
   aliases so an agent with them in `agent.tools` keeps working.
3. `settings.approve` maps to `trust: "suggest"` on every section if it was on,
   `"edit"` if off.
4. Existing rows/items get no `meta` — they display as before ("written before
   the notebook kept sources").

---

## 7. Building it, in order

Each phase is useful on its own.

| Phase | Scope | Touches |
|---|---|---|
| **1. Answerable notebook** | `meta` on writes (by/at/src), section `log` + undo, `was` on supersede, `until`, per-section `trust` replacing `approve`, `use` line + on/off, exact-match `revise` for notes, migrate per-agent notes, retire `remember`/`recall` | `notebook.js`, `notebookTools.js`, `tools.js`, `App.jsx` (`notebookOf` ctx gains chatId/messageId), `NotebookView.jsx` |
| **2. Memory in the prompt** | `memoryBlock()` with standing + titles and a token budget; `local` scope honoured for hosted models; cache-stable ordering; hush; private chats | `notebookTools.js`, `run.js` (`systemFor`), `App.jsx` |
| **3. Tidy-up + Inbox** | idle-triggered extraction, quote verification, ops → `apply()`, Inbox UI, activity log | new `lib/tidy.js`, `NotebookView.jsx`, `providers.js` (structured output per adapter) |
| **4. Index + recall** | BM25, optional Ollama embeddings, relevant block in `memoryBlock`, `memory_search`, `memory_source` | new `lib/recall.js`, `providers.js` (`embed`) |
| **5. Diary + reflection** | day pages, compaction pointers, "Working with you" | new `lib/diary.js`, `compact.js` |
| **6. Forget** | provenance walk, tombstones, confirm UI | `notebook.js`, `lib/recall.js`, `NotebookView.jsx`, `Chat.jsx` |

### Testing

In the style of `test/run.test.mjs` (a fake Ollama), plus — as New Computer
did — a small set of synthetic users: a written backstory, a few weeks of
scripted chats, and questions labelled with the memories that should answer
them, to tune the ranker and budget against real local models. Checks for

- **recall** — the fact is in the memory block / answered correctly next chat;
- **precision** — a tidy-up given a conversation with no facts proposes none,
  and a hallucinated quote is rejected;
- **supersession** — a changed fact shows the new value, the old one in `was`;
- **expiry** — an `until` in the past drops out of the block;
- **scope** — a `local` section never reaches a hosted provider's request body;
- **forgetting** — a forgotten fact, re-tidied from its original message, stays
  gone.

---

## 8. Open questions

1. **Which model tidies?** The agent's own (consistent voice, but a hosted
   model would see the chat again) or one "memory model" for all (simpler,
   local by default). Proposal: a Settings choice, defaulting to the default
   model if it's local, otherwise asking.
2. **Group chats.** One tidy-up per group chat, attributed to the group, or one
   per agent from its own seat? Proposal: per group, `by: "tidy"`, citing the
   group's messages.
3. **How much "Working with you"?** It is the most powerful and the most
   presumptuous piece. Proposal: off until the user turns it on, and always via
   the Inbox.
4. **Section creation by agents** — Inbox-only forever, or allowed once the user
   has accepted a few? Proposal: Inbox-only; it's the user's page.
