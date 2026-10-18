/* Small sounds that say where a voice conversation is, without looking
 * (docs/voice.md): two rising notes when it starts listening, a soft tick
 * when it has heard you and is sending what you said, a quiet pulse every
 * couple of seconds while the agent works with nothing to say yet, and two
 * falling notes when it ends. Made on the spot with Web Audio -- no files --
 * and kept quiet and short, under what the microphone takes for speech. */

const VOLUME = 0.06;

export function createCues({ on = true } = {}) {
  let ctx = null;
  let pulse = 0;
  const context = () => {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  };
  // One soft note: a sine with a quick rise and a gentle fall.
  const note = (hz, at = 0, ms = 110, volume = VOLUME) => {
    if (!on) return;
    try {
      const c = context();
      const start = c.currentTime + at / 1000;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + ms / 1000 + 0.02);
    } catch {
      // No sound to make; the strip still says it.
    }
  };
  return {
    listening: () => (note(660, 0, 120), note(880, 110, 160)),
    heard: () => note(988, 0, 70, VOLUME * 0.7),
    ended: () => (note(880, 0, 120), note(587, 110, 180)),
    /** A quiet pulse while it works silently; stopped by anything said. */
    working(on) {
      clearInterval(pulse);
      pulse = 0;
      if (on) pulse = setInterval(() => note(392, 0, 160, VOLUME * 0.45), 2200);
    },
    close() {
      clearInterval(pulse);
      ctx?.close().catch(() => {});
    },
  };
}
