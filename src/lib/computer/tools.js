/* The computer's tools as the worker (lib/computer/worker.js) is given them:
 * five, with flat, plain schemas -- each schema is sent on every request,
 * and every extra tool is another chance for a small model to pick wrong.
 * About 450 tokens together.
 *
 * Each call goes to the computer (computer/server.mjs) with `_limit`, the
 * characters its answer may use, from the model's budget. On this Mac what
 * reaches outside the chat's folder, and every command, waits for the
 * reader's Allow; in the sandbox nothing does (docs/computer.md §8). */

const str = (description) => ({ type: "string", description });

// A path that may lead out of the workspace: absolute, home, or climbing up.
export const leavesWorkspace = (path) => {
  const p = String(path || "").trim();
  return p.startsWith("/") || p.startsWith("~") || p.split(/[\\/]/).includes("..");
};

const firstLine = (s, n = 160) => {
  const line = String(s || "").trim().split("\n")[0];
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

/** The tools, for a computer `client` ({ call(name, args) }) at `where`
 *  ("host" | "sandbox"), with answers cut to `limit` characters. */
export function computerTools({ client, where, limit }) {
  const host = where === "host";
  const run = (name) => (args) => client.call(name, { ...args, _limit: limit });
  return [
    {
      name: "shell",
      label: "Run a command",
      description: "Run a bash script on the computer. cd and variables carry over between calls. Returns the exit code and output, cut to fit; the rest goes to a file it names.",
      parameters: {
        type: "object",
        properties: { script: str("The commands to run."), timeout: { type: "integer", description: "Seconds before it is stopped (default 120)." } },
        required: ["script"],
      },
      // On this Mac every command asks; "Always allow" is for that command.
      confirm: () => host,
      alwaysKey: (args) => `computer.shell:${String(args.script || "").trim()}`,
      summary: (args) => `run on this Mac: ${firstLine(args.script, 300)}`,
      run: run("shell"),
    },
    {
      name: "read",
      label: "Read a file",
      description: "Read a file as numbered lines (a window at a time: from, lines), or list a folder. A big file is outlined first.",
      parameters: {
        type: "object",
        properties: { path: str("The file or folder."), from: { type: "integer", description: "First line (optional)." }, lines: { type: "integer", description: "How many lines (optional)." } },
        required: ["path"],
      },
      confirm: (args) => host && leavesWorkspace(args.path),
      alwaysKey: (args) => `computer.read:${String(args.path || "").replace(/[^/]+$/, "")}`,
      summary: (args) => `read ${args.path} on this Mac, outside the chat's folder`,
      run: run("read"),
    },
    {
      name: "write",
      label: "Write a file",
      description: "Write a whole file, or add to its end with append=true -- write a long file in parts that way.",
      parameters: {
        type: "object",
        properties: { path: str("The file."), content: str("What it should hold."), append: { type: "boolean", description: "True to add to the end (optional)." } },
        required: ["path", "content"],
      },
      confirm: (args) => host && leavesWorkspace(args.path),
      summary: (args) => `${args.append ? "add to" : "write"} ${args.path} on this Mac, outside the chat's folder`,
      run: run("write"),
    },
    {
      name: "edit",
      label: "Edit a file",
      description: "Change a file: replace the exact text `find` (there once) with `replace`. Cheaper than writing the file again.",
      parameters: {
        type: "object",
        properties: { path: str("The file."), find: str("The exact text there now."), replace: str("What it becomes.") },
        required: ["path", "find", "replace"],
      },
      confirm: (args) => host && leavesWorkspace(args.path),
      summary: (args) => `edit ${args.path} on this Mac, outside the chat's folder`,
      run: run("edit"),
    },
    {
      name: "browser",
      label: "Use the browser",
      description:
        "Use the web browser with steps, one to a line: open <url>, click <n>, type <n> <text> [enter], select <n> <option>, press <key>, scroll down|up, back, find <text>, look. The [n] numbers come from the page you were shown. Returns the page after the steps, or what changed.",
      parameters: { type: "object", properties: { steps: str("The steps, one to a line.") }, required: ["steps"] },
      // On this Mac, a step that sends a form asks first.
      confirm: (args) => host && /\b(enter|submit)\b/i.test(String(args.steps || "")),
      summary: (args) => `in the browser on this Mac: ${String(args.steps || "").trim().split("\n").join(" · ").slice(0, 300)}`,
      run: run("browser"),
    },
  ];
}
