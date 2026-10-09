/* The browser, as the model uses it: steps (steps.mjs) run one after
 * another, the page let settle after each, and a ref that went stale -- the
 * page redrew -- found again by what it was before giving up. The answer is
 * the page after the last step, or what changed (view.mjs).
 *
 * What does each step is a driver:
 *   drivers/extension.mjs -- the reader's own browser, with their logins,
 *                            through the blvrd extension (This Mac's default)
 *   drivers/launched.mjs  -- one the computer starts, with a profile of its
 *                            own (the sandbox; or This Mac, if chosen) */

import { diffView, findView, fullView } from "./view.mjs";
import { parseSteps } from "./steps.mjs";

const WAIT_MS = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  constructor({ driver }) {
    this.driver = driver;
    this.last = null; // the page as the model last saw it
  }

  close() {
    return this.driver.close();
  }

  /* A ref that names something on the page now -- the one asked for, or, if
     the page redrew and it's gone, the one that looks the same as it did. */
  async resolve(ref) {
    const now = await this.driver.state();
    if (now.items.some((i) => i.ref === String(ref))) return String(ref);
    const was = this.last?.items.find((i) => i.ref === String(ref));
    const same = was?.name && now.items.find((i) => i.role === was.role && i.name === was.name);
    if (same) return same.ref;
    throw new Error(`there is no [${ref}] on the page now${was ? ` (it was ${was.role} "${was.name}")` : ""} -- look at the page again for the current numbers`);
  }

  async act(kind, ref, payload) {
    await this.driver.act(kind, await this.resolve(ref), payload);
  }

  async step(s, limit) {
    const d = this.driver;
    switch (s.verb) {
      case "open":
        return d.goto(s.url);
      case "click":
        return this.act("click", s.ref);
      case "type":
        return this.act("fill", s.ref, { text: s.text, submit: Boolean(s.submit) });
      case "select":
        return this.act("select", s.ref, { label: s.text });
      case "check":
      case "uncheck":
        return this.act("check", s.ref, { on: s.verb === "check" });
      case "press":
        return d.press(s.key);
      case "scroll":
        return d.scroll(s.dir);
      case "back":
      case "forward":
      case "reload":
        return d.nav(s.verb);
      case "wait": {
        if (s.seconds) return sleep(s.seconds * 1000);
        const until = Date.now() + WAIT_MS;
        while (!(await d.hasText(s.text))) {
          if (Date.now() > until) throw new Error(`"${s.text}" didn't show up within ${WAIT_MS / 1000} seconds`);
          await sleep(400);
        }
        return null;
      }
      case "find":
        return findView(await d.state(), s.text, limit);
      case "look":
        this.last = null; // the whole page, not what changed
        return null;
      case "tabs":
        return this.tabs();
      case "tab":
        try {
          await d.switchTab(s.n);
        } catch {
          throw new Error(`there is no tab ${s.n}; ${await this.tabs()}`);
        }
        this.last = null;
        return null;
      default:
        throw new Error(`can't do "${s.verb}"`);
    }
  }

  /** The page as a picture, for the reader to watch -- never the model.
   *  Null when the browser hasn't been started. */
  async screen() {
    return this.driver.started ? this.driver.screen() : null;
  }

  async tabs() {
    const tabs = await this.driver.tabs();
    return `Tabs: ${tabs.map((t, i) => `${i + 1}${t.current ? " (this one)" : ""} ${t.url}`).join(" · ")}`;
  }

  /** Run `text`'s steps; the page after them, in `limit` characters. */
  async run(text, limit = 6000) {
    const { steps, error } = parseSteps(text);
    if (error && !steps.length) throw new Error(`${error}. Write steps one to a line, e.g.:\nopen https://example.com\nclick 3\ntype 4 hello enter`);
    await this.driver.ensure();
    const done = [];
    let answer = null;
    let failed = null;
    for (const s of steps) {
      let opened = false;
      try {
        answer = (await this.step(s, limit)) ?? null;
        if (!["find", "tabs", "look", "tab"].includes(s.verb)) {
          await this.driver.settle();
          // A link that opened a new tab: follow it there.
          opened = await this.driver.takeOpened();
        }
      } catch (problem) {
        failed = `step ${done.length + 1} (${describe(s)}) didn't work: ${String(problem.message || problem).split("\n")[0]}`;
        break;
      }
      done.push(opened ? `${describe(s)} (it opened a new tab; now in it)` : describe(s));
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
    const now = await this.driver.state();
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
