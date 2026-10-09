/* The faces picked in Settings (lib/fonts.js). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { fontsOf, stackOf } from "../src/lib/fonts.js";

test("each slot has its default until one is picked", () => {
  assert.deepEqual(fontsOf({}), { app: "inter", text: "helvetica", sections: "app", widgets: "app" });
  assert.deepEqual(fontsOf({ fonts: { text: "georgia" } }).text, "georgia");
});

test("a font no longer offered, or the app following itself, falls back", () => {
  const fonts = fontsOf({ fonts: { app: "app", text: "comic-sans", widgets: "menlo" } });
  assert.equal(fonts.app, "inter");
  assert.equal(fonts.text, "helvetica");
  assert.equal(fonts.widgets, "menlo");
});

test("a notebook slot set to the app takes the app's stack", () => {
  const fonts = fontsOf({ fonts: { app: "georgia" } });
  assert.equal(stackOf(fonts, "sections"), stackOf(fonts, "app"));
  assert.match(stackOf(fonts, "sections"), /^Georgia/);
});
