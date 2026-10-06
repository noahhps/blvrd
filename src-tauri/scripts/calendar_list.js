// The calendars, and whether each can be written to.
function run() {
  const app = Application("Calendar");
  return JSON.stringify(app.calendars().map((c) => ({ name: c.name(), writable: c.writable() })));
}
