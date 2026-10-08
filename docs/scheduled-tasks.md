# Scheduled tasks -- plan

An agent can be asked to do something later: once ("remind me at 3 to call
Sam", "tomorrow at 9, check whether the order shipped") or again and again
("every weekday at 8, summarize my unread email", "every hour, tell me if the
build page changes"). Elsewhere these are called cron jobs, routines or
automations; in blvrd they are **scheduled tasks**, because "Reminders" already
means the Apple connector.

Nothing here is built yet. It is written for the same models as the rest of
blvrd: mostly local, on OpenAI-compatible servers, small windows, imperfect
tool calls.

---

## 1. What the reader sees

**In the chat.** You ask; the agent calls `schedule`; an Allow card shows what
the app understood, worked out by the app and not the model:

> **Morning brief** -- every weekday at 08:00
> *Summarize my unread email from the last day; list anything that needs a
> reply today.*
> Next: Thu 9 Oct, 08:00 · Uses: Gmail (read) · Posts here, and notifies
> **[Schedule]** **[Not now]**

At the time, the result arrives in that same chat as a message marked with a
clock and the task's name, and as a macOS notification. A task told to stay
quiet unless something is worth saying posts nothing on a dull run.

**Scheduled screen** (sidebar, next to Connectors). Every task: name, agent,
schedule in words, next run, last result, and Pause, Run now, Edit, Delete.
Each run's record (when, how long, ok or failed, what it said) is a click away.

**Calendar.** Upcoming runs appear on the calendar screen and widget as a
light second layer (`useMonthEvents.js` gains a "scheduled" source), so a
reader sees 8:00 "Morning brief" next to their meetings.

---

## 2. The tools

One ability, **Schedule**, tickable per agent like the others (Customize →
Abilities). Four tools, about 350 tokens of schema, all with the plain schema
subset from `docs/computer-providers.md` §6.

| Tool | Arguments | Does |
|---|---|---|
| `schedule` | `when`, `task`, `title?`, `quiet?` | Proposes a task; waits for the reader's Allow |
| `scheduled` | -- | Lists this agent's tasks, one line each, with ids |
| `change_schedule` | `id`, `when?`, `task?`, `pause?` | Edits or pauses one; waits for Allow |
| `unschedule` | `id` | Deletes one; waits for Allow |

The description of `schedule` carries the two rules that matter:

> Only when the user asks for something to happen later or repeatedly.
> `task` is read later by you **with none of this conversation**, so write
> everything it needs in it: names, addresses, what to check, what counts as
> worth reporting.

**`when` is the user's own words**, not a cron line and not a computed date.
Small models are poor at cron and worse at date arithmetic; copying "every
weekday at 8" is something any model does right. The app turns it into a rule
(§3). If it can't, the call fails with the forms it accepts, so the next try
lands:

```
schedule: couldn't read "8ish on workdays". Say it like:
  "in 20 minutes", "at 15:30", "tomorrow at 9am", "on 14 Oct at 18:00",
  "every day at 7", "every weekday at 8:00", "every Monday and Thursday at 9",
  "every 2 hours", "every month on the 1st at 9", "every hour until Friday"
```

**`quiet`**: on a quiet task the run may end with exactly `NOTHING_NEW` and
nothing is posted or notified -- the run is still recorded. This is what makes
"every hour, tell me if…" tolerable.

There is no separate "reminder" kind for the model to choose: a task whose
text is only a reminder ("Remind the user to call Sam") is run like any other,
and the model says it. One kind, one code path.

---

## 3. Times and rules -- `src/lib/when.js`

A small deterministic parser, no dependency, heavily tested:

```js
parseWhen("every weekday at 8:00", now)
// → { rule: { every: "week", days: [1,2,3,4,5], at: "08:00" },
//     words: "every weekday at 08:00", next: Date }
parseWhen("in 20 minutes", now)
// → { rule: { once: "2026-10-08T21:14:00" }, words: "today at 21:14", next }
```

Rule shapes, all in **local wall-clock time**:

```js
{ once: "2026-10-09T09:00" }
{ every: "minute" | "hour", n: 2 }                 // every 2 hours, from creation
{ every: "day", n: 1, at: "07:00" }
{ every: "week", days: [1, 4], at: "09:00" }       // Mon, Thu
{ every: "month", day: 1, at: "09:00" }            // day 31 → last day of short months
  + optional { until: "2026-10-10T23:59" } or { times: 5 }
```

- `nextAfter(rule, date)` computes the next run; tested across DST changes:
  a time that doesn't exist that night (02:30 in spring) runs at the first
  minute after; one that happens twice (autumn) runs once.
- Times float with the Mac: "8:00" means 8:00 wherever the Mac is. The zone at
  creation is kept and shown, so a change of zone can be pointed out.
- Smallest interval: 5 minutes. Most tasks per agent: 20 active.
- The words shown everywhere ("every weekday at 08:00") come from the rule,
  not from what the model sent, so the Allow card shows what will *really*
  happen.

---

## 4. What a run does

A run is a fresh, small turn, **not** a message in the long chat:

```
system:  the agent's usual system prompt (same bytes as in the chat)
         + "This is a scheduled task you set up on {date}: {title}.
            Do it now. If quiet and nothing is worth saying, reply NOTHING_NEW."
user:    {task}
         Last run ({when}): {last result, cut to ~300 tokens}
tools:   the agent's abilities
```

- **No chat history.** An hourly task re-sending a 20k-token chat 24 times a
  day would be the most expensive thing in the app, and slow on a local model.
  The task text was written to stand alone (§2), and the last result is
  enough for "has it changed?".
- **The result is appended to the chat** as an assistant message with
  `scheduled: { id, title }`, and the run's tool calls folded under it as
  today. Compaction and the next user turn see it like any other message.
- **Its own step limit** (`MAX_ROUNDS`, 8) and a time limit (10 minutes); a
  run that hits either is recorded as failed with what it got to.
- **The computer**: a run can use `computer_task` if the chat's computer is on
  (`docs/computer.md`). In the sandbox, as in the chat. On this Mac, see §6.
- **Model**: the agent's model, at the time of the run. If that model's server
  isn't reachable, the run waits (§5) rather than failing on the spot.

---

## 5. When runs happen

**Who keeps time.** A thread in Rust (`src-tauri/src/schedule.rs`), not a
webview timer: webview timers are throttled when the window is hidden, and
macOS App Nap slows background apps further. The webview hands Rust the list
of next-run times whenever it changes; Rust sleeps until the soonest, checks
the wall clock every 30 s (so a sleep or a clock change is noticed), and emits
`schedule-due` with the ids. The webview runs them. Rust holds an activity
assertion while a run is due or running so App Nap leaves it alone.

**One at a time, the reader first.** Today one turn runs at a time
(`running.current` in `App.jsx`). Scheduled runs go into a queue that starts
only when nothing is running, and a run never interrupts the reader. A local
model serves one request at a time anyway; a background run must not make the
reader's own message wait. If the reader starts typing while a run is going on
a *local* server, the run is let finish -- it is short by construction.

**The app has to be running.** Closing the main window quits today
(`lib.rs`). With any active task, closing the window instead leaves blvrd in
the menu bar (a tray icon: Open, Scheduled…, Pause all, Quit), and says so
once. A setting turns this off.

**Missed runs** -- the Mac was asleep or blvrd was quit:

| Task | On next chance |
|---|---|
| Once, missed by less than 12 hours | Runs, marked "due 08:00, ran 09:12" |
| Once, missed by more | Not run; the chat gets "Missed: …" with a Run now button |
| Repeating, missed one or many times | Runs **once**, then carries on from the next normal time |

**Optional, later: start blvrd for a task.** A per-user LaunchAgent
(`~/Library/LaunchAgents/us.stivers.blvrd.schedule.plist`) with
`StartCalendarInterval` set to the next run, rewritten whenever that changes,
opening blvrd in the background. Waking a sleeping Mac needs administrator
rights (`pmset`), so that is not offered.

**Failures.** Network or model server down → retry at 1, 5 and 15 minutes,
then failed. Three failed runs in a row → the task pauses itself and tells the
chat why.

---

## 6. Approvals when nobody is watching

Tools that act (`confirm` in `lib/run.js`: sending mail, adding events,
Home Assistant, MCP tools not marked read-only) normally wait for Allow in the
chat. A run at 3 a.m. has no one to ask.

- When the task is scheduled, the Allow card lists the acting tools the agent
  has (Gmail send, Calendar add…) with a tick for each: **"May do these
  without asking when it runs"**. Unticked by default. The ticks are kept on
  the task, not as a global "always allow".
- At run time, a call to an acting tool that was ticked runs; one that wasn't
  is not made -- the run carries on, and the result says "wanted to send an
  email to … -- open the chat to allow it", with Allow that runs that one
  call then.
- Computer on **This Mac**: `shell` and outside-workspace writes never run
  unattended unless ticked the same way; the sandbox needs nothing.
- The model can't widen this: `change_schedule` can change `when` and `task`,
  never the ticks. Only the reader, on the Scheduled screen.

---

## 7. Token and time cost, per run

| Part | Tokens |
|---|---|
| System prompt and tools (identical to the chat's, so a local server or hosted cache can reuse a prefix it has seen) | as the chat |
| Task text | 50-200 |
| Last result | ≤ 300 |
| Tool calls and results | as needed, budgets from `docs/computer.md` §6 |
| A quiet run with nothing new | ends after one short reply |

The four Schedule tools themselves add about 350 tokens to every turn of an
agent that has the ability; an agent that doesn't need it can have it off.

---

## 8. Stored

`store.js` gains:

```js
schedules: [{
  id, agentId, chatId,                 // chatId: an agent's id, or a group's
  title, task, quiet,
  words, rule, zone,                   // "every weekday at 08:00", {…}, "Europe/London"
  allow: ["gmail_send"],               // acting tools ticked for unattended runs
  paused: false,
  next: 1760000000000,
  createdAt, createdIn: messageId,     // the message the Allow card belongs to
  failures: 0,
  runs: [{ at, ms, ok, posted, summary, messageId }]   // last 20
}]
```

Deleting an agent deletes its tasks (after the existing undo toast). Clearing
a chat leaves them, and says how many there are.

In a **group chat**, a task belongs to the agent that made it, and its result
is posted in the group as that agent.

---

## 9. Files

| File | Change |
|---|---|
| `src/lib/when.js` (new) | parse words → rule; `nextAfter`; rule → words |
| `src/lib/schedule.js` (new) | the four tools, the run (prompt above), the queue, missed-run rules |
| `src-tauri/src/schedule.rs` (new) | the timer thread, `schedule-due`, App Nap assertion |
| `src-tauri/src/lib.rs` | tray icon; closing the window keeps the app while tasks are active |
| `src-tauri/Cargo.toml` | `tauri` `tray-icon` feature; `tauri-plugin-notification` |
| `src/lib/store.js` | `schedules` |
| `src/App.jsx` | the run queue beside `running.current`; posting results; notifications |
| `src/components/Chat.jsx` | the Allow card's schedule preview and unattended ticks; the clock mark on results |
| `src/components/Scheduled.jsx` (new) | the Scheduled screen |
| `src/lib/useMonthEvents.js`, calendar | upcoming runs as a layer |
| `test/when.test.mjs`, `test/schedule.test.mjs` (new) | below |

---

## 10. Tests

- `when.js`: every form in the error message, and the near misses small models
  send ("every week day at 8", "8am every weekday", "at 9 tomorrow", 24h and
  12h times, "noon", "midnight"); `nextAfter` across both DST changes, month
  ends, leap day, `until` and `times`.
- A run against the fake Ollama from `test/run.test.mjs`: the prompt has the
  task and the last result and no chat history; `NOTHING_NEW` on a quiet task
  posts nothing; an unticked acting tool is not run and the result says so.
- The queue: a due run waits while the reader's turn runs, then runs; two due
  at once run one after the other; a missed repeating task runs once.
- A full turn where the model calls `schedule` with a wrapped or misspelled
  argument (repaired by `heal.js`) and the Allow card gets the parsed rule.

---

## 11. Order

1. `when.js` and its tests.
2. Store, tools, Allow card with the preview -- tasks can be made, listed and
   changed, nothing runs yet.
3. The Rust timer, the queue, runs posting into the chat, notifications.
4. Unattended approvals.
5. Scheduled screen, tray, missed runs.
6. Calendar layer; LaunchAgent (optional).

Steps 1-3 are a usable feature on their own for anything that doesn't act
(reading, checking, summarizing, reminding).

---

## Decisions this plan makes (change any of them)

- `when` is the user's phrase, parsed by the app, not cron or a date the model
  computes.
- A run sees the task and the last result, not the chat.
- Results go into the chat they came from, plus a notification.
- Acting tools don't run unattended unless ticked for that task.
- blvrd stays in the menu bar while tasks are active, rather than a separate
  background service.
