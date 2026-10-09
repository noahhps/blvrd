/* The blvrd extension: lets blvrd's agents use this browser -- the reader's
 * own, with their logins -- when a chat's computer is This Mac.
 *
 * Each computer blvrd starts on this Mac (one a chat; computer/server.mjs)
 * listens on a port from 47861 on, on 127.0.0.1 only. This keeps looking for
 * them and connects to each one it finds; a computer's steps then happen in
 * a window of its own here, so the reader's own tabs are never touched.
 * When that computer goes, its window goes with it.
 *
 * Steps arrive as { id, op, args } and are answered { id, ok, result | error }. */

import { COLLECT } from "./collect.js";
import { ACT, HAS_TEXT, PRESS, SCROLL } from "./act.js";

const PORTS = Array.from({ length: 10 }, (_, i) => 47861 + i);
const links = new Map(); // port -> WebSocket
const work = new Map(); // port -> { windowId, tabId, opened }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(port) {
  if (links.has(port)) return;
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/blvrd`);
  } catch {
    return;
  }
  links.set(port, ws);
  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    try {
      const result = await handle(port, msg.op, msg.args || {});
      ws.send(JSON.stringify({ id: msg.id, ok: true, result: result ?? null }));
    } catch (problem) {
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: String(problem?.message || problem) }));
    }
  };
  ws.onclose = () => {
    links.delete(port);
    const w = work.get(port);
    work.delete(port);
    if (w) chrome.windows.remove(w.windowId).catch(() => {});
  };
  ws.onerror = () => {};
}

// Look for computers now, every few seconds while awake, and every half
// minute when the browser has put this to sleep.
const look = () => PORTS.forEach(connect);
chrome.alarms.create("blvrd-look", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(look);
chrome.runtime.onStartup.addListener(look);
chrome.runtime.onInstalled.addListener(look);
setInterval(look, 3000);
look();

// A link that opens a tab from the computer's: the computer follows it there.
chrome.tabs.onCreated.addListener((tab) => {
  for (const w of work.values()) {
    if (tab.openerTabId === w.tabId || (tab.windowId === w.windowId && tab.id !== w.tabId)) {
      w.tabId = tab.id;
      w.opened = true;
    }
  }
});

async function tabOf(port, { create = false } = {}) {
  const w = work.get(port);
  if (w) {
    try {
      await chrome.tabs.get(w.tabId);
      return w;
    } catch {
      work.delete(port);
    }
  }
  if (!create) throw new Error("no page is open yet -- open one first");
  const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 900 });
  const fresh = { windowId: win.id, tabId: win.tabs[0].id, opened: false };
  work.set(port, fresh);
  return fresh;
}

// Until the tab has finished loading, or `ms` have gone.
function loaded(tabId, ms = 15000) {
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(on);
      setTimeout(resolve, 300);
    };
    const on = (id, info) => id === tabId && info.status === "complete" && done();
    chrome.tabs.onUpdated.addListener(on);
    timer = setTimeout(done, ms);
    chrome.tabs
      .get(tabId)
      .then((t) => t.status === "complete" && done())
      .catch(done);
  });
}

async function inPage(tabId, func, args = []) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return r?.result;
  } catch (problem) {
    throw new Error(`can't work in this page (${String(problem?.message || problem)}); the browser's own pages and its extension store are off-limits`);
  }
}

async function settled(tabId) {
  await sleep(400);
  await loaded(tabId);
}

async function handle(port, op, args) {
  switch (op) {
    case "hello":
      return { browser: navigator.userAgent };
    case "ping":
      return null;
    case "open": {
      const w = await tabOf(port, { create: true });
      await chrome.tabs.update(w.tabId, { url: args.url });
      await settled(w.tabId);
      return null;
    }
    case "state":
      return inPage((await tabOf(port)).tabId, COLLECT);
    case "act": {
      const w = await tabOf(port);
      const r = await inPage(w.tabId, ACT, [args.kind, args.ref, args.payload || {}]);
      if (r?.error) throw new Error(r.error);
      await settled(w.tabId);
      return null;
    }
    case "press": {
      const w = await tabOf(port);
      await inPage(w.tabId, PRESS, [args.key]);
      await settled(w.tabId);
      return null;
    }
    case "scroll": {
      const w = await tabOf(port);
      await inPage(w.tabId, SCROLL, [args.dir]);
      await sleep(250);
      return null;
    }
    case "back":
    case "forward":
    case "reload": {
      const w = await tabOf(port);
      await (op === "back" ? chrome.tabs.goBack(w.tabId) : op === "forward" ? chrome.tabs.goForward(w.tabId) : chrome.tabs.reload(w.tabId));
      await settled(w.tabId);
      return null;
    }
    case "hasText":
      return inPage((await tabOf(port)).tabId, HAS_TEXT, [args.text]);
    case "opened": {
      const w = work.get(port);
      const was = Boolean(w?.opened);
      if (w) w.opened = false;
      if (was) await loaded(w.tabId);
      return was;
    }
    case "tabs": {
      const w = await tabOf(port);
      const tabs = await chrome.tabs.query({ windowId: w.windowId });
      return tabs.map((t) => ({ url: t.url || "", current: t.id === w.tabId }));
    }
    case "tab": {
      const w = await tabOf(port);
      const tabs = await chrome.tabs.query({ windowId: w.windowId });
      const t = tabs[args.n - 1];
      if (!t) throw new Error(`there is no tab ${args.n}`);
      w.tabId = t.id;
      await chrome.tabs.update(t.id, { active: true });
      return null;
    }
    case "screen": {
      const w = work.get(port);
      if (!w) return null;
      const tab = await chrome.tabs.get(w.tabId);
      if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
      const image = await chrome.tabs.captureVisibleTab(w.windowId, { format: "jpeg", quality: 60 });
      return { image, url: tab.url || "", title: tab.title || "" };
    }
    case "close": {
      const w = work.get(port);
      work.delete(port);
      if (w) await chrome.windows.remove(w.windowId).catch(() => {});
      return null;
    }
    default:
      throw new Error(`the extension can't "${op}"`);
  }
}
