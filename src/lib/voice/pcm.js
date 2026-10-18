/* Audio as numbers: a frame's loudness, a recording at the rate speech
 * recognisers want, and a WAV file of it -- the one format every one of them
 * takes (docs/voice.md). */

/** The root-mean-square of a frame: its loudness, 0 to 1. */
export function rmsOf(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Frames as one recording. */
export function join(frames) {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/** `samples` at `from` Hz as they'd be at `to` Hz. Going down, each new
 *  sample is the average of the ones it stands for, which keeps what's above
 *  the new rate's reach from folding back in as noise. */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio;
    if (ratio > 1) {
      const a = Math.floor(start);
      const b = Math.min(samples.length, Math.floor(start + ratio));
      let sum = 0;
      for (let j = a; j < b; j++) sum += samples[j];
      out[i] = b > a ? sum / (b - a) : samples[a] || 0;
    } else {
      const a = Math.floor(start);
      const t = start - a;
      out[i] = (samples[a] || 0) * (1 - t) + (samples[a + 1] ?? samples[a] ?? 0) * t;
    }
  }
  return out;
}

/** A mono 16-bit WAV file of `samples` at `rate` Hz. */
export function wavOf(samples, rate) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // the format block's size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a sample
  view.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** The rate recordings are sent at: what Whisper and Apple's recogniser
 *  work in, and a quarter of the size of what a microphone gives. */
export const SPEECH_RATE = 16_000;
