#!/usr/bin/env node
/* blvrd's computer: a shell, files and a browser, for agents, spoken to as
 * an MCP server over stdio -- one JSON-RPC message a line. The same program
 * runs on this Mac and in the sandbox VM (docs/computer.md §2); the app
 * decides what needs the reader's Allow, this does what it's asked.
 *
 *   node server.mjs --root <workspace> [--profile <browser profile>]
 *                   [--browser <a Chromium browser's program>] [--show]
 *
 * Every tool takes `_limit`, the characters its answer may use, set by the
 * app from the model's window; what doesn't fit is kept in a file under the
 * workspace (.blvrd/out) and the answer says where. */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { Browser } from "./browser.mjs";
import { DEFAULT_LIMIT } from "./cut.mjs";
import { edit, read, setRoot, write } from "./files.mjs";
import { Shell, report } from "./shell.mjs";

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : fallback;
};
const ROOT = resolve(arg("root", process.cwd()));
mkdirSync(ROOT, { recursive: true });
setRoot(ROOT);
const shell = new Shell(ROOT);
const browser = new Browser({
  profileDir: resolve(arg("profile", join(ROOT, ".blvrd", "browser"))),
  headless: !process.argv.includes("--show"),
  executable: arg("browser", process.env.BLVRD_CHROME || null),
});

const str = (description) => ({ type: "string", description });
export const TOOLS = [
  {
    name: "shell",
    description: "Run a bash script. cd and variables carry over between calls. Returns the exit code and output.",
    inputSchema: { type: "object", properties: { script: str("The script."), timeout: { type: "integer", description: "Seconds before it is stopped (default 120)." } }, required: ["script"] },
    run: async ({ script, timeout, _limit }) => report(await shell.run(String(script ?? ""), { timeout }), { limit: _limit, root: ROOT }),
  },
  {
    name: "read",
    description: "Read a file as numbered lines, a window at a time, or list a directory.",
    inputSchema: { type: "object", properties: { path: str("The file or directory."), from: { type: "integer", description: "First line (default 1)." }, lines: { type: "integer", description: "How many lines (default 200)." } }, required: ["path"] },
    run: async (args) => read(shell.cwd, args, args._limit),
  },
  {
    name: "write",
    description: "Write a file (made with its folders if new), or add to its end with append.",
    inputSchema: { type: "object", properties: { path: str("The file."), content: str("What it should hold."), append: { type: "boolean", description: "True to add to the end instead." } }, required: ["path", "content"] },
    run: async (args) => write(shell.cwd, args),
  },
  {
    name: "edit",
    description: "Change a file by replacing one exact piece of text with another.",
    inputSchema: { type: "object", properties: { path: str("The file."), find: str("The exact text there now."), replace: str("What it becomes.") }, required: ["path", "find", "replace"] },
    run: async (args) => edit(shell.cwd, args),
  },
  {
    name: "browser",
    description: "Use the web browser: steps one to a line (open <url>, click <n>, type <n> <text> [enter], …). Returns the page after them.",
    inputSchema: { type: "object", properties: { steps: str("The steps.") }, required: ["steps"] },
    run: async ({ steps, _limit }) => browser.run(String(steps ?? ""), _limit),
  },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const PROTOCOL = "2025-06-18";

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // a notification
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "blvrd-computer", version: "0.1.0" }, instructions: `Workspace: ${ROOT}` } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `There is no tool "${params?.name}".` }] } });
      const args = { ...(params.arguments || {}) };
      args._limit = Math.max(500, Math.min(Number(args._limit) || DEFAULT_LIMIT, 100_000));
      try {
        const text = await tool.run(args);
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(text) }] } });
      } catch (problem) {
        return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(problem.message || problem) }] } });
      }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
  } catch (problem) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(problem.message || problem) } });
  }
}

// One call at a time, in the order they came: the shell is one shell. Except
// a look at the screen, for the reader watching (not a tool -- the model never
// sees it): answered at once, even while a long command runs.
let queue = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "blvrd/screen") {
    browser
      .screen()
      .then((screen) => send({ jsonrpc: "2.0", id: msg.id, result: screen || {} }))
      .catch((problem) => send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(problem.message || problem) } }));
    return;
  }
  queue = queue.then(() => handle(msg));
});

// The app went (or closed the pipe): take the shell and the browser with us.
const quit = async () => {
  shell.stop();
  await browser.close();
  process.exit(0);
};
lines.on("close", quit);
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
