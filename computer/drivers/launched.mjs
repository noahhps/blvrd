/* A browser the computer starts itself, through Playwright: any built on
 * Chromium, from its own program, with a profile of its own. What the
 * sandbox uses, and on this Mac what "a separate browser" means (the other
 * way, the reader's own browser, is drivers/extension.mjs).
 *
 * A driver for Browser (../browser.mjs): it does each kind of step; Browser
 * decides which, in what order, and what the model is told. */

import { existsSync, mkdirSync } from "node:fs";

import { COLLECT } from "../extension/collect.js";

const SETTLE_MS = 2500;
const ACTION_MS = 8000;
const NAV_MS = 30_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A Chromium to drive when none was named: the first of these that's here.
const CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Dia.app/Contents/MacOS/Dia",
  "/Applications/Arc.app/Contents/MacOS/Arc",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
];

async function playwright() {
  try {
    return await import("playwright-core");
  } catch {
    return import("playwright");
  }
}

export class LaunchedBrowser {
  constructor({ profileDir, headless = true, executable = null }) {
    this.profileDir = profileDir;
    this.headless = headless;
    this.executable = executable;
    this.context = null;
    this.page = null;
    this.opened = [];
  }

  async ensure() {
    if (this.context) return;
    const { chromium } = await playwright();
    mkdirSync(this.profileDir, { recursive: true });
    const executablePath = this.executable || CANDIDATES.find((p) => existsSync(p));
    const options = { headless: this.headless, viewport: { width: 1280, height: 900 }, ...(executablePath ? { executablePath } : { channel: "chrome" }) };
    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, options);
    } catch (problem) {
      const which = executablePath ? executablePath.replace(/^.*\/([^/]+)\.app\/.*$/, "$1") : "Chrome";
      const why = String(problem.message || problem).split("\n")[0];
      throw new Error(
        executablePath
          ? `couldn't start ${which} (${why}). It may not let itself be driven${this.headless ? ", or not run hidden -- try showing its window" : ""}; or pick another browser on the Models screen.`
          : `couldn't find a browser to use (${why}). Install one built on Chromium (Chrome, Dia, Arc, Brave, Edge…) and pick it on the Models screen.`,
      );
    }
    this.context.on("page", (page) => this.opened.push(page));
    this.page = this.context.pages()[0] || (await this.context.newPage());
  }

  async close() {
    await this.context?.close().catch(() => {});
    this.context = null;
  }

  get started() {
    return Boolean(this.context && this.page && !this.page.isClosed());
  }

  async settle() {
    await Promise.race([this.page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {}), sleep(SETTLE_MS)]);
    await sleep(150);
  }

  async state() {
    try {
      return await this.page.evaluate(COLLECT);
    } catch {
      // Mid-navigation: once more, when it has landed.
      await this.page.waitForLoadState("domcontentloaded").catch(() => {});
      return this.page.evaluate(COLLECT);
    }
  }

  goto(url) {
    return this.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_MS });
  }

  async act(kind, ref, payload = {}) {
    const el = this.page.locator(`[data-blvrd-ref="${ref}"]`).first();
    if (kind === "click") return el.click({ timeout: ACTION_MS });
    if (kind === "fill") {
      await el.fill(payload.text, { timeout: ACTION_MS });
      if (payload.submit) await el.press("Enter");
      return;
    }
    if (kind === "select") return el.selectOption({ label: payload.label }, { timeout: ACTION_MS }).catch(() => el.selectOption(payload.label, { timeout: ACTION_MS }));
    if (kind === "check") return el.setChecked(Boolean(payload.on), { timeout: ACTION_MS });
    throw new Error(`can't ${kind}`);
  }

  press(key) {
    return this.page.keyboard.press(key);
  }

  scroll(dir) {
    return this.page.evaluate((d) => {
      if (d === "top") scrollTo(0, 0);
      else if (d === "bottom") scrollTo(0, document.documentElement.scrollHeight);
      else scrollBy(0, (d === "up" ? -0.8 : 0.8) * innerHeight);
    }, dir);
  }

  nav(op) {
    const p = this.page;
    const opts = { waitUntil: "domcontentloaded", timeout: NAV_MS };
    return op === "back" ? p.goBack(opts) : op === "forward" ? p.goForward(opts) : p.reload(opts);
  }

  hasText(text) {
    return this.page.evaluate((t) => document.body?.innerText.includes(t) || false, text);
  }

  /** Whether the last step opened a tab -- and if so, it's the current one now. */
  async takeOpened() {
    const fresh = this.opened.splice(0).filter((pg) => !pg.isClosed());
    if (!fresh.length) return false;
    this.page = fresh.at(-1);
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    return true;
  }

  async tabs() {
    return this.context.pages().map((pg) => ({ url: pg.url(), current: pg === this.page }));
  }

  async switchTab(n) {
    const pages = this.context.pages();
    if (!pages[n - 1]) throw new Error(`there is no tab ${n}`);
    this.page = pages[n - 1];
    await this.page.bringToFront();
  }

  async screen() {
    if (!this.started) return null;
    const shot = await this.page.screenshot({ type: "jpeg", quality: 60, timeout: 3000 }).catch(() => null);
    return shot ? { image: `data:image/jpeg;base64,${shot.toString("base64")}`, url: this.page.url(), title: await this.page.title().catch(() => "") } : null;
  }
}
