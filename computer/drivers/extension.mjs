/* The reader's own browser -- Dia, Chrome, Arc, whichever they use, with
 * their logins -- through the blvrd extension (../extension). What "This
 * Mac" uses unless the reader chose a separate browser.
 *
 * A browser already running can't be taken over from outside (Chromium won't
 * open its debugging port on the profile someone uses), so it comes the other
 * way: this listens on 127.0.0.1, on the first free port from 47861, and the
 * extension -- which keeps looking for computers on those ports -- connects
 * and does each step in a window of its own. Only an extension may connect,
 * and only one at a time.
 *
 * A driver for Browser (../browser.mjs), like drivers/launched.mjs. */

import { WebSocketServer } from "ws";

export const PORTS = Array.from({ length: 10 }, (_, i) => 47861 + i);
const CALL_MS = 30_000;
const NAV_MS = 45_000;
const PING_MS = 20_000; // keeps the extension's worker awake while connected
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const NOT_CONNECTED =
  "Your browser isn't connected. Add the blvrd extension to it (Models → The computer's browser shows how), keep the browser open, and try again -- or choose a separate browser there.";

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port,
      path: "/blvrd",
      verifyClient: ({ origin }) => /^chrome-extension:\/\//.test(origin || ""),
    });
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

export class ExtensionBrowser {
  constructor({ ports = PORTS, waitMs = 35_000 } = {}) {
    this.waitMs = waitMs; // the extension looks every few seconds, every half minute asleep
    this.socket = null;
    this.waiting = new Map();
    this.n = 0;
    this.hasPage = false; // a page has been opened in its window
    this.arrived = [];
    this.ready = this.start(ports);
  }

  async start(ports) {
    for (const port of ports) {
      try {
        this.server = await listen(port);
        this.port = port;
        break;
      } catch {
        // taken -- another chat's computer, most likely
      }
    }
    if (!this.server) {
      this.problem = `every port from ${ports[0]} to ${ports.at(-1)} is taken -- too many chats have a computer at once`;
      return;
    }
    this.server.on("connection", (socket) => {
      if (this.socket) return socket.close(1013, "busy");
      this.socket = socket;
      this.hasPage = false;
      socket.on("message", (data) => {
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        const wait = this.waiting.get(msg.id);
        if (!wait) return;
        this.waiting.delete(msg.id);
        clearTimeout(wait.timer);
        if (msg.ok) wait.resolve(msg.result);
        else wait.reject(new Error(msg.error || "the browser couldn't"));
      });
      socket.on("close", () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.hasPage = false;
        for (const wait of this.waiting.values()) {
          clearTimeout(wait.timer);
          wait.reject(new Error("the browser went away (closed, or the extension was turned off)"));
        }
        this.waiting.clear();
      });
      socket.on("error", () => {});
      for (const go of this.arrived.splice(0)) go();
    });
    this.pinger = setInterval(() => this.socket && this.call("ping", {}, 5000).catch(() => {}), PING_MS);
    this.pinger.unref?.();
  }

  call(op, args = {}, ms = CALL_MS) {
    if (!this.socket) return Promise.reject(new Error(NOT_CONNECTED));
    return new Promise((resolve, reject) => {
      const id = ++this.n;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`the browser didn't answer within ${Math.round(ms / 1000)} seconds`));
      }, ms);
      this.waiting.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, op, args }));
    });
  }

  async ensure() {
    await this.ready;
    if (this.problem) throw new Error(this.problem);
    if (this.socket) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, this.waitMs);
      this.arrived.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!this.socket) throw new Error(NOT_CONNECTED);
  }

  async close() {
    clearInterval(this.pinger);
    await this.ready;
    if (this.socket) await this.call("close", {}, 3000).catch(() => {});
    this.socket?.close();
    await new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  get started() {
    return Boolean(this.socket && this.hasPage);
  }

  // The extension waits for the page to load after each step itself.
  async settle() {}

  async state() {
    try {
      return await this.call("state");
    } catch (problem) {
      // Mid-navigation, most likely: once more, when it has landed.
      if (!this.socket) throw problem;
      await sleep(800);
      return this.call("state");
    }
  }

  async goto(url) {
    await this.call("open", { url }, NAV_MS);
    this.hasPage = true;
  }

  act(kind, ref, payload = {}) {
    return this.call("act", { kind, ref: String(ref), payload });
  }

  press(key) {
    return this.call("press", { key });
  }

  scroll(dir) {
    return this.call("scroll", { dir });
  }

  nav(op) {
    return this.call(op, {}, NAV_MS);
  }

  hasText(text) {
    return this.call("hasText", { text });
  }

  takeOpened() {
    return this.call("opened");
  }

  tabs() {
    return this.call("tabs");
  }

  switchTab(n) {
    return this.call("tab", { n });
  }

  async screen() {
    if (!this.started) return null;
    return this.call("screen", {}, 5000).catch(() => null);
  }
}
