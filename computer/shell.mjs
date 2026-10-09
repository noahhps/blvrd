/* One bash for the whole task, so `cd` and `export` carry over from call to
 * call. Each script is written to a file and sourced, so quotes, heredocs and
 * several lines arrive as written; a marker line after it gives the exit code
 * and where the shell is now.
 *
 * The things that make a model wait on a prompt that will never be answered
 * are switched off before it starts: pagers, git asking for a password, apt
 * asking questions, colour. A script that runs past its time is stopped --
 * the whole shell with it -- and a new one started where the old one was. */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clean, cut } from "./cut.mjs";

export const DEFAULT_TIMEOUT_S = 120;
export const MAX_TIMEOUT_S = 900;

const QUIET = {
  PAGER: "cat",
  GIT_PAGER: "cat",
  MANPAGER: "cat",
  LESS: "-FRX",
  TERM: "dumb",
  NO_COLOR: "1",
  CLICOLOR: "0",
  GIT_TERMINAL_PROMPT: "0",
  DEBIAN_FRONTEND: "noninteractive",
  PIP_NO_INPUT: "1",
  npm_config_yes: "true",
  HOMEBREW_NO_AUTO_UPDATE: "1",
};

export class Shell {
  constructor(root, { env = process.env } = {}) {
    this.root = root;
    this.cwd = root;
    this.env = { ...env, ...QUIET };
    this.scripts = mkdtempSync(join(tmpdir(), "blvrd-shell-"));
    this.n = 0;
    this.proc = null;
  }

  start() {
    this.marker = `__blvrd_${Math.random().toString(36).slice(2)}__`;
    // Its own process group, so stopping it stops what it started.
    this.proc = spawn("bash", ["--noprofile", "--norc"], { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.proc.stdin.write("exec 2>&1\n");
    this.out = "";
    this.proc.stdout.on("data", (chunk) => {
      this.out += chunk.toString("utf8");
      this.check?.();
    });
    this.proc.on("exit", () => {
      this.proc = null;
      this.check?.(true);
    });
  }

  stop() {
    if (!this.proc) return;
    try {
      process.kill(-this.proc.pid, "SIGKILL");
    } catch {
      this.proc?.kill("SIGKILL");
    }
    this.proc = null;
  }

  /** Run `script`. Resolves to { code, cwd, output, ms, timedOut }. */
  run(script, { timeout = DEFAULT_TIMEOUT_S } = {}) {
    if (!this.proc) this.start();
    const file = join(this.scripts, `${++this.n}.sh`);
    writeFileSync(file, `${script}\n`);
    const seconds = Math.min(Math.max(Number(timeout) || DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S);
    const started = Date.now();
    this.out = "";
    return new Promise((resolve) => {
      const marker = this.marker;
      const finish = (result) => {
        clearTimeout(timer);
        this.check = null;
        resolve({ ...result, ms: Date.now() - started });
      };
      const timer = setTimeout(() => {
        const output = this.out;
        this.stop();
        finish({ code: null, cwd: this.cwd, output, timedOut: seconds });
      }, seconds * 1000);
      this.check = (exited = false) => {
        const at = this.out.indexOf(`\n${marker} `);
        if (at !== -1) {
          const tail = this.out.slice(at + marker.length + 2);
          const end = tail.indexOf("\n");
          if (end === -1) return;
          const [code, ...where] = tail.slice(0, end).split(" ");
          this.cwd = where.join(" ") || this.cwd;
          finish({ code: Number(code), cwd: this.cwd, output: this.out.slice(0, at) });
        } else if (exited) {
          // `exit` in the script: the shell is gone; the next call starts one.
          finish({ code: null, cwd: this.cwd, output: this.out, exited: true });
        }
      };
      this.proc.stdin.write(`. ${JSON.stringify(file)}\nprintf '\\n%s %s %s\\n' ${marker} "$?" "$PWD"\n`);
    });
  }
}

/** A run as the model reads it: exit code, time, where the shell is, then the
 *  output cut to `limit` -- the end kept over the start. */
export function report(result, { limit, root }) {
  const seconds = (result.ms / 1000).toFixed(result.ms < 10_000 ? 1 : 0);
  const where = result.cwd || root;
  const head = result.timedOut
    ? `stopped after ${result.timedOut}s -- it was still running. The shell was restarted in ${where}; variables set before are gone. Run long things in the background (cmd > log 2>&1 &) and check the log.`
    : result.exited
      ? `the shell exited; a new one starts with the next call, in ${where}.`
      : `exit ${result.code} · ${seconds}s · ${where}`;
  const output = clean(result.output).replace(/\n+$/, "");
  return output ? `${head}\n${cut(output, limit, { tail: 0.8, keepIn: root, name: "shell" })}` : `${head}\n(no output)`;
}
