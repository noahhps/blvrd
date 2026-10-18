/* Saying an answer's sentences one after another (docs/voice.md).
 *
 * Each sentence is made into sound (`synth`) a little ahead of its turn --
 * while the one before it plays -- so there's no gap between them waiting on
 * a speech server, and no more than `ahead` are asked for at once, so a
 * local one isn't handed a whole answer to make before the first sentence
 * plays. `stop` silences it at once and drops the rest: the reader talked
 * over it, or stopped the answer.
 *
 * What makes and plays the sound is passed in -- this Mac's voices, a speech
 * server, the browser's own -- so the order and the stopping are the same
 * for all of them, and can be tested without any. */

/**
 * `synth(text, who)` resolves to a clip; `play(clip)` resolves when it has
 * been heard; `halt(clip)` cuts off one playing. `onBusy(busy)` hears when it
 * starts and finishes having something to say; `onProblem(error)` hears a
 * sentence that couldn't be made or played (it is skipped).
 */
export function createSpeaker({ synth, play, halt = () => {}, onBusy = () => {}, onProblem = () => {}, ahead = 2 }) {
  let queue = []; // [{ text, who, clip: Promise | null }]
  let playing = null; // { clip }
  let round = 0; // goes up with each stop: work for an earlier one is let go
  let busy = false;

  const setBusy = (next) => {
    if (next === busy) return;
    busy = next;
    onBusy(busy);
  };

  const prepare = () => {
    let made = playing ? 1 : 0;
    for (const item of queue) {
      if (made >= ahead) break;
      if (!item.clip) {
        item.clip = Promise.resolve()
          .then(() => synth(item.text, item.who))
          .catch((problem) => {
            onProblem(problem);
            return null;
          });
      }
      made += 1;
    }
  };

  const next = async () => {
    if (playing) return;
    const item = queue.shift();
    if (!item) return setBusy(false);
    const mine = round;
    playing = { clip: null };
    prepare();
    const clip = await item.clip;
    if (mine !== round) return; // stopped while it was being made
    playing.clip = clip;
    prepare();
    if (clip) {
      try {
        await play(clip);
      } catch (problem) {
        if (mine === round) onProblem(problem);
      }
    }
    if (mine !== round) return;
    playing = null;
    next();
  };

  return {
    /** One more sentence, said after the ones already waiting. */
    say(text, who = null) {
      if (!String(text || "").trim()) return;
      queue.push({ text, who, clip: null });
      setBusy(true);
      prepare();
      next();
    },
    /** Quiet now, and nothing more of what was waiting. */
    stop() {
      round += 1;
      const was = playing;
      queue = [];
      playing = null;
      if (was?.clip) halt(was.clip);
      setBusy(false);
    },
    get busy() {
      return busy;
    },
  };
}
