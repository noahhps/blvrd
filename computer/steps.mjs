/* The browser's steps, a few short lines rather than a tool per action:
 * small models write `click 12` far more reliably than nested JSON, and one
 * call can fill a whole form (docs/computer.md §4).
 *
 *   open <url>              click <ref>            type <ref> <text> [enter]
 *   select <ref> <option>   check <ref>            uncheck <ref>
 *   press <key>             scroll [up|down|top|bottom]
 *   back   forward   reload   look   find <text>   wait <text | seconds>
 *   tabs   tab <n>
 *
 * Read leniently, the way lib/heal.js reads calls: "Click #12", "go to
 * example.com", "1. type [4] 'hi'", "type 4 hi and press enter". */

export const VERBS = ["open", "click", "type", "select", "check", "uncheck", "press", "scroll", "back", "forward", "reload", "look", "find", "wait", "tabs", "tab"];

const SYNONYMS = {
  goto: "open",
  go: "open",
  navigate: "open",
  visit: "open",
  load: "open",
  tap: "click",
  fill: "type",
  enter: "type",
  write: "type",
  input: "type",
  choose: "select",
  pick: "select",
  key: "press",
  hit: "press",
  view: "look",
  show: "look",
  snapshot: "look",
  refresh: "reload",
  search: "find",
  sleep: "wait",
};

const unquote = (s) => {
  const t = String(s || "").trim();
  const m = /^(["'“‘`])([\s\S]*)(["'”’`])$/.exec(t);
  return m ? m[2] : t;
};

const KEYS = { enter: "Enter", return: "Enter", tab: "Tab", esc: "Escape", escape: "Escape", space: "Space", backspace: "Backspace", delete: "Delete", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", pageup: "PageUp", pagedown: "PageDown", home: "Home", end: "End" };
export function keyOf(text) {
  return String(text || "")
    .trim()
    .split(/\s*\+\s*/)
    .map((part) => {
      const low = part.toLowerCase();
      if (KEYS[low]) return KEYS[low];
      if (["ctrl", "control"].includes(low)) return "Control";
      if (["cmd", "command", "meta"].includes(low)) return "Meta";
      if (["alt", "option"].includes(low)) return "Alt";
      if (low === "shift") return "Shift";
      return part.length === 1 ? part : part[0].toUpperCase() + part.slice(1);
    })
    .join("+");
}

/** One line as a step, or an Error saying what couldn't be read. */
export function parseStep(line) {
  let s = String(line || "").trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "");
  if (!s) return null;
  const m = /^([a-z]+)(?:\s+to)?\b\s*([\s\S]*)$/i.exec(s);
  if (!m) return new Error(`couldn't read the step "${line}"`);
  let verb = m[1].toLowerCase();
  verb = SYNONYMS[verb] || verb;
  const rest = m[2].trim();
  const ref = () => {
    const r = /^(?:ref\s*)?[#[(]?\s*(\d+)\s*[\])]?(?:\s+|$)([\s\S]*)$/i.exec(rest);
    return r ? { ref: r[1], rest: r[2].trim() } : null;
  };
  switch (verb) {
    case "open": {
      let url = unquote(rest.split(/\s+/)[0] || "");
      if (!url) return new Error("open needs a URL");
      // "localhost:5180" has a colon but no scheme.
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(about|data|file|chrome):/i.test(url)) url = /^(localhost|127\.|\d+\.\d+\.\d+\.\d+)(:\d+)?/.test(url) ? `http://${url}` : `https://${url}`;
      return { verb, url };
    }
    case "click":
    case "check":
    case "uncheck": {
      const r = ref();
      if (!r) return new Error(`${verb} needs an element's number, like "${verb} 12"`);
      return { verb, ref: r.ref };
    }
    case "type":
    case "select": {
      const r = ref();
      if (!r) return new Error(`${verb} needs an element's number and ${verb === "type" ? "the text" : "the option"}, like "${verb} 4 ${verb === "type" ? "hello" : "Large"}"`);
      let text = r.rest;
      let submit = false;
      const tail = /\s+(?:and\s+)?(?:then\s+)?(?:press\s+|hit\s+)?(?:enter|return|submit)\s*$/i;
      if (verb === "type" && tail.test(text)) {
        submit = true;
        text = text.replace(tail, "");
      }
      return { verb, ref: r.ref, text: unquote(text), submit };
    }
    case "press":
      if (!rest) return new Error("press needs a key, like \"press Enter\"");
      return { verb, key: keyOf(unquote(rest)) };
    case "scroll": {
      const dir = (/(up|down|top|bottom)/i.exec(rest)?.[1] || "down").toLowerCase();
      return { verb, dir };
    }
    case "back":
    case "forward":
    case "reload":
    case "look":
    case "tabs":
      return { verb };
    case "tab": {
      const n = /\d+/.exec(rest)?.[0];
      return n ? { verb, n: Number(n) } : { verb: "tabs" };
    }
    case "find":
    case "wait": {
      const text = unquote(rest);
      if (!text) return new Error(`${verb} needs ${verb === "wait" ? "some text or a number of seconds" : "some text"}`);
      if (verb === "wait" && /^\d+(\.\d+)?\s*(s|sec|seconds?)?$/i.test(text)) return { verb, seconds: Math.min(30, parseFloat(text)) };
      return { verb, text };
    }
    default:
      return new Error(`"${m[1]}" isn't a step. The steps: ${VERBS.join(", ")}`);
  }
}

/** Every line of `text` as a step; the first that can't be read stops it. */
export function parseSteps(text) {
  const steps = [];
  for (const line of String(text || "").split(/\n|;\s*(?=[a-z])/i)) {
    const step = parseStep(line);
    if (step === null) continue;
    if (step instanceof Error) return { steps, error: step.message };
    steps.push(step);
  }
  return { steps, error: steps.length ? null : "no steps given" };
}
