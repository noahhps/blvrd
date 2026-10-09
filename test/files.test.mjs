import { test } from "node:test";
import assert from "node:assert/strict";

import { kindOf, refusalOf, textWithFiles } from "../src/lib/attach.js";
import { docxText } from "../src/lib/documents.js";
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

/* A zip holding one file, stored as it is (method 0) -- all a .docx needs to
 * be for the reader in lib/documents.js, which doesn't check checksums. */
function storedZip(name, text) {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(name);
  const data = enc.encode(text);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local, 0);
  zip.set(central, local.length);
  zip.set(end, local.length + central.length);
  return zip.buffer;
}

test("a Word document goes as its paragraphs, tabs and breaks kept", async () => {
  const xml =
    '<w:document><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Revenue &amp; costs:</w:t><w:tab/><w:t>up</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Line one</w:t><w:br w:type="page"/><w:t>Line two</w:t></w:r></w:p></w:body></w:document>';
  const { text } = await docxText(storedZip("word/document.xml", xml));
  assert.equal(text, "Quarterly report\nRevenue & costs:\tup\nLine one\nLine two");
});

test("a zip that isn't a Word document, or isn't a zip, says so", async () => {
  assert.match((await docxText(storedZip("other.xml", "<x/>"))).error, /isn't a Word document/);
  assert.match((await docxText(new TextEncoder().encode("plain text").buffer)).error, /isn't a Word document/);
});

test("PDFs and Word files are documents; formats that can't be read say what to do", () => {
  const file = (name, type = "") => ({ name, type });
  assert.equal(kindOf(file("Q3.pdf", "application/pdf")), "document");
  assert.equal(kindOf(file("notes.docx")), "document");
  assert.equal(kindOf(file("old.doc", "application/msword")), null);
  assert.match(refusalOf(file("old.doc")), /save it as \.docx or PDF/);
  assert.match(refusalOf(file("budget.xlsx")), /CSV/);
  assert.match(refusalOf(file("song.mp3")), /isn't a picture, a document or a text file/);
});
