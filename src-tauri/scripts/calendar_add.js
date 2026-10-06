// Adds one event. argv[0] is JSON: { title, start, end, calendar?, location?, notes?, allDay? }.
function run(argv) {
  const a = JSON.parse(argv[0] || "{}");
  const app = Application("Calendar");
  const cal = a.calendar ? app.calendars.byName(a.calendar) : app.calendars.whose({ writable: true })()[0];
  if (!cal) throw new Error("There is no calendar that can be written to.");
  const event = app.Event({
    summary: a.title,
    startDate: new Date(a.start),
    endDate: new Date(a.end),
    location: a.location || "",
    description: a.notes || "",
    alldayEvent: Boolean(a.allDay),
  });
  cal.events.push(event);
  return JSON.stringify({ added: a.title, calendar: cal.name(), start: a.start, end: a.end });
}
