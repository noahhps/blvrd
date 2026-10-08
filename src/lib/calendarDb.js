/* The calendar's local database: each month fetched from the connected
 * calendars, kept in this machine's webview (IndexedDB), so opening the app
 * shows the month at once instead of waiting on the calendars. Nothing here
 * leaves the machine.
 *
 *   months  { key, sources, at, data: { events, problems } }
 *           key is "<sources>|<year>-<month>" (lib/useMonthEvents.js)
 *
 * Every call fails soft: with no database (a private window, storage
 * blocked) the calendar simply fetches as if nothing was kept. */

const NAME = "blvrd-calendar";
const STORE = "months";

let opening = null;
function db() {
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return opening;
}

function run(mode, fn) {
  return db().then(
    (d) =>
      d &&
      new Promise((resolve) => {
        const tx = d.transaction(STORE, mode);
        const out = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(out?.result ?? null);
        tx.onerror = tx.onabort = () => resolve(null);
      }),
  );
}

/** Every month kept, as stored. */
export const allMonths = () => run("readonly", (s) => s.getAll()).then((rows) => rows || []);

/** Keeps one month. */
export const putMonth = (row) => run("readwrite", (s) => s.put(row));

/** Drops every month not from these calendars (one disconnected doesn't
 *  linger), then all but the `keep` most recently fetched. */
export const pruneMonths = (sources, keep) =>
  allMonths().then((rows) => {
    const kept = new Set(
      rows
        .filter((r) => r.sources === sources)
        .sort((a, b) => b.at - a.at)
        .slice(0, keep)
        .map((r) => r.key),
    );
    const gone = rows.filter((r) => !kept.has(r.key));
    if (gone.length) return run("readwrite", (s) => gone.forEach((r) => s.delete(r.key)));
  });
