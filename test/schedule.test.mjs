/* Scheduled tasks (lib/schedule.js): what a run leaves behind, when the next
 * one is due, what a model is told about runs it wasn't asked for, and a
 * whole turn where a small model schedules something -- slightly wrong, the
 * way small models do. */

process.env.TZ = "Europe/London";

import { test } from "node:test";
import assert from "node:assert/strict";

import { viewFor } from "../src/lib/group.js";
import { runTurn } from "../src/lib/run.js";
import {
  MISSED_AFTER_MS,
  afterRun,
  dueTasks,
  isMissed,
  isNothingNew,
  makeSchedule,
  reportOf,
  runPrompt,
  scheduleTools,
  soonest,
  withPause,
  withReports,
} from "../src/lib/schedule.js";

const NOW = new Date(2026, 9, 8, 20, 54); // Thu 8 Oct 2026, 20:54
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const task = (when, extra = {}) => makeSchedule({ agentId: "a1", chatId: "a1", when, task: "Summarize my unread email.", ...extra }, NOW);

test("a task is made from the words, named from its first sentence when it has no name", () => {
  const s = task("every weekday at 8");
  assert.equal(s.words, "every weekday at 08:00");
  assert.equal(s.next, at(2026, 10, 9, 8));
  assert.equal(s.title, "Summarize my unread email");
  assert.deepEqual(s.allow, []);
  assert.throws(() => task("8ish on workdays"), /couldn't read "8ish"/);
});

test("after a good run: the next time, the result kept for next time, failures cleared", () => {
  const s = { ...task("every weekday at 8"), failures: 2 };
  const after = afterRun(s, { ok: true, text: "3 emails need a reply.", posted: true, ms: 4000 }, at(2026, 10, 9, 8, 1));
  assert.equal(after.next, at(2026, 10, 12, 8), "Friday's run done, Monday next");
  assert.equal(after.failures, 0);
  assert.equal(after.count, 1);
  assert.deepEqual(after.last, { at: at(2026, 10, 9, 8, 1), text: "3 emails need a reply." });
  assert.equal(after.runs.at(-1).posted, true);
});

test("a task with a number of times, or a one-off, is finished when they're done", () => {
  const once = task("in 20 minutes");
  assert.equal(afterRun(once, { ok: true, text: "done" }, once.next).done, true);
  // Run early (Run now): it doesn't run again at its time.
  const early = afterRun(once, { ok: true, text: "done" }, once.next - 10 * 60_000);
  assert.deepEqual([early.done, early.next], [true, null]);
  let twice = task("every day at 9 2 times");
  twice = afterRun(twice, { ok: true, text: "1" }, twice.next);
  assert.equal(twice.done, false);
  twice = afterRun(twice, { ok: true, text: "2" }, twice.next);
  assert.equal(twice.done, true);
  assert.equal(twice.next, null);
});

test("failures are tried again at 1, 5 and 15 minutes, and the third pauses it", () => {
  let s = task("every day at 7");
  const t = s.next;
  s = afterRun(s, { ok: false, error: "Ollama isn't answering" }, t);
  assert.equal(s.retryAt, t + 60_000);
  s = afterRun(s, { ok: false, error: "Ollama isn't answering" }, s.retryAt);
  assert.equal(s.retryAt, t + 60_000 + 5 * 60_000);
  assert.equal(dueTasks([s], s.retryAt)[0]?.id, s.id, "due again at the retry");
  s = afterRun(s, { ok: false, error: "Ollama isn't answering" }, s.retryAt);
  assert.equal(s.paused, true);
  assert.equal(dueTasks([s], Date.now() + 1e10).length, 0);
  // Resumed: from the next normal time, with a clean slate.
  const back = withPause(s, false, at(2026, 10, 10, 12));
  assert.equal(back.paused, false);
  assert.equal(back.failures, 0);
  assert.equal(back.next, at(2026, 10, 11, 7));
});

test("missed: a one-off long overdue isn't run late; a repeating task runs once and carries on", () => {
  const once = task("tomorrow at 9am");
  assert.equal(isMissed(once, once.next + 60 * 60_000), false, "an hour late still runs");
  assert.equal(isMissed(once, once.next + MISSED_AFTER_MS + 1), true);
  const missed = afterRun(once, { missed: true, ok: false }, once.next + MISSED_AFTER_MS + 1);
  assert.equal(missed.done, true);
  assert.equal(missed.runs.at(-1).missed, true);

  const daily = task("every day at 7");
  assert.equal(isMissed(daily, daily.next + 5 * 86_400_000), false);
  const caught = afterRun(daily, { ok: true, text: "ok" }, daily.next + 5 * 86_400_000 + 3_600_000);
  assert.equal(caught.next, daily.next + 6 * 86_400_000, "the next normal 07:00, not five runs to catch up");
});

test("a stopped run passes that time over without counting against the task", () => {
  const s = task("every day at 7");
  const after = afterRun(s, { skipped: true }, s.next + 1000);
  assert.equal(after.failures, 0);
  assert.equal(after.next, s.next + 86_400_000);
  assert.equal(after.runs.at(-1).summary, "Stopped.");
});

test("what's due comes soonest first, and paused or finished tasks never are", () => {
  const a = { ...task("every day at 7"), next: 200 };
  const b = { ...task("every day at 8"), next: 100 };
  const c = { ...task("every day at 9"), next: 50, paused: true };
  assert.deepEqual(dueTasks([a, b, c], 300).map((s) => s.next), [100, 200]);
  assert.equal(soonest([a, b, c]), 100);
  assert.equal(soonest([c]), null);
});

test("a run is told the task and what it said last, not the chat", () => {
  const s = { ...task("every hour", { quiet: true, title: "Build watch" }), last: { at: at(2026, 10, 8, 19, 54), text: "Build 412 is green." } };
  const { context, message } = runPrompt(s, { now: new Date(at(2026, 10, 8, 20, 54)), allowed: [] });
  assert.match(context, /scheduled task you set up/);
  assert.match(context, /reply with exactly NOTHING_NEW/);
  assert.match(context, /\(none are\)/);
  assert.match(message, /^Summarize my unread email\./);
  assert.match(message, /What the last run said \(today at 19:54\):\nBuild 412 is green\./);
  assert.ok(isNothingNew("NOTHING_NEW"));
  assert.ok(isNothingNew("  NOTHING_NEW. "));
  assert.ok(!isNothingNew("Nothing new, but the build is red."));
});

test("what a run posted is folded into the reader's next message, so turns still alternate", () => {
  const s = task("every weekday at 8", { title: "Morning brief" });
  const chat = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    reportOf(s, { text: "3 emails need a reply.", now: at(2026, 10, 9, 8) }),
    { role: "user", content: "which ones?" },
  ];
  const out = withReports(chat);
  assert.deepEqual(out.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(out[2].content, /^\[Since then, your scheduled task “Morning brief” ran \(.*08:00\) and posted:\]\n3 emails need a reply\.\n\nwhich ones\?$/);

  // In a group: kept beside the message, then placed before the reader's words.
  const group = withReports(
    [{ role: "user", content: "hi" }, { ...reportOf(s, { text: "3 emails.", agentId: "a1" }) }, { role: "user", content: "which?" }],
    { keep: true, nameOf: () => "Sam" },
  );
  const seen = viewFor("a2", group, () => "Sam");
  assert.equal(seen.length, 1);
  assert.match(seen[0].content, /\[User\]: hi\n\n\[Since then, Sam's scheduled task “Morning brief” ran.*\n3 emails\.\n\n\[User\]: which\?/s);
});

/* -- whole turns, against a fake Ollama ----------------------------------------------- */

function ndjsonResponse(objects) {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const o of objects) controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}
const call = (name, args) => [{ message: { role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] }, done: true }];
const say = (text) => [{ message: { role: "assistant", content: text }, done: true }];
const OLLAMA = { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" };

function fakeOps() {
  const list = [];
  return {
    list: () => list,
    add: (s) => list.push(s),
    patch: (id, fn) => list.splice(list.findIndex((s) => s.id === id), 1, fn(list.find((s) => s.id === id))),
    remove: (id) => list.splice(list.findIndex((s) => s.id === id), 1),
    acting: () => [{ name: "gmail_send", label: "Gmail: send" }],
  };
}

test("a time the app can't read goes back to the model without asking; the next try shows the reader what was read", async (t) => {
  const replies = [
    call("schedule", { when: "8ish on workdays", task: "Summarize my unread email." }),
    // Wrapped and misspelled, as small models send them.
    call("functions.schedule", { arguments: { When: "every weekday at 8", task: "Summarize my unread email.", title: "Morning brief" } }),
    say("Done -- every weekday at 8."),
  ];
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return ndjsonResponse(replies.shift());
  });
  const ops = fakeOps();
  const asked = [];
  const results = [];
  await runTurn({
    agent: { name: "Sam", tools: null },
    provider: OLLAMA,
    model: "qwen3",
    history: [{ role: "user", content: "every weekday at 8 summarize my unread email" }],
    available: scheduleTools(ops),
    notebook: { agentId: "a1", chatId: "a1" },
    approve: async (request) => {
      asked.push(request);
      return { allow: ["gmail_send"] };
    },
    emit: (e) => e.type === "message" && e.message.role === "tool" && results.push(e.message),
  });

  assert.equal(asked.length, 1, "asked once, for the call that could work");
  assert.match(results[0].content, /schedule failed: couldn't read "8ish on workdays".*Say it like/s);
  assert.equal(results[0].error, true);
  const preview = asked[0].preview;
  assert.equal(preview.kind, "schedule");
  assert.equal(preview.words, "every weekday at 08:00");
  assert.equal(preview.title, "Morning brief");
  assert.deepEqual(preview.acting, [{ name: "gmail_send", label: "Gmail: send" }]);
  assert.equal(ops.list().length, 1);
  assert.deepEqual(ops.list()[0].allow, ["gmail_send"], "the ticks on the card are kept on the task");
  assert.match(results[1].content, /^Scheduled “Morning brief” \(s\w+\): every weekday at 08:00\. Next:/);
  // The schedule tools' schemas go out as plain objects of strings and a boolean.
  const schema = sent[0].tools.find((x) => x.function.name === "schedule").function.parameters;
  assert.deepEqual(Object.values(schema.properties).map((p) => p.type), ["string", "string", "string", "boolean"]);
});

test("unattended, a tool not allowed for the task is turned down with the reason the model is given", async (t) => {
  const replies = [call("send_it", { to: "sam@example.com" }), say("I would have emailed Sam.")];
  t.mock.method(globalThis, "fetch", async () => ndjsonResponse(replies.shift()));
  let ran = false;
  const results = [];
  await runTurn({
    agent: { name: "Sam", tools: null },
    provider: OLLAMA,
    model: "qwen3",
    history: [{ role: "user", content: "the task" }],
    available: [{ name: "send_it", label: "Send it", confirm: true, description: "Send.", parameters: { type: "object", properties: { to: { type: "string" } }, required: ["to"] }, run: () => (ran = true) }],
    approve: async () => ({ declined: "Send it didn't run: the user hasn't allowed it for this scheduled task." }),
    emit: (e) => e.type === "message" && e.message.role === "tool" && results.push(e.message),
  });
  assert.equal(ran, false);
  assert.equal(results[0].declined, true);
  assert.equal(results[0].content, "Send it didn't run: the user hasn't allowed it for this scheduled task.");
});

test("an agent finds its task by name as well as id, and only its own", async () => {
  const ops = fakeOps();
  const [, list, change, remove] = scheduleTools(ops);
  ops.add({ ...task("every day at 7", { title: "Weather" }), agentId: "a1" });
  ops.add({ ...task("every day at 8", { title: "Other's" }), agentId: "a2" });
  assert.match(list.run({}, { agentId: "a1" }), /“Weather”: every day at 07:00 · next .* at 07:00/);
  assert.doesNotMatch(list.run({}, { agentId: "a1" }), /Other's/);
  change.check({ id: "weather" }, { agentId: "a1" });
  assert.throws(() => change.check({ id: "Other's" }, { agentId: "a1" }), /no scheduled task "Other's"\. Yours are:/);
  assert.match(change.run({ id: "Weather", pause: true }, { agentId: "a1" }), /· paused/);
  assert.match(remove.run({ id: "Weather" }, { agentId: "a1" }), /Removed “Weather”/);
  assert.equal(ops.list().length, 1);
});
