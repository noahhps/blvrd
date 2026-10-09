/* A chat's computer: where it is, and the session to it.
 *
 *   computers  { [chatId]: { where: "off" | "host" | "sandbox" } }  (store.js)
 *
 * On this Mac the computer (computer/server.mjs) runs as a local MCP server
 * through the same Rust as the reader's own MCP servers (src-tauri/src/mcp.rs),
 * started through their login shell so `node` is found as in Terminal. In
 * the sandbox it runs in the VM the same way, through `limactl shell`
 * (src-tauri/src/machine.rs). Same program, same answers; only the command
 * differs (docs/computer.md §2). */

import { invoke, listen } from "../desktop.js";
import { clientFor, disconnect, resultText } from "../connectors/mcp.js";

export const WHERE = [
  { id: "off", label: "Off" },
  { id: "host", label: "This Mac" },
  { id: "sandbox", label: "Sandbox" },
];
export const whereOf = (computers, chatId) => computers?.[chatId]?.where || "off";

const CALL_MS = 16 * 60 * 1000; // a command may run 15 minutes
const serverId = (chatId, where) => `computer:${where}:${chatId}`;

// The sandbox is stopped once nothing has used it for this long.
export const SANDBOX_IDLE_MS = 15 * 60 * 1000;
let idle = null;
const sandboxUsed = () => {
  clearTimeout(idle);
  idle = setTimeout(() => {
    for (const key of sessions) disconnect(key);
    sessions.clear();
    invoke("machine_stop", {}, "The sandbox").catch(() => {});
  }, SANDBOX_IDLE_MS);
};
const sessions = new Set(); // sandbox server ids open now

/** Open (or reuse) the chat's computer. `progress` hears what the sandbox
 *  is doing while it starts -- the first time, it is made. */
export async function openComputer(chatId, where, { progress = null } = {}) {
  if (where === "off") throw new Error("this chat's computer is off");
  // What to start, and where its workspace is, from the desktop shell.
  let plan;
  if (where === "host") plan = await invoke("computer_host", { chatId }, "The computer");
  else {
    const off = await listen("machine-progress", ({ line }) => line?.trim() && progress?.(`Sandbox: ${line.trim().slice(0, 140)}`));
    try {
      plan = await invoke("computer_sandbox", { chatId }, "The sandbox");
    } finally {
      off();
    }
    sessions.add(serverId(chatId, where));
    sandboxUsed();
  }
  const server = { id: serverId(chatId, where), name: "The computer", transport: "stdio", command: plan.command, args: plan.args, env: plan.env || {} };
  let session;
  try {
    session = await clientFor(server, { get: () => server, patch: () => {} });
  } catch (problem) {
    const text = String(problem.message || problem);
    if (where === "host" && /not found|No such file|couldn't start node/i.test(text)) {
      throw new Error("The computer on this Mac needs Node.js. Install it (nodejs.org, or `brew install node`) and try again.");
    }
    throw problem;
  }
  return {
    where,
    root: plan.root,
    client: {
      call: async (name, args) => {
        if (where === "sandbox") sandboxUsed();
        const result = await session.request("tools/call", { name, arguments: args }, CALL_MS);
        const text = resultText(result);
        if (result?.isError) throw new Error(text);
        return text;
      },
    },
  };
}

/** The sandbox's state, and the reader's say over it (Models screen). */
export const sandboxStatus = () => invoke("machine_status", {}, "The sandbox");
export async function stopSandbox() {
  for (const key of sessions) disconnect(key);
  sessions.clear();
  return invoke("machine_stop", {}, "The sandbox");
}
export async function resetSandbox() {
  await stopSandbox();
  return invoke("machine_reset", {}, "The sandbox");
}

/** End the chat's computer session: its shell and browser go; its files stay. */
export function stopComputer(chatId) {
  for (const where of ["host", "sandbox"]) disconnect(serverId(chatId, where));
}
