import { test } from "node:test";
import assert from "node:assert/strict";

import { textWithFiles } from "../src/lib/attach.js";
import { withFiles } from "../src/lib/fileStore.js";

test("withFiles puts kept contents back into the files missing them", () => {
  const chats = {
    a: [
      { id: "m1", role: "user", content: "", files: [{ ref: "r1", name: "x.png", kind: "image" }] },
      { id: "m2", role: "user", content: "hi" },
    ],
    b: [{ id: "m3", role: "user", content: "", files: [{ ref: "r2", name: "y.txt", kind: "text", text: "already here" }] }],
  };
  const found = new Map([
    ["r1", { dataUrl: "data:image/jpeg;base64,AAAA" }],
    ["r2", { text: "stale" }],
  ]);
  const out = withFiles(chats, found);
  assert.equal(out.a[0].files[0].dataUrl, "data:image/jpeg;base64,AAAA");
  assert.equal(out.a[1], chats.a[1]); // untouched messages stay the same object
  assert.equal(out.b[0].files[0].text, "already here"); // never overwritten
});

test("a text file whose contents are gone is named, not a crash", () => {
  const text = textWithFiles("look", [{ ref: "r", name: "notes.md", kind: "text" }]);
  assert.match(text, /notes\.md is no longer available/);
});
