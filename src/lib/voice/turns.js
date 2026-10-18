/* The small decisions a voice conversation makes about what was said
 * (docs/voice.md): a word alone that stops or ends it, what a recogniser
 * invents out of noise, what the agent is told when it was talked over, and
 * which sentences go to the voice together. */

const plain = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Said alone -- the whole of what was heard, nothing else -- these stop the
// answer, or end the conversation. "Stop doing that and try X" is a message.
const STOP = new Set(["stop", "stop it", "stop talking", "hold on", "wait", "shh", "quiet", "be quiet", "pause"]);
const END = new Set(["goodbye", "bye", "bye bye", "good bye", "end voice", "end the conversation", "stop listening", "that's all for now", "we're done"]);

/** "stop" when `text` is only a word to stop the answer, "end" when only one
 *  to end the conversation, else null. */
export function commandIn(text) {
  const said = plain(text);
  if (STOP.has(said)) return "stop";
  if (END.has(said)) return "end";
  return null;
}

// What Whisper writes for silence, breath or a hum: the sign-offs of the
// videos it learnt from. Only as the whole of what was heard.
const PHANTOMS = new Set([
  "thank you for watching", "thanks for watching", "thank you so much for watching", "thank you very much for watching",
  "please subscribe", "subscribe", "like and subscribe", "please like and subscribe", "don't forget to subscribe",
  "see you in the next video", "see you next time", "i'll see you in the next video", "bye bye see you next time",
  "you", "the end", "subtitles by the amara org community", "transcribed by", "sous titrage société radio canada",
  "untertitel im auftrag des zdf", "untertitel der amara org community", "ご視聴ありがとうございました",
  "продолжение следует", "субтитры сделал dimatorzok", "music",
]);

/** Whether `text` is a recogniser's invention rather than speech: one of the
 *  phrases it makes up, or a few words said over and over. ("Thank you" alone
 *  is kept: people say it to an agent.) */
export function isPhantom(text) {
  const said = plain(text);
  if (!said) return true;
  if (PHANTOMS.has(said)) return true;
  // "so so so so so", "thank you thank you thank you thank you"
  const words = said.split(" ");
  for (let size = 1; size <= 3; size++) {
    const unit = words.slice(0, size).join(" ");
    const times = words.length / size;
    if (Number.isInteger(times) && times >= 4 && Array.from({ length: times }, (_, i) => words.slice(i * size, i * size + size).join(" ")).every((w) => w === unit)) {
      return true;
    }
  }
  return false;
}

/** What the agent is told with the next message after the reader talked over
 *  it: how much of its answer was heard -- so it doesn't carry on as if all
 *  of it was, and can pick up where it was stopped. */
export function cutOffNote(heard) {
  const said = String(heard || "").trim();
  if (!said) return "(They spoke before you had said anything, so your last answer was stopped unheard.)";
  const tail = said.length > 300 ? `…${said.slice(-300)}` : said;
  return `(They talked over your last answer: they heard only "${tail}" and none of the rest. Don't repeat it unless they ask.)`;
}

// A piece shorter than this goes to the voice with the one after it: some
// voices make a clipped "Okay." sound like a different speaker.
const SHORTEST = 24;

/** The pieces of an answer (lib/voice/speakable.js `segments`) as they're
 *  handed to the voice: the first alone, so it starts as soon as it can, and
 *  after it a short one joined to the next. Stable as pieces are added, like
 *  `segments`; the last group waits for more unless `final`. */
export function phrases(pieces, { final = false } = {}) {
  if (!pieces.length) return [];
  const out = [pieces[0]];
  let group = [];
  for (const piece of pieces.slice(1)) {
    group.push(piece);
    if (group.join(" ").length >= SHORTEST) {
      out.push(group.join(" "));
      group = [];
    }
  }
  if (group.length && final) out.push(group.join(" "));
  return out;
}
