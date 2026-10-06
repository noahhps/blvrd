/* Arithmetic for the `calculate` tool, without eval.
 *
 * A small recursive-descent parser: + - * / % ^, parentheses, unary minus,
 * the constants pi and e, and a handful of functions. Small models are bad at
 * arithmetic and good at writing it down; this is the half they are bad at. */

const FUNCS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  min: Math.min,
  max: Math.max,
};
const CONSTS = { pi: Math.PI, e: Math.E };

export function calculate(source) {
  const text = String(source || "").replace(/×/g, "*").replace(/÷/g, "/").replace(/,(?=\d{3}\b)/g, "");
  let i = 0;

  const fail = (what) => {
    throw new Error(`${what} at position ${i + 1} in "${text}"`);
  };
  const space = () => {
    while (/\s/.test(text[i] || "")) i++;
  };
  const peek = () => {
    space();
    return text[i];
  };

  function expr() {
    let left = term();
    for (;;) {
      const op = peek();
      if (op === "+" || op === "-") {
        i++;
        const right = term();
        left = op === "+" ? left + right : left - right;
      } else return left;
    }
  }
  function term() {
    let left = unary();
    for (;;) {
      const op = peek();
      if (op === "*" || op === "/" || op === "%") {
        if (op === "*" && text[i + 1] === "*") return left; // "**" is a power, handled below
        i++;
        const right = unary();
        if (op === "*") left *= right;
        else if (op === "/") left /= right;
        else left %= right;
      } else return left;
    }
  }
  // Unary minus binds looser than ^, as in written maths: -3^2 is -9.
  function unary() {
    const op = peek();
    if (op === "-") {
      i++;
      return -unary();
    }
    if (op === "+") {
      i++;
      return unary();
    }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() === "^" || (text[i] === "*" && text[i + 1] === "*")) {
      i += text[i] === "^" ? 1 : 2;
      return base ** unary(); // right-associative, and 2^-1 works
    }
    return base;
  }
  function atom() {
    const c = peek();
    if (c === "(") {
      i++;
      const value = expr();
      if (peek() !== ")") fail("expected )");
      i++;
      return value;
    }
    const num = text.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (num) {
      i += num[0].length;
      let value = parseFloat(num[0]);
      if (peek() === "%" && !/[\d(.]/.test(text.slice(i + 1).trim()[0] || "")) {
        i++;
        value /= 100; // "15%" on its own is a percentage, not a modulo
      }
      return value;
    }
    const word = text.slice(i).match(/^[a-z_][a-z0-9_]*/i);
    if (word) {
      const name = word[0].toLowerCase();
      i += word[0].length;
      if (name in CONSTS) return CONSTS[name];
      if (!(name in FUNCS)) fail(`unknown name "${word[0]}"`);
      if (peek() !== "(") fail(`expected ( after ${name}`);
      i++;
      const args = [expr()];
      while (peek() === ",") {
        i++;
        args.push(expr());
      }
      if (peek() !== ")") fail("expected )");
      i++;
      return FUNCS[name](...args);
    }
    return fail(c ? `unexpected "${c}"` : "unexpected end");
  }

  const value = expr();
  if (peek() !== undefined) fail(`unexpected "${peek()}"`);
  if (!Number.isFinite(value)) throw new Error(`"${text}" has no finite value`);
  return value;
}
