/* A voice conversation (docs/voice.md): what of an answer is said and in
 * what pieces as it streams, hearing where the reader starts and stops, the
 * recording sent to be written down, the order sentences are said in and
 * stopping them, and the requests to speech servers. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { segments, spokenOf } from "../src/lib/voice/speakable.js";
import { PAUSES, createVad } from "../src/lib/voice/vad.js";
import { join, resample, rmsOf, wavOf } from "../src/lib/voice/pcm.js";
import { createSpeaker } from "../src/lib/voice/speaker.js";
import { cleanHeard, engineOf, languageOf, sortVoices, speechRequest, transcriptionRequest, unusable, voiceFor, voiceOf } from "../src/lib/voice/engines.js";

/* -- what is said ----------------------------------------------------------- */

test("an answer streamed a few letters at a time is said in the same pieces as the whole of it", () => {
  const answer = [
    "Sure! The meeting is at 3.30 p.m. on Friday, with Dr. Okafor and e.g. the design team.",
    "",
    "## What to bring",
    "- The **draft** budget",
    "- A [link to the deck](https://example.com/deck) and `notes.md`",
    "",
    "```js",
    "const secret = 1;",
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "That's all. See you there…",
  ].join("\n");
  const whole = segments(answer, { final: true });
  assert.deepEqual(whole, [
    "Sure!",
    "The meeting is at 3.30 p.m. on Friday, with Dr. Okafor and e.g. the design team.",
    "What to bring.",
    "The draft budget.",
    "A link to the deck and notes.md.",
    "That's all.",
    "See you there…",
  ]);

  // Every prefix gives a beginning of the whole, never a piece that changes.
  let said = 0;
  for (let n = 1; n <= answer.length; n += 3) {
    const now = segments(answer.slice(0, n));
    assert.deepEqual(now, whole.slice(0, now.length), `after ${n} characters`);
    assert.ok(now.length >= said, "pieces are never taken back");
    said = now.length;
  }
});

test("a sentence isn't said until it has really ended", () => {
  assert.deepEqual(segments("It costs 3."), []);
  assert.deepEqual(segments("It costs 3.14 dollars"), []);
  assert.deepEqual(segments("It costs 3.14 dollars. And"), ["It costs 3.14 dollars."]);
  assert.deepEqual(segments("It costs 3.14 dollars", { final: true }), ["It costs 3.14 dollars"]);
  // A list item is whole once its line ends, punctuation or not.
  assert.deepEqual(segments("- milk"), []);
  assert.deepEqual(segments("- milk\n"), ["milk."]);
});

test("thinking, and a call written as text, are never said", () => {
  assert.deepEqual(segments("<think>The user wants. Hmm. Let me see</think>Hello there. How", {}), ["Hello there."]);
  assert.deepEqual(segments("<think>Still thinking. More "), []);
  // A template that opened the thinking itself: only what follows the close.
  assert.deepEqual(segments("Plan: call it. Ok.</think>Done. Bye", { final: true }), ["Done.", "Bye"]);
  assert.deepEqual(segments('Let me check. <tool_call>{"name": "clock"}</tool_call>', { final: true }), ["Let me check."]);
  assert.deepEqual(segments("Let me check. <tool_"), ["Let me check."]);
  assert.deepEqual(segments("One moment. [TOOL_CALLS] clock [ARGS] {}", { final: true }), ["One moment."]);
});

test("markdown is said as its words", () => {
  assert.equal(spokenOf("**Bold**, *soft* and __under__ ~~gone~~ snake_case_name 2 * 3"), "Bold, soft and under gone snake_case_name 2 * 3");
  assert.equal(spokenOf("Read https://www.nytimes.com/2026/10/x.html today."), "Read nytimes.com today.");
  assert.equal(spokenOf("> Quoted wisdom 🎉 here"), "Quoted wisdom here");
  assert.equal(spokenOf("1. First\n2. Second!"), "First. Second!");
  assert.equal(spokenOf("![chart](a.png)"), "");
});

test("a very long sentence is said in parts, at its commas", () => {
  const long = Array.from({ length: 30 }, (_, i) => `item number ${i}`).join(", ") + ".";
  const pieces = segments(long, { final: true });
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((p) => p.length <= 240));
  assert.equal(pieces.join(" "), long);
});

/* -- hearing ---------------------------------------------------------------- */

// Frames of 20 ms: `db` loud, for `ms`. Speech (`talk`) rises and falls,
// a syllable every 100 ms; a hum doesn't.
const feed = (vad, db, ms) => {
  const out = [];
  for (let t = 0; t < ms; t += 20) {
    const event = vad.push(10 ** ((typeof db === "function" ? db(t) : db) / 20), 20);
    if (event) out.push(event);
  }
  return out;
};
const talk = (db) => (t) => (Math.floor(t / 100) % 2 ? db - 8 : db);

test("speech over a quiet room starts and ends an utterance after the pause", () => {
  const vad = createVad({ pauseMs: PAUSES.normal });
  assert.deepEqual(feed(vad, -60, 1000), []);
  assert.deepEqual(feed(vad, talk(-25), 1200), ["start"]);
  assert.ok(vad.speaking);
  // A breath between words isn't the end.
  assert.deepEqual(feed(vad, -60, 400), []);
  assert.deepEqual(feed(vad, talk(-25), 600), []);
  assert.deepEqual(feed(vad, -60, 1000), ["end"]);
  assert.ok(!vad.speaking);
});

test("a click or a short knock is let go, and a steady noise stops counting", () => {
  const vad = createVad();
  feed(vad, -60, 1000);
  assert.deepEqual(feed(vad, -20, 60), []);
  assert.deepEqual(feed(vad, -60, 500), []);
  // Just long enough to start, too little speech in it to send.
  assert.deepEqual(feed(vad, -20, 180), ["start"]);
  assert.deepEqual(feed(vad, -60, 1000), ["abandon"]);
  // A fan comes on: never sent as speech, and soon it's the room.
  const events = feed(vad, (t) => -35 + Math.sin(t / 50), 60_000);
  assert.ok(!events.includes("end"), events.join(","));
  assert.deepEqual(feed(vad, -35, 5000), []);
  // Someone talking over the fan is still heard.
  assert.deepEqual(feed(vad, talk(-15), 1000), ["start"]);
  assert.deepEqual(feed(vad, -35, 1000), ["end"]);
});

test("while the agent talks it takes louder, longer speech to interrupt", () => {
  const vad = createVad();
  feed(vad, -60, 1000);
  vad.setStrict(true);
  // Its own voice leaking back, quieter: not a start.
  assert.deepEqual(feed(vad, -44, 2000), []);
  assert.deepEqual(feed(vad, -60, 200), []);
  // The reader talking over it.
  assert.deepEqual(feed(vad, talk(-20), 400), ["start"]);
});

/* -- the recording ------------------------------------------------------------ */

test("a recording is sent as a 16 kHz, 16-bit WAV", () => {
  const second = new Float32Array(48_000).map((_, i) => Math.sin((i / 48_000) * 2 * Math.PI * 440) * 0.5);
  const down = resample(second, 48_000, 16_000);
  assert.equal(down.length, 16_000);
  assert.ok(Math.abs(rmsOf(down) - rmsOf(second)) < 0.01);
  const wav = wavOf(down, 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 32_000);
  assert.equal(wav.length, 44 + 32_000);
  assert.deepEqual(join([new Float32Array([1, 2]), new Float32Array([3])]), new Float32Array([1, 2, 3]));
});

/* -- saying it ------------------------------------------------------------------ */

const tick = () => new Promise((done) => setTimeout(done, 0));

function fakeVoice({ slow = new Set() } = {}) {
  const log = [];
  const waiting = new Map();
  return {
    log,
    finish: (text) => waiting.get(text)?.(),
    synth: async (text, who) => {
      log.push(`make ${text}`);
      if (slow.has(text)) await new Promise((done) => setTimeout(done, 20));
      return { text, who };
    },
    play: (clip) =>
      new Promise((done) => {
        log.push(`play ${clip.text}${clip.who ? ` as ${clip.who}` : ""}`);
        waiting.set(clip.text, done);
      }),
    halt: (clip) => {
      log.push(`halt ${clip.text}`);
      waiting.get(clip.text)?.();
    },
  };
}

test("sentences are said in order, the next made while one plays, no more than two at once", async () => {
  const voice = fakeVoice({ slow: new Set(["One."]) });
  const busy = [];
  const speaker = createSpeaker({ ...voice, onBusy: (b) => busy.push(b) });
  speaker.say("One.", "Ada");
  speaker.say("Two.");
  speaker.say("Three.");
  await new Promise((done) => setTimeout(done, 40));
  assert.deepEqual(voice.log, ["make One.", "make Two.", "play One. as Ada"]);
  voice.finish("One.");
  await tick();
  await tick();
  assert.deepEqual(voice.log.slice(3), ["make Three.", "play Two."]);
  voice.finish("Two.");
  await tick();
  await tick();
  voice.finish("Three.");
  await tick();
  await tick();
  assert.deepEqual(voice.log.slice(5), ["play Three."]);
  assert.deepEqual(busy, [true, false]);
});

test("stopping cuts the sentence playing and drops the rest", async () => {
  const voice = fakeVoice();
  const speaker = createSpeaker(voice);
  speaker.say("One.");
  speaker.say("Two.");
  speaker.say("Three.");
  await tick();
  await tick();
  speaker.stop();
  await tick();
  await tick();
  assert.ok(!speaker.busy);
  assert.deepEqual(voice.log, ["make One.", "make Two.", "play One.", "halt One."]);
  // And it speaks again afterwards.
  speaker.say("Four.");
  await tick();
  await tick();
  assert.equal(voice.log.at(-1), "play Four.");
});

test("a sentence that can't be made is skipped, and said why", async () => {
  const problems = [];
  const voice = fakeVoice();
  const speaker = createSpeaker({
    ...voice,
    synth: async (text) => {
      if (text === "Bad.") throw new Error("server down");
      return { text };
    },
    onProblem: (p) => problems.push(p.message),
  });
  speaker.say("Bad.");
  speaker.say("Good.");
  await tick();
  await tick();
  await tick();
  assert.deepEqual(problems, ["server down"]);
  assert.equal(voice.log.at(-1), "play Good.");
});

/* -- the engines ------------------------------------------------------------------ */

const PROVIDERS = [{ id: "groq", name: "Groq", key: "gsk_model_key" }, { id: "openai", name: "OpenAI", key: "" }];

test("a hosted engine uses the key its host has under Models, unless given its own", () => {
  const voice = voiceOf({ voice: { hear: "groq", speak: "openai" } });
  const hear = engineOf("hear", voice, PROVIDERS);
  assert.equal(hear.key, "gsk_model_key");
  assert.equal(hear.keyFrom, "Groq");
  assert.equal(unusable(hear), null);
  const speak = engineOf("speak", voice, PROVIDERS);
  assert.match(unusable(speak), /needs a key/);
  const own = engineOf("speak", { ...voice, servers: { "speak:openai": { key: "sk-own", model: "tts-1" } } }, PROVIDERS);
  assert.equal(own.key, "sk-own");
  assert.equal(own.model, "tts-1");
  assert.equal(own.keyFrom, null);
});

test("a recording goes as a form, with the language alone; whisper.cpp to its own path", async () => {
  const voice = voiceOf({ voice: { hear: "groq" } });
  const { url, init } = transcriptionRequest(engineOf("hear", voice, PROVIDERS), new Uint8Array([1, 2, 3]), { language: "en-GB" });
  assert.equal(url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(init.headers.Authorization, "Bearer gsk_model_key");
  assert.equal(init.body.get("model"), "whisper-large-v3-turbo");
  assert.equal(init.body.get("language"), "en");
  assert.equal((await init.body.get("file").arrayBuffer()).byteLength, 3);
  const local = transcriptionRequest(engineOf("hear", voiceOf({ voice: { hear: "whispercpp" } })), new Uint8Array(1));
  assert.equal(local.url, "http://127.0.0.1:2022/inference");
  assert.equal(local.init.headers.Authorization, undefined);
});

test("speech is asked for as WAV, in the agent's voice, at the reader's speed where the engine takes one", () => {
  const voice = voiceOf({ voice: { speak: "kokoro", speed: 1.2, voices: { kokoro: "af_bella" } } });
  const engine = engineOf("speak", voice);
  assert.equal(voiceFor({ voices: { kokoro: "bm_george" } }, engine, voice), "bm_george");
  assert.equal(voiceFor({ voices: {} }, engine, voice), "af_bella");
  const { url, init } = speechRequest(engine, "Hello.", { voice: "bm_george", speed: 1.2 });
  assert.equal(url, "http://127.0.0.1:8880/v1/audio/speech");
  assert.deepEqual(JSON.parse(init.body), { model: "kokoro", input: "Hello.", voice: "bm_george", response_format: "wav", speed: 1.2 });
  const groq = speechRequest(engineOf("speak", voiceOf({ voice: { speak: "groq" } }), PROVIDERS), "Hi.", { speed: 1.2 });
  assert.equal(JSON.parse(groq.init.body).speed, undefined);
  assert.equal(JSON.parse(groq.init.body).voice, "autumn");
});

test("what a recogniser writes for no words is nothing", () => {
  assert.equal(cleanHeard(" [BLANK_AUDIO] "), "");
  assert.equal(cleanHeard("(music)"), "");
  assert.equal(cleanHeard("..."), "");
  assert.equal(cleanHeard("  Book a table   for two. "), "Book a table for two.");
});

test("the Mac's voices: the reader's language and the natural ones first, novelties last", () => {
  const sorted = sortVoices(
    [
      { name: "Zarvox", lang: "en_US" },
      { name: "Amélie", lang: "fr_CA" },
      { name: "Samantha", lang: "en_US" },
      { name: "Ava (Premium)", lang: "en_US" },
      { name: "Daniel", lang: "en_GB" },
    ],
    "en-US",
  );
  assert.deepEqual(sorted.map((v) => v.name), ["Ava (Premium)", "Daniel", "Samantha", "Amélie", "Zarvox"]);
  assert.ok(sorted.at(-1).novelty);
  assert.equal(sorted[0].lang, "en-US");
});

test("the language listened for is a plain tag", () => {
  assert.equal(languageOf({ language: "fr-CA" }), "fr-CA");
  assert.equal(languageOf({ language: "en_GB" }), "en-GB");
  assert.equal(languageOf({ language: "en-US@posix" }), "en-US");
});

/* -- taking turns (lib/voice/turns.js) ------------------------------------------ */

import { commandIn, cutOffNote, isPhantom, phrases } from "../src/lib/voice/turns.js";
import { leastOf } from "../src/lib/thinking.js";

test("a word alone stops the answer or ends the conversation; in a sentence it's a message", () => {
  assert.equal(commandIn("Stop."), "stop");
  assert.equal(commandIn("  wait!  "), "stop");
  assert.equal(commandIn("Goodbye!"), "end");
  assert.equal(commandIn("Okay, bye bye."), null);
  assert.equal(commandIn("Bye-bye"), "end");
  assert.equal(commandIn("Stop doing that and try the other file"), null);
  assert.equal(commandIn("Can you wait for the build?"), null);
});

test("what Whisper invents out of noise isn't sent; what people say is", () => {
  for (const phantom of ["Thanks for watching!", "Thank you for watching.", "Please subscribe.", "you", "Subtitles by the Amara.org community", "so so so so so", "Thank you. Thank you. Thank you. Thank you."]) {
    assert.ok(isPhantom(phantom), phantom);
    assert.equal(cleanHeard(phantom), "", phantom);
  }
  for (const real of ["Thank you!", "Thanks, that's all.", "Subscribe me to the newsletter", "You did great", "so what now"]) {
    assert.ok(!isPhantom(real), real);
  }
});

test("talked over, the agent hears how much of its answer was heard", () => {
  assert.match(cutOffNote("Sure! It's sunny today."), /heard only "Sure! It's sunny today\." and none of the rest/);
  assert.match(cutOffNote(""), /before you had said anything/);
  const long = cutOffNote("x".repeat(500));
  assert.ok(long.length < 420);
});

test("short sentences go to the voice with the next, but never hold up the first", () => {
  const pieces = ["Sure!", "Okay.", "It's sunny today, about 21 degrees.", "Yes.", "No."];
  assert.deepEqual(phrases(pieces, { final: true }), ["Sure!", "Okay. It's sunny today, about 21 degrees.", "Yes. No."]);
  // Stable as pieces arrive: a prefix gives a beginning of the whole, and a
  // short last group waits.
  for (let n = 0; n <= pieces.length; n++) {
    const now = phrases(pieces.slice(0, n));
    assert.deepEqual(now, phrases(pieces, { final: true }).slice(0, now.length));
  }
  assert.deepEqual(phrases(["Sure!", "Okay."]), ["Sure!"]);
});

test("a spoken turn thinks as little as the model allows", () => {
  assert.deepEqual(leastOf({ mode: "switch", default: true }).value, false);
  assert.deepEqual(leastOf({ mode: "effort", options: ["low", "medium", "high"] }).value, "low");
  assert.equal(leastOf({ mode: "none" }), null);
});

test("the speaker says which sentence is being heard as it starts", async () => {
  const heard = [];
  const voice = fakeVoice();
  const speaker = createSpeaker({ ...voice, onPlay: (text, who) => heard.push(`${text}${who ? ` (${who})` : ""}`) });
  speaker.say("One.", "Ada");
  speaker.say("Two.");
  await tick();
  await tick();
  assert.deepEqual(heard, ["One. (Ada)"]);
  voice.finish("One.");
  await tick();
  await tick();
  await tick();
  assert.deepEqual(heard, ["One. (Ada)", "Two."]);
});
