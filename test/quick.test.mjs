/* The quickview's @ and its shortcut (lib/quick.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mentionAt, mentionable } from "../src/lib/mentions.js";
import { DEFAULT_SHORTCUT, shortcutFromKey, shortcutOf } from "../src/lib/quick.js";

const agents = [{ name: "Researcher" }, { name: "Helper" }, { name: "Hal" }];

test("an @ is heard at the start or after a space, up to the caret", () => {
  assert.deepEqual(mentionAt("@he", 3), { start: 0, query: "he" });
  assert.deepEqual(mentionAt("ask @", 5), { start: 4, query: "" });
  assert.equal(mentionAt("mail me@home", 12), null);
  assert.equal(mentionAt("@hal hi", 7), null);
});

test("agents whose names start with the @ come before ones that only contain it", () => {
  assert.deepEqual(mentionable(agents, "h").map((a) => a.name), ["Helper", "Hal", "Researcher"]);
  assert.deepEqual(mentionable(agents, "").map((a) => a.name), ["Researcher", "Helper", "Hal"]);
  assert.deepEqual(mentionable(agents, "zz"), []);
});

test("a shortcut needs a modifier, or is an F-key; modifiers alone wait", () => {
  const key = (code, mods = {}) => ({ key: code, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(shortcutFromKey(key("Space", { altKey: true })), "Alt+Space");
  assert.equal(shortcutFromKey(key("KeyK", { metaKey: true, shiftKey: true })), "Shift+Super+KeyK");
  assert.equal(shortcutFromKey(key("F5")), "F5");
  assert.equal(shortcutFromKey(key("KeyK")), null);
  assert.equal(shortcutFromKey({ ...key("ShiftLeft", { shiftKey: true }), key: "Shift" }), null);
});

test("no shortcut chosen is the default; off is kept as off", () => {
  assert.equal(shortcutOf({}), DEFAULT_SHORTCUT);
  assert.equal(shortcutOf({ quickShortcut: null }), null);
});
