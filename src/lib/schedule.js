/* Tasks: an agent asked to do something later, once or again and
 * again -- "every weekday at 8, summarize my unread email", "in 20 minutes,
 * remind me to call Sam". See docs/tasks.md.
 *
 *   schedules  [{ id, agentId, chatId, title, task, quiet, words, rule, zone,
 *                 allow, paused, done, next, retryAt, failures, count,
 *                 createdAt, last: { at, text }, runs: [{ at, ms, ok, posted,
 *                 missed, summary }] }]
 *
 * The reader's words are read by lib/when.js. A run is a small turn of its
 * own -- the task and what the last run said, never the long chat -- and what
 * it says is posted in the chat it was made in, as a { role: "scheduled" }
 * message. Those are folded into the next message the reader sends
 * (`withReports`), so a model is told what ran while it wasn't asked, and a
 * chat template that wants turns to alternate still gets them alternating.
 *
 * The tools here wait for the reader's Allow (`confirm`), which shows what the
 * app read the words as -- so a task the reader didn't ask for, or a time read
 * wrong, is caught before it is kept. "Always allow" isn't offered for them. */

import { WhenError, momentWords, nextAfter, parseWhen } from "./when.js";

export const SCHEDULE_GROUP = "schedule";
export const MAX_ACTIVE = 20; // per agent
export const MISSED_AFTER_MS = 12 * 60 * 60 * 1000; // a one-off this late isn't run
export const RETRY_MINUTES = [1, 5, 15];
export const PAUSE_AFTER_FAILURES = 3;
export const RUN_LIMIT_MS = 10 * 60 * 1000;
export const KEEP_RUNS = 20;
export const NOTHING_NEW = "NOTHING_NEW";

const newId = () => `s${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
const clip = (text, limit) => {
  const s = String(text || "").trim();
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
};

/** A short name for a task, from its first words, when none was given. */
export function titleOf(task) {
  const first = String(task || "").trim().split(/(?<=[.!?])\s|\n/)[0].replace(/[.!?]+$/, "");
  return clip(first, 40) || "Task";
}

export const isActive = (s) => !s.paused && !s.done;

/** When `s` is next due: a retry, if one is waiting, else its next run. */
export const dueAt = (s) => (s.retryAt ?? s.next ?? null);

/** The tasks due by `now`, soonest first. */
export function dueTasks(schedules, now = Date.now()) {
  return (schedules || []).filter((s) => isActive(s) && dueAt(s) != null && dueAt(s) <= now).sort((a, b) => dueAt(a) - dueAt(b));
}

/** The soonest time anything is due, or null. */
export function soonest(schedules) {
  const times = (schedules || []).filter(isActive).map(dueAt).filter((t) => t != null);
  return times.length ? Math.min(...times) : null;
}

/** A one-off whose time went by long ago -- blvrd wasn't running, the Mac was
 *  asleep -- isn't run late; repeating tasks run once and carry on. */
export const isMissed = (s, now = Date.now()) => Boolean(s.rule?.once) && !s.retryAt && now - s.next > MISSED_AFTER_MS;

/** A new task, from the words and the reader's answer on the Allow card. */
export function makeSchedule({ agentId, chatId, when, task, title, quiet, allow = [] }, now = new Date()) {
  const { rule, words, next } = parseWhen(when, now);
  return {
    id: newId(),
    agentId,
    chatId,
    title: clip(title, 60) || titleOf(task),
    task: String(task).trim(),
    quiet: Boolean(quiet),
    words,
    rule,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    allow,
    paused: false,
    done: false,
    next: next.getTime(),
    retryAt: null,
    failures: 0,
    count: 0,
    createdAt: now.getTime(),
    last: null,
    runs: [],
  };
}

/** `s` after a run: when it's next due, how many failures in a row, and the
 *  run kept on its record. `outcome`: { ok, text?, posted?, error?, ms }, or
 *  { missed } for a one-off that came too late, or { skipped } for one the
 *  reader stopped -- that time is passed over, nothing counted against it. */
export function afterRun(s, outcome, now = Date.now()) {
  const run = {
    at: now,
    ms: outcome.ms || 0,
    ok: Boolean(outcome.ok),
    posted: Boolean(outcome.posted),
    ...(outcome.missed ? { missed: true } : {}),
    summary: clip(outcome.ok ? outcome.text : outcome.skipped ? "Stopped." : outcome.error, 200),
  };
  const runs = [...(s.runs || []), run].slice(-KEEP_RUNS);
  if (outcome.missed) return { ...s, runs, done: true, retryAt: null };
  if (outcome.skipped) {
    const next = s.rule.once ? null : nextAfter(s.rule, new Date(now));
    return { ...s, runs, retryAt: null, next: next ? next.getTime() : null, done: !next };
  }
  if (!outcome.ok) {
    const failures = (s.failures || 0) + 1;
    if (failures >= PAUSE_AFTER_FAILURES) return { ...s, runs, failures, paused: true, retryAt: null };
    return { ...s, runs, failures, retryAt: now + RETRY_MINUTES[failures - 1] * 60_000 };
  }
  const count = (s.count || 0) + 1;
  // A one-off is finished once it has run, even if it was run early.
  const next = s.rule.once || (s.rule.times && count >= s.rule.times) ? null : nextAfter(s.rule, new Date(now));
  return {
    ...s,
    runs,
    count,
    failures: 0,
    retryAt: null,
    last: { at: now, text: clip(outcome.text, 1200) },
    next: next ? next.getTime() : null,
    done: !next,
  };
}

/** `s` paused, or carried on from now. A one-off whose time went by while it
 *  was paused runs at once. */
export function withPause(s, paused, now = Date.now()) {
  if (paused) return { ...s, paused: true, retryAt: null };
  const next = nextAfter(s.rule, new Date(now));
  return { ...s, paused: false, failures: 0, retryAt: null, next: next ? next.getTime() : s.rule.once && !s.count ? now : null, done: !next && !(s.rule.once && !s.count) };
}

/* -- a run ------------------------------------------------------------------------ */

export const isNothingNew = (text) => new RegExp(`^\\W*${NOTHING_NEW}\\W*$`).test(String(text || "").trim());

/** What a run is told: the line for the end of the system prompt, and its one
 *  message. The task was written to stand alone; the last result is what a
 *  "tell me if it changes" task compares against. */
export function runPrompt(s, { now = new Date(), allowed = [] } = {}) {
  const created = new Date(s.createdAt);
  const context = [
    `This is a scheduled task you set up on ${momentWords(created, now)}: “${s.title}”, ${s.words}. It is running now, ${momentWords(now, now)}. Nobody is waiting in the chat: do the task with your tools, then write what to post to the user.`,
    s.quiet ? `If there is nothing worth telling the user this time, reply with exactly ${NOTHING_NEW} and nothing else.` : "",
    `Tools that send, add or change something run only if the user allowed them for this task${allowed.length ? `: ${allowed.join(", ")}` : " (none are)"}; anything else, say what you would have done.`,
  ]
    .filter(Boolean)
    .join(" ");
  const last = s.last?.text ? `\n\nWhat the last run said (${momentWords(new Date(s.last.at), now)}):\n${s.last.text}` : "";
  return { context, message: `${s.task}${last}` };
}

/** The message a run leaves in the chat. */
export function reportOf(s, { text, steps = [], wanted = [], now = Date.now(), agentId = null }) {
  const blocked = wanted.length
    ? `Wanted to ${[...new Set(wanted)].join(", ")} -- not allowed for this task, so it didn't. Tick it for this task on the Tasks screen to let it.`
    : "";
  return {
    role: "scheduled",
    scheduled: { id: s.id, title: s.title, words: s.words, at: now },
    content: String(text || "").trim(),
    ...(steps.length ? { steps } : {}),
    ...(blocked ? { note: blocked } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

/** What's said in the chat about a one-off that was missed. */
export function missedOf(s, now = Date.now()) {
  return {
    role: "scheduled",
    scheduled: { id: s.id, title: s.title, words: s.words, at: now, missed: true },
    content: "",
    note: `Missed “${s.title}”, due ${momentWords(new Date(s.next), new Date(now))}: blvrd wasn't running then. Run it from the Tasks screen if it's still wanted.`,
    ...(s.agentId ? { agentId: s.agentId } : {}),
  };
}

/** The chat as a model is sent it: each scheduled run's report folded into
 *  the reader's next message, as a line saying what ran. With `keep`, it is
 *  put on the message as `before` instead -- a group's view (lib/group.js)
 *  places it. `nameOf`: in a group, whose task it was. */
export function withReports(messages, { keep = false, nameOf = null } = {}) {
  const out = [];
  let pending = [];
  for (const m of messages) {
    if (m.role === "scheduled") {
      if (m.content?.trim()) {
        const whose = nameOf && m.agentId ? `${nameOf(m.agentId)}'s` : "your";
        const when = m.scheduled?.at ? ` (${momentWords(new Date(m.scheduled.at))})` : "";
        pending.push(`[Since then, ${whose} scheduled task “${m.scheduled?.title || "a task"}” ran${when} and posted:]\n${clip(m.content, 1500)}`);
      }
      continue;
    }
    if (m.role === "user" && pending.length) {
      const before = pending.join("\n\n");
      pending = [];
      out.push(keep ? { ...m, before } : { ...m, content: [before, m.content].filter(Boolean).join("\n\n") });
      continue;
    }
    out.push(m);
  }
  return out;
}

/* -- the tools ------------------------------------------------------------------------ */

const lineOf = (s, now = new Date()) => {
  const state = s.done ? "finished" : s.paused ? "paused" : s.next ? `next ${momentWords(new Date(dueAt(s)), now)}` : "";
  return `- ${s.id} “${s.title}”: ${s.words}${state ? ` · ${state}` : ""}${s.quiet ? " · quiet" : ""}`;
};

/* The task meant by `id`: its id, or -- small models send what they can see
 * -- its title, when only one has it. */
function find(ops, ctx, id) {
  const mine = ops.list().filter((s) => s.agentId === ctx.agentId);
  const key = String(id || "").trim().toLowerCase().replace(/^[“"']|[”"']$/g, "");
  const found = mine.find((s) => s.id.toLowerCase() === key) || (() => {
    const named = mine.filter((s) => s.title.toLowerCase() === key);
    return named.length === 1 ? named[0] : null;
  })();
  if (!found) {
    throw new Error(`there is no scheduled task "${id}"${mine.length ? `. Yours are:\n${mine.map((s) => lineOf(s)).join("\n")}` : " -- you have none"}`);
  }
  return found;
}

const WHEN = {
  type: "string",
  description: "When, in the user's own words -- don't work out a date: \"in 20 minutes\", \"tomorrow at 9am\", \"every weekday at 8\", \"every 2 hours\", \"every month on the 1st\".",
};

/** The four Schedule tools. `ops` is the app's: list(), add(s), patch(id, fn),
 *  remove(id), acting(ctx) -> [{ name, label }] (the agent's tools that act). */
export function scheduleTools(ops) {
  const group = { group: SCHEDULE_GROUP, groupLabel: "Tasks", logo: null };
  return [
    {
      name: "schedule",
      label: "Schedule a task",
      ...group,
      confirm: true,
      noAlways: true,
      description:
        "Set up something for you to do later, once or repeatedly. Only when the user asks for something to happen at a time or regularly. `task` is read later by you with none of this conversation, so put everything in it: names, addresses, what to check, what is worth reporting.",
      parameters: {
        type: "object",
        properties: {
          when: WHEN,
          task: { type: "string", description: "What to do then, complete on its own, as an instruction to yourself." },
          title: { type: "string", description: "A short name, e.g. Morning brief (optional)." },
          quiet: { type: "boolean", description: "True to post only when there is something worth telling the user (optional)." },
        },
        required: ["when", "task"],
      },
      check: (args, ctx) => {
        if (!String(args.task || "").trim()) throw new Error("the task is empty -- say what to do");
        parseWhen(args.when);
        if (ops.list().filter((s) => s.agentId === ctx.agentId && isActive(s)).length >= MAX_ACTIVE) {
          throw new Error(`you already have ${MAX_ACTIVE} scheduled tasks; ask the user which to remove first`);
        }
      },
      preview: (args, ctx) => {
        const { words, next } = parseWhen(args.when);
        return { kind: "schedule", title: clip(args.title, 60) || titleOf(args.task), words, next: momentWords(next), task: String(args.task).trim(), quiet: Boolean(args.quiet), acting: ops.acting(ctx) };
      },
      summary: (args) => `schedule “${clip(args.title, 60) || titleOf(args.task)}”`,
      run: (args, ctx) => {
        const allow = Array.isArray(ctx.approval?.allow) ? ctx.approval.allow : [];
        // `postTo`: made during a scheduled run, it belongs to that run's chat.
        const s = makeSchedule({ agentId: ctx.agentId, chatId: ctx.postTo || ctx.chatId, when: args.when, task: args.task, title: args.title, quiet: args.quiet, allow });
        ops.add(s);
        return `Scheduled “${s.title}” (${s.id}): ${s.words}. Next: ${momentWords(new Date(s.next))}. What it finds will be posted in this chat${s.quiet ? " when there is something worth saying" : ""}.`;
      },
    },
    {
      name: "scheduled",
      label: "List tasks",
      ...group,
      description: "Your scheduled tasks: id, name, when, and when each runs next.",
      parameters: { type: "object", properties: {}, required: [] },
      run: (_, ctx) => {
        const mine = ops.list().filter((s) => s.agentId === ctx.agentId);
        return mine.length ? mine.map((s) => lineOf(s)).join("\n") : "You have no scheduled tasks.";
      },
    },
    {
      name: "change_schedule",
      label: "Change a task",
      ...group,
      confirm: true,
      noAlways: true,
      description: "Change, pause or resume one of your scheduled tasks. Give only what changes.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The task's id from `scheduled`, or its name." },
          when: WHEN,
          task: { type: "string", description: "The new instruction, complete on its own." },
          title: { type: "string", description: "A new short name." },
          pause: { type: "boolean", description: "True to pause, false to resume." },
        },
        required: ["id"],
      },
      check: (args, ctx) => {
        find(ops, ctx, args.id);
        if (args.when) parseWhen(args.when);
        if (args.task != null && !String(args.task).trim()) throw new Error("the task can't be empty");
      },
      summary: (args) => {
        const changes = [args.when && `run ${args.when}`, args.task && "do something new", args.title && `be called “${args.title}”`, args.pause === true && "pause", args.pause === false && "resume"].filter(Boolean);
        return `change scheduled task ${args.id}${changes.length ? ` to ${changes.join(", ")}` : ""}`;
      },
      preview: (args, ctx) => {
        const s = find(ops, ctx, args.id);
        const parsed = args.when ? parseWhen(args.when) : null;
        return {
          kind: "schedule",
          change: true,
          title: clip(args.title, 60) || s.title,
          words: parsed ? parsed.words : s.words,
          next: args.pause === true ? "paused" : momentWords(parsed ? parsed.next : new Date(dueAt(s) || Date.now())),
          task: args.task ? String(args.task).trim() : s.task,
          quiet: s.quiet,
        };
      },
      run: (args, ctx) => {
        const s = find(ops, ctx, args.id);
        ops.patch(s.id, (old) => {
          let next = { ...old };
          if (args.when) {
            const parsed = parseWhen(args.when);
            next = { ...next, rule: parsed.rule, words: parsed.words, next: parsed.next.getTime(), retryAt: null, done: false, count: 0 };
          }
          if (args.task) next.task = String(args.task).trim();
          if (args.title) next.title = clip(args.title, 60);
          if (args.pause != null) next = withPause(next, Boolean(args.pause));
          return next;
        });
        const now = ops.list().find((x) => x.id === s.id);
        return `Changed: ${lineOf(now)}`;
      },
    },
    {
      name: "unschedule",
      label: "Remove a task",
      ...group,
      confirm: true,
      noAlways: true,
      description: "Delete one of your scheduled tasks for good.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The task's id from `scheduled`, or its name." } },
        required: ["id"],
      },
      check: (args, ctx) => {
        find(ops, ctx, args.id);
      },
      summary: (args) => `remove the scheduled task ${args.id}`,
      run: (args, ctx) => {
        const s = find(ops, ctx, args.id);
        ops.remove(s.id);
        return `Removed “${s.title}”.`;
      },
    },
  ];
}

export { WhenError };
