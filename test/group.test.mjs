import { test } from "node:test";
import assert from "node:assert/strict";

import { EVERYONE, groupBrief, mentionSpans, mentionsEveryone, mentionsIn, respondersFor, viewFor } from "../src/lib/group.js";

const members = [
  { id: "r", name: "Researcher" },
  { id: "c", name: "Coder" },
  { id: "w", name: "Writer" },
];
const nameOf = (id) => members.find((m) => m.id === id)?.name || "Someone";

test("mentions are found by name, in order, case-insensitively, and not inside words or emails", () => {
  assert.deepEqual(mentionsIn("@writer then @Coder, please", members), ["w", "c"]);
  assert.deepEqual(mentionsIn("mail me at me@coder.dev", members), []);
  assert.deepEqual(mentionsIn("@Coders unite", members), []);
  assert.deepEqual(mentionsIn("ask @Coder twice: @coder", members), ["c"]);
});

test("everyone answers unless someone is picked or named", () => {
  assert.deepEqual(respondersFor({ members, text: "hi all" }), ["r", "c", "w"]);
  assert.deepEqual(respondersFor({ members, text: "@Writer polish this" }), ["w"]);
  // Picked and named together, in the group's order.
  assert.deepEqual(respondersFor({ members, picked: ["w"], text: "and @Researcher" }), ["r", "w"]);
});

test("each agent sees its own turns as its own and everyone else's as labelled lines", () => {
  const chat = [
    { role: "user", content: "Plan a launch" },
    { role: "assistant", agentId: "r", content: "Here is what I found.", calls: [] },
    { role: "assistant", agentId: "c", content: "", calls: [{ id: "x", name: "calculate", args: {} }] },
    { role: "tool", agentId: "c", callId: "x", name: "calculate", content: "2 = 2" },
    { role: "assistant", agentId: "c", content: "It costs 2.", calls: [] },
    { role: "assistant", agentId: "w", failure: "no model" },
    { role: "user", content: "@Writer draft it" },
  ];

  const writer = viewFor("w", chat, nameOf);
  // All of it is someone else's, so it folds into user turns -- the failure dropped.
  assert.equal(writer.length, 1);
  assert.equal(writer[0].role, "user");
  assert.match(writer[0].content, /^\[User\]: Plan a launch\n\n\[Researcher\]: Here is what I found\.\n\n\[Coder\]: It costs 2\.\n\n\[User\]: @Writer draft it$/);

  const coder = viewFor("c", chat, nameOf);
  assert.deepEqual(coder.map((m) => m.role), ["user", "assistant", "tool", "assistant", "user"]);
  assert.equal(coder[1].calls[0].name, "calculate");
  assert.equal(coder[3].agentId, undefined, "the tag is not sent to the model");
  assert.match(coder[0].content, /\[Researcher\]: Here is what I found/);
});

test("the brief names the other members and how to hand off", () => {
  const brief = groupBrief(members[1], members, { name: "Launch" }, () => "does things");
  assert.match(brief, /group chat called "Launch"/);
  assert.match(brief, /- Researcher: does things/);
  assert.ok(!brief.includes("- Coder:"));
  assert.match(brief, /@Researcher/);
});

test("every @Name is found where it is, the longer name winning", () => {
  const people = [
    { id: "a", name: "Ann" },
    { id: "al", name: "Ann Lee" },
    { id: "w", name: "Writer" },
  ];
  assert.deepEqual(mentionSpans("@writer, then @Ann Lee and @Ann", people), [
    { start: 0, end: 7, id: "w" },
    { start: 14, end: 22, id: "al" },
    { start: 27, end: 31, id: "a" },
  ]);
  assert.deepEqual(mentionSpans("me@writer.dev @Writers", people), []);
});

test("@everyone asks the whole group, whoever else was picked or named", () => {
  const members = [{ id: "w", name: "Writer" }, { id: "c", name: "Coder" }];
  assert.ok(mentionsEveryone("@everyone, thoughts?"));
  assert.ok(!mentionsEveryone("tell everyone@home.dev"));
  assert.deepEqual(respondersFor({ members, picked: ["c"], text: "@Writer and @Everyone" }), ["w", "c"]);
  assert.deepEqual(mentionSpans("hi @everyone", [EVERYONE]), [{ start: 3, end: 12, id: "everyone" }]);
  // Not a handoff: an agent's @everyone names nobody.
  assert.deepEqual(mentionsIn("@everyone look", members), []);
});
