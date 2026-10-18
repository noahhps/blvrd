/* Hearing when the reader starts and stops talking, from how loud each short
 * frame of the microphone is (docs/voice.md).
 *
 * The room's own level -- a fan, a street -- is followed as it changes, and
 * speech is what stands clear of it. A start needs a little run of speech, so
 * a click or a cough doesn't count; an end is a pause as long as the reader
 * chose in Settings; and an utterance with too little speech in it is let go
 * rather than sent to be written down. While the agent is talking (`strict`)
 * it takes more to count as a start, so its own voice coming back through the
 * speakers -- whatever echo cancelling leaves -- doesn't cut it off. And an
 * utterance whose loudness hardly moves is let go too: speech rises and falls
 * with every syllable, and a fan or a hum doesn't.
 *
 * Fed frames, not audio: `push(rms, ms)` with each frame's loudness and
 * length, so it can be tested without a microphone. */

export const PAUSES = {
  short: 550,
  normal: 900,
  long: 1600,
};

const LOUDNESS_FLOOR = -52; // dBFS: quieter than this is never speech
const MARGIN = 12; // dB above the room that counts as speech
const STRICT_MARGIN = 8; // more again while the agent is talking
const HOLD = 4; // dB less needed to keep speech going than to start it
const CALIBRATE_MS = 250; // listening to the room before anything counts
const STEADY = 2.5; // dB: speech whose loudness varies less than this is a hum

export function createVad({ pauseMs = PAUSES.normal, startMs = 160, minSpeechMs = 280, maxMs = 30_000 } = {}) {
  let floor = null; // the room, in dB
  let heardMs = 0;
  let strict = false;
  let speaking = false;
  let run = 0; // speech building towards a start
  let speech = 0; // speech in this utterance
  let silence = 0; // the pause so far
  let length = 0; // this utterance so far
  let level = 0;
  // How much the loudness of this utterance's speech moves (Welford's mean
  // and variance), to tell a voice from a hum.
  let n = 0;
  let mean = 0;
  let spread = 0;
  const note = (db) => {
    n += 1;
    const d = db - mean;
    mean += d / n;
    spread += d * (db - mean);
  };

  const toDb = (rms) => 20 * Math.log10(Math.max(rms, 1e-7));

  return {
    /** One frame. Says "start", "end" (an utterance worth writing down),
     *  "abandon" (one too slight to be) or null. */
    push(rms, ms) {
      const db = toDb(rms);
      heardMs += ms;
      if (floor === null) floor = db;
      const threshold = Math.max(floor + MARGIN + (strict ? STRICT_MARGIN : 0), LOUDNESS_FLOOR + (strict ? 6 : 0));
      level = Math.min(1, Math.max(0, (db - floor) / 36));

      const voiced = heardMs > CALIBRATE_MS && db > threshold - (speaking ? HOLD : 0);
      // The room is learnt from what isn't speech: quickly downwards, slowly
      // up -- and very slowly even through loud frames, so a noise that
      // stays (a fan turned on) stops counting as speech in time.
      floor += (db - floor) * (db < floor ? 0.25 : voiced ? 0.002 : 0.03);

      if (speaking) {
        length += ms;
        if (voiced) {
          speech += ms;
          silence = 0;
          note(db);
        } else silence += ms;
        if (silence >= pauseMs || length >= maxMs) {
          speaking = false;
          run = 0;
          const steady = n > 5 && Math.sqrt(spread / n) < STEADY;
          n = mean = spread = 0;
          return speech >= minSpeechMs && !steady ? "end" : "abandon";
        }
        return null;
      }

      // Speech comes in syllables: a gap between them takes back half as
      // much as a syllable gives.
      run = voiced ? run + ms : Math.max(0, run - ms / 2);
      if (voiced) note(db);
      else if (!run) n = mean = spread = 0;
      if (run >= (strict ? startMs * 2 : startMs)) {
        speaking = true;
        speech = run;
        length = run;
        silence = 0;
        return "start";
      }
      return null;
    },
    /** Harder to start while the agent is talking. */
    setStrict(on) {
      strict = Boolean(on);
    },
    setPause(ms) {
      pauseMs = ms;
    },
    /** Forget any utterance under way (the microphone was paused); the room
     *  is still known. */
    reset() {
      speaking = false;
      run = 0;
      level = 0;
      n = mean = spread = 0;
    },
    get speaking() {
      return speaking;
    },
    /** How loud the reader is over the room, 0 to 1, for drawing. */
    get level() {
      return level;
    },
    /** How much was heard before the start was sure: the microphone keeps
     *  this much from before it, so the first syllable isn't lost. */
    get leadMs() {
      return (strict ? startMs * 2 : startMs) + 300;
    },
  };
}
