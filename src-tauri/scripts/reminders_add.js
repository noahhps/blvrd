// Adds one reminder. argv[0] is JSON: { title, due?, list?, notes? }.
function run(argv) {
  const a = JSON.parse(argv[0] || "{}");
  const app = Application("Reminders");
  const list = a.list ? app.lists.byName(a.list) : app.defaultList();
  const props = { name: a.title, body: a.notes || "" };
  if (a.due) props.dueDate = new Date(a.due);
  list.reminders.push(app.Reminder(props));
  return JSON.stringify({ added: a.title, list: list.name(), due: a.due || null });
}
