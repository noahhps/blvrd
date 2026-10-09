/* The computer from the chat's side (lib/computer): an agent hands a task to
 * computer_task, the worker does it on a real computer/server.mjs with a
 * fake model, and a short report comes back -- with the steps kept for the
 * reader, a small window folded up on the way, and on this Mac, commands
 * waiting for the reader's yes. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { resetProfiles } from "../src/lib/profile.js";
import { runTurn } from "../src/lib/run.js";
import { computerTaskTool } from "../src/lib/computer/task.js";
import { runWorker } from "../src/lib/computer/worker.js";
import { budgetFor } from "../src/lib/computer/budget.js";

const SERVER = new URL("../computer/server.mjs", import.meta.url).pathname;
const OLLAMA = { id: "ollama", kind: "ollama", name: "Ollama", base: "http://127.0.0.1:11434" };

/* A computer, spoken to directly (the app goes through the desktop shell). */
function computer(t) {
  const root = mkdtempSync(join(tmpdir(), "blvrd-w-"));
  const proc = spawn(process.execPath, [SERVER, "--root", root], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let n = 0;
  const limits = [];
  createInterface({ input: proc.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
  });
  t.after(() => proc.stdin.end());
  return {
    root,
    limits,
    client: {
      call: (name, args) =>
        new Promise((resolve, reject) => {
          const id = ++n;
          limits.push(args._limit);
          waiting.set(id, ({ result }) => (result.isError ? reject(new Error(result.content[0].text)) : resolve(result.content[0].text)));
          proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
        }),
    },
  };
}

const ndjson = (objects) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const o of objects) c.enqueue(enc.encode(JSON.stringify(o) + "\n")); c.close(); } }), { status: 200 });
};
const call = (name, args) => ndjson([{ message: { role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] }, done: true }]);
const say = (text) => ndjson([{ message: { role: "assistant", content: text }, done: true }]);
const isWorker = (body) => /You are working on a computer/.test(body.messages[0]?.content || "");

test("the chat's agent hands a task to the computer and gets a short report; the steps stay with the reader", async (t) => {
  resetProfiles();
  const c = computer(t);
  const workerSays = [
    () => call("shell", { script: "mkdir -p app && cd app && echo 'echo $((6*7))' > calc.sh && bash calc.sh" }),
    () => call("write", { path: ".task/notes.md", content: "- made app/calc.sh; it prints 42\n" }),
    () => say("Made app/calc.sh, which prints 42."),
  ];
  const chatSays = [
    () => call("computer_task", { task: "Make a script that prints 6 times 7, and run it." }),
    () => say("Done: the script prints 42."),
  ];
  const workerBodies = [];
  const chatBodies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    if (isWorker(body)) {
      workerBodies.push(body);
      return workerSays.shift()();
    }
    chatBodies.push(body);
    return chatSays.shift()();
  });
  const tool = computerTaskTool({
    open: async () => ({ client: c.client, where: "sandbox", root: c.root }),
    stop: () => {},
    modelOf: () => ({ agent: { name: "Sam" }, provider: OLLAMA, model: "qwen3", profile: { window: 32768, tools: "native" } }),
  });
  const said = [];
  const statuses = [];
  await runTurn({
    agent: { name: "Sam", tools: null },
    provider: OLLAMA,
    model: "qwen3",
    history: [{ role: "user", content: "make me a script that prints 6*7" }],
    available: [tool],
    notebook: { agentId: "a1", chatId: "a1" },
    emit: (e) => (e.type === "message" ? said.push(e.message) : e.type === "status" && statuses.push(e.status)),
  });

  const result = said.find((m) => m.role === "tool");
  assert.equal(result.content, "Made app/calc.sh, which prints 42.");
  assert.equal(result.detail.kind, "computer");
  assert.deepEqual(result.detail.steps.map((s) => s.line), ["shell: mkdir -p app && cd app && echo 'echo $((6*7))' > calc.sh && bash calc.sh", "write .task/notes.md"]);
  assert.match(result.detail.steps[0].result, /^exit 0 [\s\S]*\n42$/);
  assert.equal(said.at(-1).content, "Done: the script prints 42.");
  assert.equal(readFileSync(join(c.root, ".task/notes.md"), "utf8"), "- made app/calc.sh; it prints 42\n");
  // The chat's model sees the report, never the steps.
  assert.ok(!JSON.stringify(chatBodies[1].messages).includes("exit 0"));
  // The worker's instructions are the same bytes on every request.
  assert.equal(new Set(workerBodies.map((b) => b.messages[0].content)).size, 1);
  assert.deepEqual(workerBodies[0].tools.map((x) => x.function.name), ["shell", "read", "write", "edit", "browser"]);
  // Answers cut to a tenth of the window: 3277 tokens, in characters.
  assert.ok(c.limits.every((l) => l === budgetFor(OLLAMA, { window: 32768 }).observationChars));
  assert.ok(statuses.some((s) => /On the computer: shell: mkdir/.test(s)));
});

test("a small window: the worker's context is folded once it's full, into a fresh start with the task, the notes and every step in a line", async (t) => {
  resetProfiles();
  const c = computer(t);
  const bodies = [];
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const fresh = /What you have done so far/.test(body.messages[1]?.content || "");
    if (fresh) return say("Read it all; it's a long file of numbers.");
    reads += 1;
    if (reads === 1) return call("write", { path: ".task/notes.md", content: "reading big.txt\n" });
    if (reads === 2) return call("shell", { script: "seq 1 20000 > big.txt" });
    return call("read", { path: "big.txt", from: (reads - 3) * 300 + 1, lines: 300 });
  });
  const out = await runWorker({
    task: "Read big.txt.",
    agent: { name: "Sam" },
    provider: OLLAMA,
    model: "small",
    profile: { window: 8192, tools: "native" },
    client: c.client,
    where: "sandbox",
    root: c.root,
    signal: null,
  });
  assert.equal(out.text, "Read it all; it's a long file of numbers.");
  assert.ok(out.detail.checkpoints >= 1);
  const folded = bodies.find((b) => /What you have done so far/.test(b.messages[1]?.content || ""));
  assert.equal(folded.messages.length, 2, "the system prompt and one fresh message");
  assert.match(folded.messages[1].content, /^The task: Read big\.txt\./);
  assert.match(folded.messages[1].content, /Your notes \(\.task\/notes\.md\):\nreading big\.txt/);
  assert.match(folded.messages[1].content, /- read big\.txt from 1 → /);
  assert.match(folded.messages[1].content, /The last results in full:/);
  // Before folding, every request only added to the one before it.
  const before = bodies.slice(0, bodies.indexOf(folded));
  for (let i = 1; i < before.length; i++) {
    assert.deepEqual(before[i].messages.slice(0, before[i - 1].messages.length), before[i - 1].messages, `request ${i} kept the one before it as it was`);
  }
});

test("on this Mac a command waits for the reader, and a no is passed on to the model", async (t) => {
  resetProfiles();
  const c = computer(t);
  const asked = [];
  let n = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    n += 1;
    if (n === 1) return call("write", { path: "hello.txt", content: "hi\n" });
    if (n === 2) return call("shell", { script: "rm -rf ~/Documents" });
    const last = body.messages.at(-1);
    return say(`Wrote hello.txt; ${/declined/.test(last.content) ? "the command was declined" : "ran the command"}.`);
  });
  const out = await runWorker({
    task: "Tidy up.",
    agent: { name: "Sam" },
    provider: OLLAMA,
    model: "m",
    profile: { window: 32768, tools: "native" },
    client: c.client,
    where: "host",
    root: c.root,
    signal: null,
    approve: async (request) => {
      asked.push(request);
      return false;
    },
  });
  assert.equal(asked.length, 1, "writing inside the chat's folder didn't ask; the command did");
  assert.equal(asked[0].summary, "run on this Mac: rm -rf ~/Documents");
  assert.equal(asked[0].alwaysKey, "computer.shell:rm -rf ~/Documents", "\"Always allow\" would cover that command only");
  assert.equal(out.text, "Wrote hello.txt; the command was declined.");
  assert.equal(out.detail.steps[1].declined, true);
});

test("a model whose window is too small is told so, and the computer isn't touched", async () => {
  const out = await runWorker({ task: "x", agent: { name: "S" }, provider: OLLAMA, model: "tiny", profile: { window: 2048 }, client: null, where: "sandbox", root: "/w" });
  assert.match(out.text, /at least 6k tokens; tiny has 2048/);
});
