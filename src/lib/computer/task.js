/* `computer_task`: the one tool the agent in the chat gets for the computer
 * (docs/computer.md §5). It is offered only in a chat whose computer is on,
 * and hands the task to the worker (lib/computer/worker.js), which answers
 * with a short report; the steps ride along on the message for the reader.
 *
 * `ops` is the app's:
 *   open(chatId, { progress }) -> { client, where, root }  the chat's computer
 *   stop(chatId)          the computer's session ended (Stop)
 *   modelOf(agentId)      -> { agent, provider, model, profile } */

import { runWorker } from "./worker.js";

export const COMPUTER_GROUP = "computer";

export function computerTaskTool(ops) {
  return {
    name: "computer_task",
    label: "Use the computer",
    group: COMPUTER_GROUP,
    groupLabel: "The computer",
    description:
      "Do something on your computer -- run commands and code, make and change files, use the web browser -- and get back a short report of what happened. Give the whole task at once, with everything it needs. continue=true carries on from the last task, with its notes.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to do, complete on its own." },
        continue: { type: "boolean", description: "True to carry on from the last task (optional)." },
      },
      required: ["task"],
    },
    run: async (args, ctx) => {
      const task = String(args.task || "").trim();
      if (!task) throw new Error("the task is empty -- say what to do on the computer");
      const who = ops.modelOf(ctx.agentId);
      if (!who) throw new Error("no model to work the computer with");
      ctx.progress?.("Starting the computer…");
      const computer = await ops.open(ctx.chatId, { progress: ctx.progress });
      // Stop ends the computer's session too: whatever it was running goes.
      const onStop = () => ops.stop(ctx.chatId);
      ctx.signal?.addEventListener("abort", onStop, { once: true });
      try {
        return await runWorker({
          task,
          ...who,
          ...computer,
          signal: ctx.signal,
          approve: ctx.approve,
          progress: ctx.progress,
          watch: ctx.watch,
          resume: Boolean(args.continue),
        });
      } finally {
        ctx.signal?.removeEventListener("abort", onStop);
      }
    },
  };
}
