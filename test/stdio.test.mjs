/* Local MCP servers over stdio (lib/connectors/mcp.js), against a stand-in
 * for the desktop app: a server started again under the same id must not
 * hear the old one's exit as its own, and one that really stopped is opened
 * afresh rather than talked to. */

import { test } from "node:test";
import assert from "node:assert/strict";

// The desktop shell, as @tauri-apps/api reaches it.
const callbacks = new Map();
const listeners = new Map(); // event -> [callback id]
const spawned = []; // { id, run }
const stopped = []; // { id, run }
let nextCallback = 1;
let answer = true; // whether a started server answers initialize

const emit = (event, payload) => {
  for (const cb of listeners.get(event) || []) callbacks.get(cb)?.({ event, payload });
};

globalThis.window = {
  __TAURI_INTERNALS__: {
    transformCallback(fn) {
      const id = nextCallback++;
      callbacks.set(id, fn);
      return id;
    },
    async invoke(cmd, args) {
      if (cmd === "plugin:event|listen") {
        listeners.set(args.event, [...(listeners.get(args.event) || []), args.handler]);
        return args.handler;
      }
      if (cmd === "plugin:event|unlisten") return null;
      if (cmd === "mcp_spawn") {
        spawned.push({ id: args.id, run: args.run });
        return null;
      }
      if (cmd === "mcp_stop") {
        stopped.push({ id: args.id, run: args.run });
        return null;
      }
      if (cmd === "mcp_send") {
        const msg = JSON.parse(args.line);
        const { run } = spawned.findLast((s) => s.id === args.id);
        if (msg.method === "initialize" && answer) {
          queueMicrotask(() => emit("mcp-stdio", { id: args.id, run, line: JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "t" } } }) }));
        }
        if (msg.method === "tools/call") {
          queueMicrotask(() => emit("mcp-stdio", { id: args.id, run, line: JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "done" }] } }) }));
        }
        return null;
      }
      throw new Error(`unexpected ${cmd}`);
    },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
};

const { clientFor } = await import("../src/lib/connectors/mcp.js");
const server = { id: "computer:host:c1", name: "The computer", transport: "stdio", command: "node", args: [] };
const store = { get: () => server, patch: () => {} };

test("a server's exit is its own run's, and a stopped one starts again", async () => {
  const first = await clientFor(server, store);
  const runA = spawned.at(-1).run;
  assert.equal((await first.request("tools/call", {})).content[0].text, "done");

  // Run A really ends: its calls fail at once, and it's forgotten.
  emit("mcp-stdio-exit", { id: server.id, run: runA });
  await assert.rejects(first.request("tools/call", {}), /The computer stopped\./);

  // The next use starts run B -- and a late exit from run A, under the same
  // id, isn't B's.
  const second = await clientFor(server, store);
  const runB = spawned.at(-1).run;
  assert.notEqual(runA, runB);
  emit("mcp-stdio-exit", { id: server.id, run: runA });
  assert.equal((await second.request("tools/call", {})).content[0].text, "done");
  assert.equal(await clientFor(server, store), second);
});

test("a handshake that fails leaves nothing running, and closing stops only its own run", async () => {
  const other = { ...server, id: "computer:host:c2" };
  answer = false;
  const job = clientFor(other, store);
  while (spawned.at(-1).id !== other.id) await new Promise((r) => setTimeout(r, 1));
  const run = spawned.at(-1).run;
  emit("mcp-stdio-exit", { id: other.id, run });
  await assert.rejects(job, /stopped/);
  await new Promise((r) => setTimeout(r, 10)); // the stop goes through an import
  assert.deepEqual(stopped.at(-1), { id: other.id, run });
  answer = true;
});
