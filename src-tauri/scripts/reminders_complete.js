// Marks one reminder done. argv[0] is JSON: { id }.
function run(argv) {
  const a = JSON.parse(argv[0] || "{}");
  const app = Application("Reminders");
  const r = app.reminders.byId(a.id);
  const title = r.name();
  r.completed = true;
  return JSON.stringify({ completed: title });
}
