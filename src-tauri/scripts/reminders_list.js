// Reminders, in one list or all, open ones unless asked otherwise.
// argv[0] is JSON: { list?, includeCompleted? }.
function run(argv) {
  const a = JSON.parse(argv[0] || "{}");
  const app = Application("Reminders");
  const out = [];
  for (const list of app.lists()) {
    if (a.list && list.name() !== a.list) continue;
    const items = a.includeCompleted ? list.reminders() : list.reminders.whose({ completed: false })();
    for (const r of items) {
      const due = r.dueDate();
      out.push({
        id: r.id(),
        list: list.name(),
        title: r.name(),
        due: due ? due.toISOString() : null,
        notes: (r.body() || "").slice(0, 300),
        completed: r.completed(),
      });
      if (out.length >= 200) return JSON.stringify(out);
    }
  }
  return JSON.stringify(out);
}
