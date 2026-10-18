/* The microphone and the speakers, for a voice conversation (docs/voice.md).
 *
 * The microphone is the webview's own, with the system's echo cancelling, so
 * an agent's voice from the speakers mostly isn't heard back. Every short
 * frame goes to the detector (lib/voice/vad.js); an utterance it ends is
 * handed on as a WAV at 16 kHz, starting a little before the detector was
 * sure, so the first syllable isn't lost.
 *
 * Sound to play is decoded and played through Web Audio, which can be cut
 * off mid-word; in a plain browser, where this Mac's voices aren't there to
 * ask, the browser's own speech is used instead. */

import { inDesktop } from "../http.js";
import { SPEECH_RATE, join, resample, rmsOf, wavOf } from "./pcm.js";
import { synthesize, voiceFor } from "./engines.js";

const FRAME = 1024; // samples a frame: about 21 ms at 48 kHz

/** Listens until closed. `onEvent` hears { type: "start" } when the reader
 *  starts talking, { type: "end", wav, ms } for what they said, { type:
 *  "abandon" } for a sound too slight to send, and { type: "lost" } if the
 *  microphone goes away. */
export async function openMic({ vad, onEvent }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This window has no microphone to use.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const Context = window.AudioContext || window.webkitAudioContext;
  const ctx = new Context();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  // A ScriptProcessor rather than an AudioWorklet: a worklet is a module of
  // its own to load, and this one does no more than copy each frame out.
  const node = ctx.createScriptProcessor(FRAME, 1, 1);
  const frameMs = (FRAME / ctx.sampleRate) * 1000;
  let before = [];
  let taking = null;
  let paused = false;

  node.onaudioprocess = (e) => {
    if (paused) return;
    const frame = new Float32Array(e.inputBuffer.getChannelData(0));
    const event = vad.push(rmsOf(frame), frameMs);
    if (taking) taking.push(frame);
    else {
      before.push(frame);
      const keep = Math.ceil(vad.leadMs / frameMs);
      if (before.length > keep) before.splice(0, before.length - keep);
    }
    if (event === "start") {
      taking = before;
      before = [];
      onEvent({ type: "start" });
    } else if (event === "end" || event === "abandon") {
      const frames = taking || [];
      taking = null;
      const ms = frames.length * frameMs;
      onEvent(event === "end" ? { type: "end", ms, wav: wavOf(resample(join(frames), ctx.sampleRate, SPEECH_RATE), SPEECH_RATE) } : { type: "abandon" });
    }
  };
  source.connect(node);
  // A processor only runs connected to an output; it writes nothing to it.
  node.connect(ctx.destination);
  for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => onEvent({ type: "lost" }));

  return {
    /** Stop hearing for a while (muted, or the agent talking with
     *  interrupting off), dropping anything half heard. */
    pause(on) {
      if (paused === Boolean(on)) return;
      paused = Boolean(on);
      if (paused) {
        const was = Boolean(taking);
        taking = null;
        before = [];
        vad.reset();
        if (was) onEvent({ type: "abandon" });
      }
    },
    get level() {
      return paused ? 0 : vad.level;
    },
    close() {
      node.onaudioprocess = null;
      node.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      ctx.close().catch(() => {});
    },
  };
}

/** How an engine's words reach the speakers: `synth(text, agent)` makes a
 *  clip in that agent's voice, `play(clip)` resolves once it's been heard,
 *  `halt(clip)` cuts it off. For lib/voice/speaker.js. */
export function voiceOut(engine, voice) {
  // This Mac's voices with no Mac to ask: the browser's own speech.
  if (engine.mac && !inDesktop()) return browserVoice(voice);
  let ctx = null;
  const context = () => {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  };
  return {
    async synth(text, agent) {
      const bytes = await synthesize(engine, text, { voice: voiceFor(agent, engine, voice), speed: voice.speed });
      return { buffer: await context().decodeAudioData(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer) };
    },
    play(clip) {
      return new Promise((done) => {
        const source = context().createBufferSource();
        source.buffer = clip.buffer;
        source.connect(ctx.destination);
        source.onended = () => done();
        clip.source = source;
        source.start();
      });
    },
    halt(clip) {
      try {
        clip.source?.stop();
      } catch {
        // Already over.
      }
    },
    close() {
      ctx?.close().catch(() => {});
    },
  };
}

function browserVoice(voice) {
  const synth = window.speechSynthesis;
  return {
    async synth(text, agent) {
      if (!synth) throw new Error("This browser can't speak.");
      const name = agent?.voices?.mac || voice.voices?.mac || "";
      return { text, voice: synth.getVoices().find((v) => v.name === name) || null };
    },
    play(clip) {
      return new Promise((done) => {
        const say = new SpeechSynthesisUtterance(clip.text);
        if (clip.voice) say.voice = clip.voice;
        say.rate = voice.speed || 1;
        say.onend = say.onerror = () => done();
        synth.speak(say);
      });
    },
    halt() {
      synth?.cancel();
    },
    close() {
      synth?.cancel();
    },
  };
}
