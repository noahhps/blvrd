/* The computer (computer/server.mjs) over its own protocol, MCP on stdio:
 * a real bash, real files, and -- where a Chromium is to be had -- a real
 * browser against a little site served here. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { parseStep, parseSteps } from "../computer/steps.mjs";
import { clean, cut } from "../computer/cut.mjs";

const SERVER = new URL("../computer/server.mjs", import.meta.url).pathname;
const CHROME = [process.env.BLVRD_CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));

// Closed when the test ends, passed or failed: an open pipe would keep the
// test process waiting on the server.
function computer(root, t, extra = []) {
  const proc = spawn(process.execPath, [SERVER, "--root", root, ...extra], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...(CHROME ? { BLVRD_CHROME: CHROME } : {}) } });
  const waiting = new Map();
  let n = 0;
  createInterface({ input: proc.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++n;
      waiting.set(id, resolve);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const call = async (name, args) => {
    const { result } = await rpc("tools/call", { name, arguments: args });
    return { text: result.content[0].text, error: Boolean(result.isError) };
  };
  const gone = new Promise((r) => proc.once("exit", r));
  const close = () => {
    proc.stdin.end();
    return gone;
  };
  t?.after(close);
  return { rpc, call, close };
}

test("it says what it is and what it has", async (t) => {
  const c = computer(mkdtempSync(join(tmpdir(), "blvrd-c-")), t);
  const init = await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
  assert.equal(init.result.serverInfo.name, "blvrd-computer");
  const { result } = await c.rpc("tools/list", {});
  assert.deepEqual(result.tools.map((t) => t.name), ["shell", "read", "write", "edit", "browser"]);
  c.close();
});

test("the shell: one bash, cd and variables kept, exit codes, the end of long output kept and the rest in a file", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "blvrd-c-"));
  const c = computer(root, t);
  let r = await c.call("shell", { script: "mkdir -p proj && cd proj && export WHO=agent" });
  assert.match(r.text, /^exit 0 · [\d.]+s · .*\/proj\n\(no output\)$/);
  r = await c.call("shell", { script: 'echo "$WHO in $(basename "$PWD")"; ls nope' });
  assert.match(r.text, /^exit 2 /);
  assert.match(r.text, /agent in proj/);
  assert.match(r.text, /No such file/, "stderr comes with stdout");
  // Heredocs and quotes arrive as written.
  r = await c.call("shell", { script: "cat <<'EOF'\nit's \"quoted\" $HOME\nEOF" });
  assert.match(r.text, /it's "quoted" \$HOME/);
  // Long: the end over the start, all of it kept.
  r = await c.call("shell", { script: "seq 1 5000", _limit: 800 });
  assert.ok(r.text.length < 1100, `cut to the budget (${r.text.length})`);
  assert.match(r.text, /\n5000$/);
  const kept = /are in (\S+\.log)/.exec(r.text)[1];
  assert.equal(readFileSync(kept, "utf8").trim().split("\n").length, 5000);
  // Progress bars redrawn with \r keep their last state; colour goes.
  r = await c.call("shell", { script: "printf 'get 10%%\\rget 50%%\\rget 100%%\\n\\033[31mred\\033[0m\\n'" });
  assert.match(r.text, /\nget 100%\nred$/);
  c.close();
});

test("the shell: a script that runs too long is stopped, and the shell starts again where it was", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "blvrd-c-"));
  const c = computer(root, t);
  await c.call("shell", { script: "mkdir -p here && cd here" });
  const r = await c.call("shell", { script: "echo started; sleep 30", timeout: 2 });
  assert.match(r.text, /^stopped after 2s -- it was still running\. The shell was restarted in .*\/here/);
  assert.match(r.text, /started/);
  // The stopped shell's end, heard late, doesn't end this one.
  const after = await c.call("shell", { script: "sleep 0.5; pwd" });
  assert.match(after.text, /^exit 0 .*\n.*\/here$/);
  c.close();
});

test("files: numbered windows, an outline of a big file, writing in parts, edits that say where they nearly were", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "blvrd-c-"));
  const c = computer(root, t);
  let r = await c.call("write", { path: "src/app.py", content: "def main():\n    print('hi')\n" });
  assert.equal(r.text, "wrote 2 lines to src/app.py");
  r = await c.call("write", { path: "src/app.py", content: "\nif __name__ == '__main__':\n    main()\n", append: true });
  assert.equal(r.text, "added 3 lines to src/app.py (now 5)");
  r = await c.call("read", { path: "src/app.py" });
  assert.equal(r.text, "1| def main():\n2|     print('hi')\n3| \n4| if __name__ == '__main__':\n5|     main()");
  r = await c.call("read", { path: "src" });
  assert.match(r.text, /1 entry\napp\.py {2}\d+ B/);

  r = await c.call("edit", { path: "src/app.py", find: "print('hi')", replace: "print('hello')" });
  assert.match(r.text, /changed\. Now:\n.*\n2\|     print\('hello'\)/);
  r = await c.call("edit", { path: "src/app.py", find: "print( 'hello' )", replace: "x" });
  assert.equal(r.error, true);
  assert.match(r.text, /isn't in src\/app\.py\. The closest: line 2: "print\('hello'\)"/);
  writeFileSync(join(root, "twice.txt"), "a\nb\na\n");
  r = await c.call("edit", { path: "twice.txt", find: "a", replace: "c" });
  assert.match(r.text, /2 times \(lines 1, 3\)/);

  const big = Array.from({ length: 3000 }, (_, i) => (i % 300 === 0 ? `function part${i}() {` : `  line ${i};`)).join("\n");
  writeFileSync(join(root, "big.js"), big);
  r = await c.call("read", { path: "big.js", _limit: 2000 });
  assert.match(r.text, /^big\.js: 3000 lines, too long to show at once/);
  assert.match(r.text, /What it defines[\s\S]*301\| function part300\(\) \{/);
  r = await c.call("read", { path: "big.js", from: 1500, lines: 3 });
  assert.equal(r.text, "1500|   line 1499;\n1501| function part1500() {\n1502|   line 1501;\n[lines 1500-1502 of 3000; read from=1503 for more]");
  r = await c.call("read", { path: "nope.py" });
  assert.match(r.text, /there is no nope\.py/);
  c.close();
});

test("the browser it's told to use is the one it starts, and one that won't start is named", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "blvrd-c-"));
  const proc = spawn(process.execPath, [SERVER, "--root", root, "--browser", "/Applications/Nope.app/Contents/MacOS/Nope"], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, BLVRD_CHROME: "" } });
  t.after(() => proc.stdin.end());
  const answer = new Promise((resolve) => createInterface({ input: proc.stdout }).once("line", (l) => resolve(JSON.parse(l))));
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser", arguments: { steps: "open https://example.com" } } })}\n`);
  const { result } = await answer;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^couldn't start Nope \(.*\)\. It may not let itself be driven, or not run hidden -- try showing its window; or pick another browser on the Models screen\.$/);
});

test("cutting and cleaning on their own", () => {
  assert.equal(clean("a\rb\rc\nd"), "c\nd");
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const out = cut(text, 200);
  assert.match(out, /^line 0\n/);
  assert.match(out, /line 99$/);
  assert.match(out, /lines left out/);
});

test("browser steps are read the lenient way", () => {
  assert.deepEqual(parseStep("Click #12"), { verb: "click", ref: "12" });
  assert.deepEqual(parseStep("go to example.com"), { verb: "open", url: "https://example.com" });
  assert.deepEqual(parseStep("1. type [4] 'hello world' and press enter"), { verb: "type", ref: "4", text: "hello world", submit: true });
  assert.deepEqual(parseStep("press ctrl+a"), { verb: "press", key: "Control+a" });
  assert.deepEqual(parseStep("wait 2s"), { verb: "wait", seconds: 2 });
  assert.deepEqual(parseStep("open localhost:5180/x"), { verb: "open", url: "http://localhost:5180/x" });
  assert.deepEqual(parseSteps("open https://a.org/x;y=1; click 3").steps, [{ verb: "open", url: "https://a.org/x;y=1" }, { verb: "click", ref: "3" }]);
  const { steps, error } = parseSteps("open https://a.org\nclick 3\nfly away");
  assert.equal(steps.length, 2);
  assert.match(error, /"fly" isn't a step/);
});

const SITE = {
  "/": `<!doctype html><title>Shop</title>
    <header><nav>${Array.from({ length: 30 }, (_, i) => `<a href="/n${i}">Menu ${i}</a>`).join(" ")}</nav></header>
    <main><h1>Sign in</h1><p>Welcome back to the shop.</p>
    <form action="/hello" onsubmit="event.preventDefault(); document.querySelector('#out').textContent = 'Hello, ' + document.querySelector('#email').value; document.querySelector('#remember').checked = true;">
      <label>Email <input id="email" name="email"></label>
      <label>Password <input type="password" name="pw"></label>
      <label><input type="checkbox" id="remember"> Remember me</label>
      <button>Sign in</button>
    </form><p id="out"></p>
    <a href="/other" target="_blank">Open the other page</a></main>`,
  "/other": `<!doctype html><title>Other</title><main><h1>The other page</h1><p>Prices: 3 apples for £2.</p></main>`,
};

async function serveSite(t) {
  const site = createServer((req, res) => {
    res.writeHead(SITE[req.url] ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SITE[req.url] || "not found");
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  return `http://127.0.0.1:${site.address().port}`;
}

// The same walk through the little site, whichever browser does the steps.
async function walkThrough(c, base) {
  // The reader's look at the screen: nothing before a browser is open.
  assert.deepEqual((await c.rpc("blvrd/screen", {})).result, {});
  let r = await c.call("browser", { steps: `open ${base}/` });
  const shot = (await c.rpc("blvrd/screen", {})).result;
  assert.match(shot.image, /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(shot.title, "Shop");
  // And it answers while a long command holds the computer.
  const long = c.call("shell", { script: "sleep 3" });
  const started = Date.now();
  assert.ok((await c.rpc("blvrd/screen", {})).result.image);
  assert.ok(Date.now() - started < 2500, "not kept waiting behind the command");
  await long;
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /^Shop — http:\/\/127\.0\.0\.1:\d+\//);
  const email = /\[(\d+)\] textbox "Email"/.exec(r.text)?.[1];
  const button = /\[(\d+)\] button "Sign in"/.exec(r.text)?.[1];
  assert.ok(email && button, r.text);
  assert.match(r.text, /Welcome back to the shop/);
  // The page's own things come before the menu's.
  assert.ok(r.text.indexOf('"Email"') < r.text.indexOf('"Menu 0"') || !r.text.includes('"Menu 0"'));

  r = await c.call("browser", { steps: `type ${email} sam@example.com\nclick ${button}` });
  assert.match(r.text, /✓ type \d+ "sam@example\.com"\n✓ click \d+/);
  assert.match(r.text, /what changed:/);
  assert.match(r.text, /Changed: .*textbox "Email" = "sam@example\.com"/);
  assert.match(r.text, /checkbox "Remember me" ✓/);
  assert.match(r.text, /New text:\nHello, sam@example\.com/);
  assert.ok(!r.text.includes("Menu 5"), "an unchanged menu isn't sent again");

  r = await c.call("browser", { steps: "find apples" });
  assert.match(r.text, /Nothing with that in it is showing/);
  r = await c.call("browser", { steps: "click 99" });
  assert.match(r.text, /✗ step 1 \(click 99\) didn't work: there is no \[99\]/);

  const link = /\[(\d+)\] link "Open the other page"/.exec((await c.call("browser", { steps: "look" })).text)?.[1];
  r = await c.call("browser", { steps: `click ${link}` });
  assert.match(r.text, /it opened a new tab; now in it/);
  assert.match(r.text, /Other — .*\/other/);
  assert.match(r.text, /3 apples for £2/);
}

test("the browser: a page in a few lines, a form filled in one call, what changed, a new tab followed", { skip: !CHROME && "no Chromium here" }, async (t) => {
  const base = await serveSite(t);
  await walkThrough(computer(mkdtempSync(join(tmpdir(), "blvrd-c-")), t), base);
});

// The reader's own browser: a Chromium with the real extension in it, as
// it would be in Dia or Chrome once added.
const EXTENSION = new URL("../computer/extension", import.meta.url).pathname;
async function ownBrowser(t) {
  const { chromium } = createRequire(new URL("../computer/package.json", import.meta.url))("playwright-core");
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "blvrd-own-")), {
    executablePath: CHROME,
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  t.after(() => context.close());
  return context;
}

test("the reader's own browser, through the extension: the same walk, in a window of its own", { skip: !CHROME && "no Chromium here" }, async (t) => {
  const base = await serveSite(t);
  const own = await ownBrowser(t);
  const mine = await own.newPage();
  await mine.goto(`${base}/other`);
  const c = computer(mkdtempSync(join(tmpdir(), "blvrd-c-")), t, ["--own-browser"]);
  await walkThrough(c, base);
  // The reader's own tab was left as it was.
  assert.equal(mine.url(), `${base}/other`);
  // And when the computer goes, so does its window.
  const pages = own.pages().length;
  c.close();
  for (let i = 0; i < 40 && own.pages().length >= pages; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(own.pages().length < pages, "its window closed");
  assert.ok(!mine.isClosed());
});

test("only an extension may connect to the computer's browser port", async (t) => {
  const c = computer(mkdtempSync(join(tmpdir(), "blvrd-c-")), t, ["--own-browser"]);
  await c.rpc("ping", {});
  const { WebSocket } = createRequire(new URL("../computer/package.json", import.meta.url))("ws");
  const tryWith = (origin) =>
    new Promise((resolve) => {
      const ws = new WebSocket("ws://127.0.0.1:47861/blvrd", { origin });
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("error", () => resolve("refused"));
    });
  let extension = "refused";
  for (let i = 0; i < 30 && extension !== "open"; i++) {
    extension = await tryWith("chrome-extension://abc");
    if (extension !== "open") await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(extension, "open");
  assert.equal(await tryWith("https://evil.example"), "refused");
});
