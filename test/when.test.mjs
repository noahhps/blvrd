/* Reading when a scheduled task runs (lib/when.js): the words small models
 * pass on, the rule they make, and the next time it comes round -- across
 * the clocks changing, short months and leap years. */

// Before any date is made: London has both clock changes, an hour each.
process.env.TZ = "Europe/London";

import { test } from "node:test";
import assert from "node:assert/strict";

import { WhenError, describe, nextAfter, parseWhen } from "../src/lib/when.js";

const NOW = new Date(2026, 9, 8, 20, 54); // Thu 8 Oct 2026, 20:54
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
const read = (text, now = NOW) => parseWhen(text, now);

test("the forms the error message offers all read, as the reader would say them back", () => {
  const cases = {
    "in 20 minutes": ["today at 21:14", at(2026, 10, 8, 21, 14)],
    "at 15:30": ["tomorrow at 15:30", at(2026, 10, 9, 15, 30)],
    "tomorrow at 9am": ["tomorrow at 09:00", at(2026, 10, 9, 9)],
    "on 14 Oct at 18:00": ["Wed 14 Oct at 18:00", at(2026, 10, 14, 18)],
    "every day at 7": ["every day at 07:00", at(2026, 10, 9, 7)],
    "every weekday at 8:00": ["every weekday at 08:00", at(2026, 10, 9, 8)],
    "every Monday and Thursday at 9": ["every Monday and Thursday at 09:00", at(2026, 10, 12, 9)],
    "every 2 hours": ["every 2 hours, from today at 22:54", at(2026, 10, 8, 22, 54)],
    "every month on the 1st at 9": ["every month on the 1st at 09:00", at(2026, 11, 1, 9)],
    "every hour until Friday": ["every hour, from today at 21:54, until tomorrow at 23:59", at(2026, 10, 8, 21, 54)],
  };
  for (const [text, [words, next]] of Object.entries(cases)) {
    const got = read(text);
    assert.equal(got.words, words, text);
    assert.equal(got.next.getTime(), next.getTime(), text);
  }
});

test("near misses small models send read the same", () => {
  const same = [
    ["every week day at 8", "every weekday at 08:00"],
    ["8am every weekday", "every weekday at 08:00"],
    ["Every weekday at 8 A.M.", "every weekday at 08:00"],
    ["weekdays at 8", "every weekday at 08:00"],
    ["on workdays at 08:00", "every weekday at 08:00"],
    ["at 9 tomorrow", "tomorrow at 09:00"],
    ["9am tomorrow", "tomorrow at 09:00"],
    ["tomorrow 9", "tomorrow at 09:00"],
    ["tomorrow @ 9:00", "tomorrow at 09:00"],
    ["mondays at 10", "every Monday at 10:00"],
    ["every mon, wed and fri at 7pm", "every Monday, Wednesday and Friday at 19:00"],
    ["in 1h30m", "today at 22:24"],
    ["in an hour and a half", "today at 22:24"],
    ["in 90 mins", "today at 22:24"],
    ["in half an hour", "today at 21:24"],
    ["every half hour", "every half hour, from today at 21:24"],
    ["daily", "every day at 09:00"],
    ["every morning", "every day at 09:00"],
    ["every evening", "every day at 18:00"],
    ["noon tomorrow", "tomorrow at 12:00"],
    ["2026-10-20 07:30", "Tue 20 Oct at 07:30"],
    ["Oct 20th at 7:30pm", "Tue 20 Oct at 19:30"],
    ["the 14th", "Wed 14 Oct at 09:00"],
    ["on the 1st of every month", "every month on the 1st at 09:00"],
    ["weekends at 10am", "every weekend day at 10:00"],
    ["every other week on tuesday at 9", "every other week on Tuesday at 09:00"],
  ];
  for (const [text, words] of same) assert.equal(read(text).words, words, text);
});

test("a bare hour: afternoon from 1 to 6 when it repeats, the next one when it doesn't", () => {
  assert.equal(read("every day at 5").rule.at, "17:00");
  assert.equal(read("every day at 7").rule.at, "07:00");
  assert.equal(read("every day at 17").rule.at, "17:00");
  // At 10:00, "at 3" is this afternoon; at 20:54 it's the small hours.
  assert.equal(read("at 3", at(2026, 10, 8, 10)).words, "today at 15:00");
  assert.equal(read("at 3").words, "tomorrow at 03:00");
  assert.equal(read("tomorrow at 3pm").words, "tomorrow at 15:00");
});

test("limits: until, for, and a number of times", () => {
  assert.deepEqual(read("every day at 9 5 times").rule.times, 5);
  assert.equal(read("every 30 min for 3 days").rule.until, "2026-10-11T23:59");
  assert.equal(read("every day at 8 until 14 Oct").rule.until, "2026-10-14T23:59");
  const rule = read("every day at 8 until 10 Oct").rule;
  assert.equal(nextAfter(rule, at(2026, 10, 10, 8)), null);
  assert.equal(nextAfter(rule, at(2026, 10, 9, 9)).getTime(), at(2026, 10, 10, 8).getTime());
});

test("what can't be read says why, and how to say it", () => {
  for (const [text, why] of [
    ["8ish on workdays", /couldn't read "8ish"/],
    ["remind me at 5", /couldn't read "remind me"/],
    ["every 2 minutes", /every 5 minutes/],
    ["in 5 minutes every day", /can't be said together/],
    ["", /empty/],
    ["on 31 Feb", /no such date/],
  ]) {
    assert.throws(() => read(text), (e) => e instanceof WhenError && why.test(e.message) && /Say it like: "in 20 minutes"/.test(e.message), text);
  }
});

test("a one-off that has passed comes round no more", () => {
  const { rule } = read("in 20 minutes");
  assert.equal(nextAfter(rule, at(2026, 10, 8, 21, 14)), null);
});

test("clocks going back: 01:30 that happens twice runs once", () => {
  // Sun 25 Oct 2026, London: 02:00 BST becomes 01:00 GMT.
  const rule = { every: "day", n: 1, at: "01:30", from: "2026-10-20" };
  const first = nextAfter(rule, at(2026, 10, 25, 0, 0));
  assert.equal(first.getDate(), 25);
  const after = nextAfter(rule, first);
  assert.equal(after.getDate(), 26, "not the second 01:30 an hour later");
});

test("clocks going forward: 01:30 that never happens runs at 02:00", () => {
  // Sun 28 Mar 2027, London: 01:00 GMT becomes 02:00 BST.
  const rule = { every: "day", n: 1, at: "01:30", from: "2027-03-20" };
  const next = nextAfter(rule, at(2027, 3, 28, 0, 0));
  assert.deepEqual([next.getDate(), next.getHours(), next.getMinutes()], [28, 2, 0]);
  assert.equal(nextAfter(rule, next).getHours(), 1, "the day after is back to 01:30");
});

test("every hour stays an hour apart across a clock change", () => {
  const rule = { every: "hour", n: 1, from: "2026-10-25T00:00" };
  let t = at(2026, 10, 25, 0, 0);
  for (let i = 0; i < 4; i++) {
    const next = nextAfter(rule, t);
    assert.equal(next - t, 3_600_000);
    t = next;
  }
});

test("month ends and leap days", () => {
  const last = { every: "month", n: 1, day: 31, at: "09:00", from: "2026-01-01" };
  assert.equal(nextAfter(last, at(2027, 2, 1)).getDate(), 28);
  assert.equal(nextAfter(last, at(2028, 2, 1)).getDate(), 29);
  assert.equal(nextAfter(last, at(2027, 4, 1)).getDate(), 30);
  assert.equal(describe(last), "every month on the last day at 09:00");
  const leap = read("every year on 29 feb").rule;
  assert.equal(nextAfter(leap, at(2027, 3, 1)).getTime(), at(2028, 2, 29, 9).getTime());
  assert.equal(nextAfter(leap, at(2026, 10, 8)).getDate(), 28, "28 Feb in a year without the 29th");
});

test("every other day and week count from when they were made", () => {
  const days = read("every 2 days").rule;
  assert.equal(nextAfter(days, at(2026, 10, 10, 9)).getDate(), 12);
  const weeks = read("every other week on tuesday at 9").rule;
  const first = nextAfter(weeks, NOW);
  const second = nextAfter(weeks, first);
  // Fourteen days on the calendar, at the same time of day -- the clocks go
  // back in between, so not 14 × 24 hours.
  assert.equal(Math.round((second - first) / 86_400_000), 14);
  assert.equal(second.getHours(), 9);
});
