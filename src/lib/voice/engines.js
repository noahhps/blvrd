/* What hears the reader and what speaks for the agents (docs/voice.md).
 *
 * Hearing -- speech to text -- is this Mac's own recogniser, on the device,
 * or any server that takes a recording the way Whisper's API does:
 * whisper.cpp or Speaches on this machine, or Groq, OpenAI or Mistral with
 * the key already given them under Models. Speaking -- text to speech -- is
 * this Mac's voices, or a server that answers the way OpenAI's speech API
 * does: Kokoro or Speaches here, or OpenAI or Groq.
 *
 * As with model servers (lib/catalog.js), a hosted one is sent what it's
 * for -- your voice, or the agent's words -- and the app says so wherever one
 * is chosen. Models and voices can be changed: hosts rename them. */

import { failure, httpFetch, inDesktop } from "../http.js";
import { invoke } from "../desktop.js";

export const HEARING = [
  {
    id: "mac",
    name: "This Mac",
    mac: true,
    note: "Apple’s speech recognition, on this Mac. Nothing to install, and nothing you say leaves it. It needs Dictation’s language downloaded: System Settings → Keyboard → Dictation.",
  },
  {
    id: "whispercpp",
    name: "whisper.cpp",
    base: "http://127.0.0.1:2022",
    path: "/inference",
    note: "`whisper-server -m models/ggml-large-v3-turbo.bin --port 2022` — fast on Apple silicon.",
    site: "https://github.com/ggml-org/whisper.cpp",
  },
  {
    id: "speaches",
    name: "Speaches",
    base: "http://127.0.0.1:8000/v1",
    model: "Systran/faster-whisper-small",
    note: "Whisper and Kokoro behind one OpenAI-compatible server.",
    site: "https://speaches.ai",
  },
  { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", uses: "groq", keys: "https://console.groq.com/keys" },
  { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini-transcribe", uses: "openai", keys: "https://platform.openai.com/api-keys" },
  { id: "mistral", name: "Mistral", base: "https://api.mistral.ai/v1", model: "voxtral-mini-latest", uses: "mistral", keys: "https://console.mistral.ai/api-keys" },
  { id: "custom", name: "Another server", base: "", model: "whisper-1", custom: true, note: "Anything with an OpenAI-compatible /audio/transcriptions." },
];

const KOKORO_VOICES = [
  "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_nova", "af_aoede", "af_kore", "af_river", "af_jessica",
  "am_michael", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_onyx", "am_puck",
  "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_lewis", "bm_daniel", "bm_fable",
];

export const SPEAKING = [
  {
    id: "mac",
    name: "This Mac’s voices",
    mac: true,
    note: "The voices macOS speaks with. The Premium and Enhanced ones sound far more natural: add them in System Settings → Accessibility → Spoken Content → System voice → Manage Voices.",
  },
  {
    id: "kokoro",
    name: "Kokoro",
    base: "http://127.0.0.1:8880/v1",
    model: "kokoro",
    voice: "af_heart",
    voices: KOKORO_VOICES,
    note: "A small, natural-sounding voice model. `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`",
    site: "https://github.com/remsky/Kokoro-FastAPI",
  },
  {
    id: "speaches",
    name: "Speaches",
    base: "http://127.0.0.1:8000/v1",
    model: "speaches-ai/Kokoro-82M-v1.0-ONNX",
    voice: "af_heart",
    voices: KOKORO_VOICES,
    note: "Whisper and Kokoro behind one OpenAI-compatible server.",
    site: "https://speaches.ai",
  },
  {
    id: "openai",
    name: "OpenAI",
    base: "https://api.openai.com/v1",
    model: "gpt-4o-mini-tts",
    voice: "coral",
    voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"],
    uses: "openai",
    keys: "https://platform.openai.com/api-keys",
  },
  {
    id: "groq",
    name: "Groq",
    base: "https://api.groq.com/openai/v1",
    model: "canopylabs/orpheus-v1-english",
    voice: "autumn",
    voices: ["autumn", "diana", "hannah", "austin", "daniel", "troy"],
    uses: "groq",
    keys: "https://console.groq.com/keys",
    // Orpheus doesn't take a speed.
    fixedSpeed: true,
  },
  { id: "custom", name: "Another server", base: "", model: "tts-1", voice: "alloy", voices: [], custom: true, note: "Anything with an OpenAI-compatible /audio/speech." },
];

const BY_ID = { hear: new Map(HEARING.map((e) => [e.id, e])), speak: new Map(SPEAKING.map((e) => [e.id, e])) };

/* What's kept (lib/store.js `voice`), with what isn't set yet filled in. */
export const VOICE_DEFAULTS = {
  hear: "mac",
  speak: "mac",
  servers: {}, // { "hear:<id>" | "speak:<id>": { base?, model?, key? } }
  voices: {}, // { [speaking engine id]: voice } -- the default voice for each
  speed: 1,
  pause: "normal",
  interrupt: true,
  language: "", // "" = this Mac's own
};

export const voiceOf = (state) => ({ ...VOICE_DEFAULTS, ...(state?.voice || {}) });

/** One engine as it's set up: the catalog's entry, the reader's changes, and
 *  a key -- its own, or the one its host has under Models. */
export function engineOf(kind, voice, providers = []) {
  const id = kind === "hear" ? voice.hear : voice.speak;
  const entry = BY_ID[kind].get(id) || BY_ID[kind].get("mac");
  const saved = voice.servers?.[`${kind}:${entry.id}`] || {};
  const host = entry.uses ? providers.find((p) => p.id === entry.uses) : null;
  return {
    ...entry,
    kind,
    base: (saved.base || entry.base || "").replace(/\/+$/, ""),
    model: saved.model ?? entry.model ?? "",
    key: saved.key || host?.key || "",
    keyFrom: !saved.key && host?.key ? host.name : null,
  };
}

/** The language to listen for: the reader's choice, or this Mac's -- as a
 *  plain tag ("en-US"), without the variants a system can add ("@posix"). */
export const languageOf = (voice) =>
  (voice.language || (typeof navigator !== "undefined" && navigator.language) || "en-US").replace(/[@.].*$/, "").replace("_", "-") || "en-US";

/** Whether an engine can work where blvrd is running, and if not, why. */
export function unusable(engine) {
  if (engine.mac && !inDesktop() && engine.kind === "hear") return "Hearing on this Mac needs the desktop app. Choose a speech server in Settings → Voice.";
  if (!engine.mac && !engine.base) return `${engine.name} has no address yet: add one in Settings → Voice.`;
  if (engine.uses && !engine.key) return `${engine.name} needs a key: add one in Settings → Voice, or under Models.`;
  return null;
}

/* -- hearing ------------------------------------------------------------------ */

/** The request that has `engine` write down a WAV recording. */
export function transcriptionRequest(engine, wav, { language = "" } = {}) {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
  if (engine.model) form.append("model", engine.model);
  // Whisper wants the language alone ("en"), not the region.
  const lang = language.split(/[-_]/)[0].toLowerCase();
  if (lang) form.append("language", lang);
  form.append("response_format", "json");
  return {
    url: `${engine.base}${engine.path || "/audio/transcriptions"}`,
    init: { method: "POST", body: form, headers: engine.key ? { Authorization: `Bearer ${engine.key}` } : {} },
  };
}

/** What was said in a WAV recording, as text. */
export async function transcribe(engine, wav, { language, signal } = {}) {
  if (engine.mac) {
    const text = await invoke("voice_hear", wav, "Hearing on this Mac", { headers: { "x-language": language || "en-US" } });
    return cleanHeard(text);
  }
  const { url, init } = transcriptionRequest(engine, wav, { language });
  const response = await httpFetch(url, { ...init, signal });
  if (!response.ok) throw await failure(response, engine.name);
  const data = await response.json();
  return cleanHeard(data.text ?? data.transcription ?? "");
}

/* What a recogniser writes for a recording with no words in it -- Whisper
   on a cough or a door: "[BLANK_AUDIO]", "(music)" -- is nothing. */
export function cleanHeard(text) {
  const s = String(text || "")
    .replace(/\[[^\]]*\]|\((?:music|silence|noise|applause|laughter|inaudible)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : "";
}

/* -- speaking ----------------------------------------------------------------- */

/** The request that has `engine` say `text`. */
export function speechRequest(engine, text, { voice = "", speed = 1 } = {}) {
  const body = { model: engine.model, input: text, voice: voice || engine.voice, response_format: "wav" };
  if (!engine.fixedSpeed && speed !== 1) body.speed = speed;
  return {
    url: `${engine.base}/audio/speech`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(engine.key ? { Authorization: `Bearer ${engine.key}` } : {}) },
      body: JSON.stringify(body),
    },
  };
}

/** `text` said by `engine`, as the bytes of a sound file. */
export async function synthesize(engine, text, { voice, speed = 1, signal } = {}) {
  if (engine.mac) {
    // `say` counts words a minute; 185 is about its usual pace.
    const rate = speed === 1 ? null : Math.round(185 * speed);
    return invoke("voice_say", { text, voice: voice || null, rate }, "This Mac’s voices");
  }
  const { url, init } = speechRequest(engine, text, { voice, speed });
  const response = await httpFetch(url, { ...init, signal });
  if (!response.ok) throw await failure(response, engine.name);
  return response.arrayBuffer();
}

/* The Mac's voices, asked once a launch. Novelty voices ("Bells",
   "Zarvox") are kept apart, at the end; Premium and Enhanced ones first. */
const NOVELTY = new Set([
  "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Fred", "Good News", "Jester", "Junior",
  "Kathy", "Organ", "Ralph", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox",
]);
let macVoices = null;

/** The voices the Mac speaks with: [{ name, lang, best, novelty }], the
 *  reader's language first. In a plain browser, the browser's own. */
export function voicesOnMac() {
  macVoices ||= (async () => {
    const found = inDesktop()
      ? await invoke("voice_voices", {}, "This Mac’s voices")
      : (typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []).map((v) => ({ name: v.name, lang: v.lang }));
    return sortVoices(found);
  })().catch((problem) => {
    macVoices = null;
    throw problem;
  });
  return macVoices;
}

export function sortVoices(found, language = typeof navigator !== "undefined" ? navigator.language : "en-US") {
  const mine = (language || "en").split(/[-_]/)[0].toLowerCase();
  return found
    .map((v) => ({
      name: v.name,
      lang: String(v.lang || "").replace("_", "-"),
      best: /\b(Premium|Enhanced)\b/.test(v.name),
      novelty: NOVELTY.has(v.name.replace(/\s*\(.*\)$/, "")),
    }))
    .sort(
      (a, b) =>
        a.novelty - b.novelty ||
        Number(b.lang.toLowerCase().startsWith(mine)) - Number(a.lang.toLowerCase().startsWith(mine)) ||
        Number(b.best) - Number(a.best) ||
        a.lang.localeCompare(b.lang) ||
        a.name.localeCompare(b.name),
    );
}

/** The voices a speaking engine offers: the Mac's, a server's own list when
 *  it gives one (Kokoro's /audio/voices), or the catalog's. Names only. */
export async function voicesOf(engine) {
  if (engine.mac) return (await voicesOnMac()).filter((v) => !v.novelty).map((v) => v.name);
  try {
    const response = await httpFetch(`${engine.base}/audio/voices`, { headers: engine.key ? { Authorization: `Bearer ${engine.key}` } : {} });
    if (response.ok) {
      const data = await response.json();
      const list = (Array.isArray(data) ? data : data.voices || []).map((v) => (typeof v === "string" ? v : v.id || v.name)).filter(Boolean);
      if (list.length) return list;
    }
  } catch {
    // The catalog's list will do.
  }
  return engine.voices || [];
}

/** The voice `agent` speaks with on `engine`: its own, or the default. */
export const voiceFor = (agent, engine, voice) => agent?.voices?.[engine.id] || voice.voices?.[engine.id] || engine.voice || "";
