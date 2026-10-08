import { test } from "node:test";
import assert from "node:assert/strict";

import { byDay, daysOf, fromApple, fromGoogle, heatOf, monthGrid, shiftMonth } from "../src/lib/calendar.js";

test("a month is laid out Monday first, in whole weeks", () => {
  const grid = monthGrid({ year: 2026, month: 9 }); // October 2026 starts on a Thursday
  assert.equal(grid.length, 5);
  assert.ok(grid.every((w) => w.length === 7));
  assert.deepEqual(grid[0].map((d) => [d.day, d.inMonth]).slice(2, 4), [[30, false], [1, true]]);
  assert.equal(grid[0][0].key, "2026-09-28");
  assert.equal(grid[4][6].key, "2026-11-01");
});

test("events fall on every day they span, but an end at midnight doesn't take the next", () => {
  const allDay = fromGoogle({ id: "a", summary: "Trip", start: { date: "2026-10-08" }, end: { date: "2026-10-10" } });
  assert.deepEqual(daysOf(allDay), ["2026-10-08", "2026-10-09"]);
  const evening = { start: new Date(2026, 9, 8, 20).toISOString(), end: new Date(2026, 9, 9, 0).toISOString() };
  assert.deepEqual(daysOf(evening), ["2026-10-08"]);
  const late = { start: new Date(2026, 9, 8, 22).toISOString(), end: new Date(2026, 9, 9, 1).toISOString() };
  assert.deepEqual(daysOf(late), ["2026-10-08", "2026-10-09"]);
  const days = byDay([allDay, evening, fromApple({ calendar: "Home", title: "Dinner", start: evening.start, end: evening.end }, 0)]);
  assert.equal(days["2026-10-08"].length, 3);
  assert.equal(days["2026-10-09"].length, 1);
});

test("the more on a day, the stronger its red, up to full", () => {
  assert.equal(heatOf(0), 0);
  assert.ok(heatOf(1) > 0 && heatOf(1) < heatOf(2) && heatOf(2) < heatOf(4));
  assert.equal(heatOf(5), 1);
  assert.equal(heatOf(12), 1);
});

test("months shift across years", () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
});

import { calendarChanged, onCalendarChange } from "../src/lib/calendarBus.js";

test("an added event is heard by every listener, until it stops listening", () => {
  let a = 0;
  let b = 0;
  const offA = onCalendarChange(() => (a += 1));
  const offB = onCalendarChange(() => {
    b += 1;
    throw new Error("one listener failing");
  });
  calendarChanged();
  offA();
  calendarChanged();
  offB();
  calendarChanged();
  assert.equal(a, 1);
  assert.equal(b, 2);
});
