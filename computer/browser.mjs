/* The browser: any browser built on Chromium, through Playwright, started
 * the first time it's used and kept for the task. On this Mac it is the one
 * the reader picked -- Dia, Arc, Chrome, Brave, Edge... -- with a profile of
 * its own (no saved logins unless the reader signs in to it on purpose); in
 * the sandbox, the VM's Chromium. Safari and Firefox can't be driven this way.
 *
 * Steps (steps.mjs) run one after another; the runtime waits for the page
 * to settle after each, and a ref that went stale -- the page redrew -- is
 * found again by what it was before giving up. The answer is the page after
 * the last step, or what changed (view.mjs). */

import { existsSync, mkdirSync } from "node:fs";

import { COLLECT, diffView, findView, fullView } from "./view.mjs";
import { parseSteps } from "./steps.mjs";

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

export class Browser {
  constructor({ profileDir, headless = true, executable = process.env.BLVRD_CHROME || null }) {
    this.profileDir = profileDir;
    this.headless = headless;
    this.executable = executable;
    this.context = null;
    this.page = null;
    this.last = null; // the page as the model last saw it
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

  /* The element a ref names -- or, if the page redrew and it's gone, the one
     that looks the same as it did. */
  async element(ref) {
    const here = this.page.locator(`[data-blvrd-ref="${ref}"]`);
    if (await here.count()) return here.first();
    const was = this.last?.items.find((i) => i.ref === String(ref));
    if (was) {
      const now = await this.state();
      const same = now.items.find((i) => i.role === was.role && i.name === was.name && i.name);
      if (same) return this.page.locator(`[data-blvrd-ref="${same.ref}"]`).first();
    }
    throw new Error(`there is no [${ref}] on the page now${was ? ` (it was ${was.role} "${was.name}")` : ""} -- look at the page again for the current numbers`);
  }

  async step(s, limit) {
    const p = this.page;
    switch (s.verb) {
      case "open":
        await p.goto(s.url, { waitUntil: "domcontentloaded", timeout: NAV_MS });
        return null;
      case "click":
        await (await this.element(s.ref)).click({ timeout: ACTION_MS });
        return null;
      case "type": {
        const el = await this.element(s.ref);
        await el.fill(s.text, { timeout: ACTION_MS });
        if (s.submit) await el.press("Enter");
        return null;
      }
      case "select": {
        const el = await this.element(s.ref);
        await el.selectOption({ label: s.text }, { timeout: ACTION_MS }).catch(() => el.selectOption(s.text, { timeout: ACTION_MS }));
        return null;
      }
      case "check":
      case "uncheck":
        await (await this.element(s.ref)).setChecked(s.verb === "check", { timeout: ACTION_MS });
        return null;
      case "press":
        await p.keyboard.press(s.key);
        return null;
      case "scroll":
        await p.evaluate((dir) => {
          if (dir === "top") scrollTo(0, 0);
          else if (dir === "bottom") scrollTo(0, document.documentElement.scrollHeight);
          else scrollBy(0, (dir === "up" ? -0.8 : 0.8) * innerHeight);
        }, s.dir);
        return null;
      case "back":
        await p.goBack({ waitUntil: "domcontentloaded", timeout: NAV_MS });
        return null;
      case "forward":
        await p.goForward({ waitUntil: "domcontentloaded", timeout: NAV_MS });
        return null;
      case "reload":
        await p.reload({ waitUntil: "domcontentloaded", timeout: NAV_MS });
        return null;
      case "wait":
        if (s.seconds) await sleep(s.seconds * 1000);
        else await p.getByText(s.text).first().waitFor({ timeout: 15_000 });
        return null;
      case "find":
        return findView(await this.state(), s.text, limit);
      case "look":
        this.last = null; // the whole page, not what changed
        return null;
      case "tabs":
        return this.tabs();
      case "tab": {
        const pages = this.context.pages();
        if (!pages[s.n - 1]) throw new Error(`there is no tab ${s.n}; ${this.tabs()}`);
        this.page = pages[s.n - 1];
        await this.page.bringToFront();
        this.last = null;
        return null;
      }
      default:
        throw new Error(`can't do "${s.verb}"`);
    }
  }

  /** The page as a picture, for the reader to watch -- never the model.
   *  Null when the browser hasn't been started. */
  async screen() {
    if (!this.context || !this.page || this.page.isClosed()) return null;
    const shot = await this.page.screenshot({ type: "jpeg", quality: 60, timeout: 3000 }).catch(() => null);
    return shot ? { image: `data:image/jpeg;base64,${shot.toString("base64")}`, url: this.page.url(), title: await this.page.title().catch(() => "") } : null;
  }

  tabs() {
    return `Tabs: ${this.context.pages().map((pg, i) => `${i + 1}${pg === this.page ? " (this one)" : ""} ${pg.url()}`).join(" · ")}`;
  }

  /** Run `text`'s steps; the page after them, in `limit` characters. */
  async run(text, limit = 6000) {
    const { steps, error } = parseSteps(text);
    if (error && !steps.length) throw new Error(`${error}. Write steps one to a line, e.g.:\nopen https://example.com\nclick 3\ntype 4 hello enter`);
    await this.ensure();
    const done = [];
    let answer = null;
    let failed = null;
    for (const s of steps) {
      const before = this.page;
      try {
        answer = await this.step(s, limit);
        if (!["find", "tabs", "look"].includes(s.verb)) await this.settle();
      } catch (problem) {
        failed = `step ${done.length + 1} (${describe(s)}) didn't work: ${String(problem.message || problem).split("\n")[0]}`;
        break;
      }
      // A link that opened a new tab: follow it there.
      const fresh = this.opened.splice(0).filter((pg) => !pg.isClosed());
      if (fresh.length && this.page === before) {
        this.page = fresh.at(-1);
        await this.page.waitForLoadState("domcontentloaded").catch(() => {});
        done.push(`${describe(s)} (it opened a new tab; now in it)`);
      } else done.push(describe(s));
    }
    const lines = [];
    // Each step said when there were several, or one went wrong, or one has
    // something to tell (a new tab).
    if (steps.length > 1 || failed || done.some((d) => d.includes("("))) lines.push(`${done.map((d) => `✓ ${d}`).join("\n")}${failed ? `\n✗ ${failed}` : ""}`);
    if (error && !failed) lines.push(`(Stopped before a line it couldn't read: ${error}.)`);
    if (answer && steps.at(-1) && ["find", "tabs"].includes(steps.at(-1).verb) && !failed) {
      lines.push(answer);
      return lines.join("\n");
    }
    const now = await this.state();
    const view = diffView(this.last, now, limit - 200) || fullView(now, limit - 200);
    this.last = now;
    lines.push(view);
    return lines.join("\n");
  }
}

function describe(s) {
  switch (s.verb) {
    case "open":
      return `open ${s.url}`;
    case "type":
      return `type ${s.ref} "${s.text.slice(0, 30)}"${s.submit ? " enter" : ""}`;
    case "select":
      return `select ${s.ref} "${s.text}"`;
    case "press":
      return `press ${s.key}`;
    case "scroll":
      return `scroll ${s.dir}`;
    case "find":
    case "wait":
      return `${s.verb} ${s.text ?? `${s.seconds}s`}`;
    case "tab":
      return `tab ${s.n}`;
    default:
      return s.ref ? `${s.verb} ${s.ref}` : s.verb;
  }
}
