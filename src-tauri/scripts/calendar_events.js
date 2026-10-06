// Events overlapping [from, to), in one calendar or all of them, oldest first.
// argv[0] is JSON: { from, to, calendar?, query? }. Recurring events are listed
// by their first occurrence -- a limit of Calendar's scripting, not of this.
function run(argv) {
  const a = JSON.parse(argv[0] || "{}");
  const from = new Date(a.from);
  const to = new Date(a.to);
  const q = (a.query || "").toLowerCase();
  const app = Application("Calendar");
  const out = [];
  for (const cal of app.calendars()) {
    if (a.calendar && cal.name() !== a.calendar) continue;
    const events = cal.events.whose({ _and: [{ startDate: { _lessThan: to } }, { endDate: { _greaterThan: from } }] })();
    for (const e of events) {
      const title = e.summary() || "";
      const notes = e.description() || "";
      if (q && !title.toLowerCase().includes(q) && !notes.toLowerCase().includes(q)) continue;
      out.push({
        calendar: cal.name(),
        title,
        start: e.startDate().toISOString(),
        end: e.endDate().toISOString(),
        allDay: e.alldayEvent(),
        location: e.location() || "",
        notes: notes.slice(0, 500),
      });
    }
  }
  out.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  return JSON.stringify(out.slice(0, 200));
}
