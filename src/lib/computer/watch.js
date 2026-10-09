/* The computer's steps as they happen, for the reader to follow live
 * (lib/computer/worker.js `watch`): a list kept on the answer still arriving
 * (App.jsx `live.watch`), each step running, done or not. */

/** `steps` with `event` taken in. */
export function watched(steps = [], event) {
  if (!event) return steps;
  if (event.kind === "start") return [...steps.filter((s) => s.id !== event.id), { id: event.id, line: event.line, state: "running", result: "" }];
  if (event.kind === "end") {
    const state = event.declined ? "declined" : event.error ? "failed" : "done";
    return steps.map((s) => (s.id === event.id ? { ...s, state, result: event.result } : s));
  }
  return steps;
}
