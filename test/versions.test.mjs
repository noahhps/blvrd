import { test } from "node:test";
import assert from "node:assert/strict";

import { applyOps, diffData, diffSections, invertAll, netChanges, stale, withRowIds } from "../src/lib/versions.js";

const facts = (rows) => ({ id: "f", title: "About", type: "facts", data: { rows } });
const list = (items) => ({ id: "l", title: "Places", type: "list", data: { items } });

test("rows keep their ids by label; new ones get one", () => {
  const before = [{ id: "r1", key: "Birthday", value: "14 March" }];
  const rows = withRowIds([{ key: "birthday", value: "15 March" }, { key: "Shirt", value: "M" }], before);
  assert.equal(rows[0].id, "r1");
  assert.match(rows[1].id, /^r_/);
});

test("a diff applied to the old data gives the new, and its inverse gives the old back", () => {
  const a = [
    { id: "1", text: "Nopa", done: false },
    { id: "2", text: "Zuni", done: false },
    { id: "3", text: "Tartine", done: false },
  ];
  const b = [
    { id: "4", text: "Flour + Water", done: false },
    { id: "3", text: "Tartine", done: true },
    { id: "1", text: "Nopa", done: false },
  ];
  const ops = diffData("l", "list", { items: a }, { items: b });
  const after = applyOps([list(a)], ops);
  assert.deepEqual(after[0].data.items, b);
  assert.deepEqual(applyOps(after, invertAll(ops))[0].data.items, a);
});

test("sections made, removed and renamed are operations too; live ones never are", () => {
  const before = [facts([]), { id: "live", type: "live", title: "Calendar", data: {} }];
  const after = [{ ...facts([]), title: "Me" }, list([{ id: "1", text: "Nopa", done: false }])];
  const ops = diffSections(before, after);
  assert.deepEqual(ops.map((o) => o.kind), ["rename", "create"]);
  const back = applyOps(applyOps(before, ops), invertAll(ops));
  assert.deepEqual(back.map((s) => s.title), ["About", "Calendar"]);
});

test("stale: an operation whose target changed since is found out", () => {
  const ops = diffData("f", "facts", { rows: [{ id: "r1", key: "Birthday", value: "14 March" }] }, { rows: [{ id: "r1", key: "Birthday", value: "15 March" }] });
  assert.equal(stale([facts([{ id: "r1", key: "Birthday", value: "14 March" }])], ops[0]), false);
  assert.equal(stale([facts([{ id: "r1", key: "Birthday", value: "1 April" }])], ops[0]), true);
});

test("net changes: several edits to one thing are one; changed back is nothing", () => {
  const op = (before, after) => ({ kind: "entry", sec: "f", id: "r1", prev: null, before, after });
  const r = (value) => ({ id: "r1", key: "Birthday", value });
  const net = netChanges([
    { op: op(r("1"), r("2")), by: "user", v: 2 },
    { op: op(r("2"), r("3")), by: "a1", v: 3 },
  ]);
  assert.equal(net.length, 1);
  assert.deepEqual([net[0].before.value, net[0].after.value, net[0].v], ["1", "3", 3]);
  assert.deepEqual(net[0].by, ["user", "a1"]);
  assert.equal(netChanges([{ op: op(r("1"), r("2")), by: "user", v: 2 }, { op: op(r("2"), r("1")), by: "user", v: 3 }]).length, 0);
});

test("net changes: a section made and removed again is nothing; removed takes its edits with it", () => {
  const made = { kind: "create", sec: "s", index: 0, after: { id: "s", title: "Tmp", type: "note", data: { text: "" } } };
  const gone = { kind: "remove", sec: "s", index: 0, before: made.after };
  const text = { kind: "text", sec: "s", before: "", after: "hi" };
  assert.equal(netChanges([{ op: made, by: "user", v: 2 }, { op: text, by: "user", v: 3 }, { op: gone, by: "user", v: 4 }]).length, 0);
  const net = netChanges([{ op: text, by: "user", v: 3 }, { op: gone, by: "user", v: 4 }]);
  assert.deepEqual(net.map((c) => c.kind), ["remove"]);
});
