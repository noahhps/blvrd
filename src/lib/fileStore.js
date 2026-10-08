/* What a message's files hold -- a picture's data URL, a text file's text --
 * kept apart from the rest of the app's state, in this machine's webview
 * database (IndexedDB). The main store (lib/store.js) is one localStorage
 * entry, and the desktop webview allows that about 5MB: a handful of pictures
 * would fill it, and then nothing at all would save. Here they have room.
 *
 *   files  { ref, dataUrl? , text? }
 *
 * A file in a message keeps its `ref`; store.js strips the contents when
 * saving and fillFiles puts them back when the app opens. */

const NAME = "blvrd-files";
const STORE = "files";

let opening = null;
function db() {
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "ref" });
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
        tx.oncomplete = () => resolve(out?.result ?? true);
        tx.onerror = tx.onabort = () => resolve(null);
      }),
  );
}

// Refs the database has confirmed, so a save writes only what is new and
// strips only what is safely kept; and those on their way there.
const kept = new Set();
const writing = new Set();

export const payloadOf = (f) => (f.dataUrl != null ? { dataUrl: f.dataUrl } : f.text != null ? { text: f.text } : null);
export const isKept = (ref) => kept.has(ref);

/** Writes every file in `chats` the database doesn't have yet. Resolves true
 *  if anything new was kept. */
export function keepFiles(chats) {
  const fresh = [];
  for (const messages of Object.values(chats || {}))
    for (const m of messages || [])
      for (const f of m.files || []) if (f.ref && !kept.has(f.ref) && !writing.has(f.ref) && payloadOf(f)) fresh.push({ ref: f.ref, ...payloadOf(f) });
  if (!fresh.length) return Promise.resolve(false);
  fresh.forEach((f) => writing.add(f.ref));
  return run("readwrite", (s) => fresh.forEach((f) => s.put(f))).then((ok) => {
    fresh.forEach((f) => {
      writing.delete(f.ref);
      if (ok) kept.add(f.ref);
    });
    return Boolean(ok);
  });
}

/** Every kept file's contents by ref, for the files `chats` refers to; the
 *  database is cleared of any file no message refers to any more (a deleted
 *  chat's pictures). */
export async function loadFiles(chats) {
  const rows = (await run("readonly", (s) => s.getAll())) || [];
  const used = new Set();
  for (const messages of Object.values(chats || {})) for (const m of messages || []) for (const f of m.files || []) f.ref && used.add(f.ref);
  const found = new Map();
  const gone = [];
  for (const { ref, ...payload } of rows) {
    if (used.has(ref)) {
      kept.add(ref);
      found.set(ref, payload);
    } else gone.push(ref);
  }
  if (gone.length) run("readwrite", (s) => gone.forEach((ref) => s.delete(ref)));
  return found;
}

/** `chats` with the contents in `found` put back into the files missing them. */
export function withFiles(chats, found) {
  const out = {};
  for (const [id, messages] of Object.entries(chats || {})) {
    out[id] = (messages || []).map((m) =>
      m.files?.some((f) => f.ref && !payloadOf(f) && found.has(f.ref))
        ? { ...m, files: m.files.map((f) => (f.ref && !payloadOf(f) && found.has(f.ref) ? { ...f, ...found.get(f.ref) } : f)) }
        : m,
    );
  }
  return out;
}
