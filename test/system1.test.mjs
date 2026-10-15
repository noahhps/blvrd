import assert from "node:assert/strict";
import { test } from "node:test";

import { lineOf, problemWithAll, questionsBody, run, s1Of, stateOf, summaryOf } from "../src/lib/system1.js";

const ollama = { id: "o", kind: "ollama", name: "Ollama", base: "http://localhost:11434/" };

// Answer every request with `reply(url, body)`, and keep what was asked.
function serve(reply) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push({ url, body });
    const [status, json] = reply(url, body);
    return new Response(typeof json === "string" ? json : JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  return { asked, done: () => (globalThis.fetch = real) };
}

const triage = {
  questions: [
    { name: "urgency", type: "score", instructions: "How urgent is this?", criteria: ["Routine", "Soon", "Immediate", ""] },
    { name: "refund", type: "noul", instructions: "Is a refund being requested?", criteria: { false: "", true: "The customer asks for money back" } },
    {
      name: "team",
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: [
        { key: "billing", description: "Payments and refunds" },
        { key: "technical", description: "" },
        { key: "", description: "left blank" },
      ],
    },
  ],
};

test("questions go to Ollama the way /v1/systemone takes them", () => {
  assert.deepEqual(questionsBody(triage.questions), {
    urgency: { type: "score", instructions: "How urgent is this?", criteria: ["Routine", "Soon", "Immediate"] },
    refund: { type: "noul", instructions: "Is a refund being requested?", criteria: { true: "The customer asks for money back" } },
    team: { type: "choice", instructions: "Which team should handle this?", criteria: { billing: "Payments and refunds", technical: null } },
  });
  // A yes/no question with no descriptions sends no criteria at all.
  assert.deepEqual(questionsBody([{ name: "q", type: "noul", instructions: "Is it?", criteria: { false: "", true: "" } }]), { q: { type: "noul", instructions: "Is it?" } });
});

test("a run asks /v1/systemone once, and gives back each answer in order", async () => {
  const s = serve(() => [
    200,
    {
      model: "tev1:0.8b",
      answers: {
        urgency: { type: "score", score: 1.2, legend: { 0: "Routine", 1: "Soon", 2: "Immediate" }, probabilities: { 0: 0.2, 1: 0.4, 2: 0.4 }, confidence: 0.1 },
        refund: { type: "noul", noul: 0.97 },
        team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1 }, confidence: 0.6 },
      },
      usage: { input_tokens: 174, output_tokens: 1 },
    },
  ]);
  try {
    const { result, markdown } = await run({ provider: ollama, model: "tev1:0.8b", input: "I was charged twice.", config: triage });
    assert.equal(s.asked.length, 1);
    assert.equal(s.asked[0].url, "http://localhost:11434/v1/systemone");
    assert.equal(s.asked[0].body.model, "tev1:0.8b");
    assert.equal(s.asked[0].body.state, "I was charged twice.");
    assert.deepEqual(Object.keys(s.asked[0].body.questions), ["urgency", "refund", "team"]);
    assert.deepEqual(result.answers.map((a) => a.name), ["urgency", "refund", "team"]);
    assert.equal(lineOf(result.answers[1]), "yes · 97%");
    assert.equal(lineOf(result.answers[2]), "billing · 90%");
    assert.match(lineOf(result.answers[0]), /^Soon · 1\.20 \/ 2$/);
    assert.match(markdown, /174 tokens in/);
  } finally {
    s.done();
  }
});

test("JSON input is sent as a JSON state, anything else as text", () => {
  assert.deepEqual(stateOf('{"ticket": "refund please"}'), { ticket: "refund please" });
  assert.equal(stateOf("{not json"), "{not json");
  assert.equal(stateOf("  plain words  "), "plain words");
});

test("Ollama's refusals come back as what to do about them", async () => {
  const cases = [
    [400, { error: 'model "llama3.2" does not support System One scoring; use a local decision model with a scoring-capable runner' }, /isn't a decision model/],
    [404, { error: "model 'nimble' not found" }, /ollama pull nimble/],
    [404, "404 page not found", /Ollama 0\.35/],
    [413, { error: "text and schema must not exceed 64 KiB" }, /64 KiB/],
    [400, { error: "rendered prompt exceeds the loaded context" }, /never cut short/],
  ];
  for (const [status, body, expected] of cases) {
    const s = serve(() => [status, body]);
    try {
      await assert.rejects(run({ provider: ollama, model: "nimble", input: "x", config: { questions: [{ name: "q", type: "noul", instructions: "Is it?" }] } }), expected);
    } finally {
      s.done();
    }
  }
});

test("questions are checked before anything is sent", () => {
  assert.match(problemWithAll({ questions: [] }), /at least one/);
  assert.match(problemWithAll({ questions: [{ name: "q", type: "noul", instructions: " " }] }), /written out/);
  assert.match(problemWithAll({ questions: [{ name: "q", type: "choice", instructions: "Which?", criteria: [{ key: "a", description: "" }] }] }), /2–26 options/);
  assert.match(problemWithAll({ questions: [{ name: "q", type: "score", instructions: "How?", criteria: ["low"] }] }), /2–10 levels/);
  assert.match(
    problemWithAll({
      questions: [
        { name: "q", type: "noul", instructions: "A?" },
        { name: "q", type: "noul", instructions: "B?" },
      ],
    }),
    /same name/,
  );
  assert.equal(problemWithAll(triage), null);
});

test("an agent from when System 1 meant embeddings keeps its labels as a choice", () => {
  const { questions } = s1Of({ s1: { task: "classify", labels: ["question", "bug report"] } });
  assert.equal(questions[0].type, "choice");
  assert.deepEqual(questions[0].criteria.map((o) => o.key), ["question", "bug report"]);
  assert.equal(s1Of({}).questions[0].type, "noul");
  assert.equal(summaryOf(triage), "3 questions");
  assert.equal(summaryOf({ questions: [triage.questions[2]] }), "Chooses");
});
