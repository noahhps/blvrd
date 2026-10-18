import { useEffect, useState } from "react";

import { hostOf, isLocalUrl } from "../lib/catalog.js";
import { inDesktop } from "../lib/http.js";
import { openMic, voiceOut } from "../lib/voice/audio.js";
import { HEARING, SPEAKING, engineOf, languageOf, transcribe, unusable, voicesOf } from "../lib/voice/engines.js";
import { PAUSES, createVad } from "../lib/voice/vad.js";
import { Icon } from "./Icon.jsx";

/* Settings → Voice: what hears you, what speaks for the agents, and how a
 * voice conversation takes turns (docs/voice.md). Each can be tried here. */

const LANGUAGES = [
  "en-US", "en-GB", "en-AU", "en-IN", "es-ES", "es-MX", "fr-FR", "fr-CA", "de-DE", "it-IT", "pt-BR", "pt-PT",
  "nl-NL", "sv-SE", "da-DK", "nb-NO", "fi-FI", "pl-PL", "tr-TR", "ru-RU", "uk-UA", "ja-JP", "ko-KR", "zh-CN",
  "zh-TW", "hi-IN", "ar-SA", "he-IL",
];
const SPEEDS = [0.85, 1, 1.15, 1.3];
const SAMPLE = "Hi! This is how I'll sound when we talk.";

const languageName = (code) => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
};

export function VoiceSettings({ voice, providers, onVoice }) {
  const setServer = (kind, id, patch) => {
    const key = `${kind}:${id}`;
    onVoice({ servers: { ...voice.servers, [key]: { ...voice.servers?.[key], ...patch } } });
  };
  const hear = engineOf("hear", voice, providers);
  const speak = engineOf("speak", voice, providers);
  return (
    <>
      <p className="settings-lede">
        Talk to an agent instead of typing: the{" "}
        <span className="inline-icon">
          <Icon name="wave" size={14} />
        </span>{" "}
        button by Send, in any chat. It listens, sends
        what you said when you pause, and reads the answer out as it arrives.
      </p>

      <section className="card">
        <h2>Hearing you</h2>
        <p className="hint">What writes down what you say.</p>
        <EngineChoice kind="hear" list={HEARING} engine={hear} onChoose={(id) => onVoice({ hear: id })} />
        <EngineFields engine={hear} onChange={(patch) => setServer("hear", hear.id, patch)} />
        <div className="voice-row">
          <label className="voice-field">
            <span>Language</span>
            <select value={voice.language} onChange={(e) => onVoice({ language: e.target.value })} aria-label="Language you speak">
              <option value="">This Mac’s ({languageName(languageOf({ language: "" }))})</option>
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)} ({code})
                </option>
              ))}
            </select>
          </label>
          <TryHearing engine={hear} voice={voice} />
        </div>
      </section>

      <section className="card">
        <h2>Speaking</h2>
        <p className="hint">The voice agents answer in. Each agent can have its own: Customize → Voice.</p>
        <EngineChoice kind="speak" list={SPEAKING} engine={speak} onChoose={(id) => onVoice({ speak: id })} />
        <EngineFields engine={speak} onChange={(patch) => setServer("speak", speak.id, patch)} />
        <div className="voice-row">
          <label className="voice-field">
            <span>Voice</span>
            <VoicePicker
              engine={speak}
              value={voice.voices?.[speak.id] || ""}
              defaultLabel={speak.mac ? "The Mac’s own" : speak.voice}
              onChange={(name) => onVoice({ voices: { ...voice.voices, [speak.id]: name } })}
            />
          </label>
          {!speak.fixedSpeed ? (
            <label className="voice-field">
              <span>Speed</span>
              <select value={voice.speed} onChange={(e) => onVoice({ speed: Number(e.target.value) })} aria-label="Speed">
                {SPEEDS.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Usual" : `${n}×`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <TrySpeaking engine={speak} voice={voice} />
        </div>
      </section>

      <section className="card">
        <h2>Taking turns</h2>
        <p className="hint">How long a pause means you’ve finished. Longer if you stop to think mid-sentence.</p>
        <div className="effort voice-pause" role="radiogroup" aria-label="Pause before it answers">
          {Object.keys(PAUSES).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={voice.pause === id} onClick={() => onVoice({ pause: id })}>
              {id[0].toUpperCase() + id.slice(1)} · {(PAUSES[id] / 1000).toFixed(1)}s
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={voice.interrupt} onChange={(e) => onVoice({ interrupt: e.target.checked })} />
          Talk over an agent to interrupt it
        </label>
        <p className="hint">
          Best with headphones. On speakers, if an agent keeps cutting itself off, turn this off: it then stops listening
          while it talks.
        </p>
      </section>
    </>
  );
}

/* Which engine, in two groups: on this computer, and hosted. */
function EngineChoice({ kind, list, engine, onChoose }) {
  const local = list.filter((e) => e.mac || (e.base && isLocalUrl(e.base)));
  const hosted = list.filter((e) => !local.includes(e) && !e.custom);
  const other = list.filter((e) => e.custom);
  const label = (e) => (e.mac && !inDesktop() && kind === "hear" ? `${e.name} (in the desktop app)` : e.name);
  return (
    <div className="search-fields">
      <select value={engine.id} onChange={(e) => onChoose(e.target.value)} aria-label={kind === "hear" ? "What hears you" : "What speaks"}>
        <optgroup label="On this computer">
          {local.map((e) => (
            <option key={e.id} value={e.id}>
              {label(e)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Hosted (your key)">
          {hosted.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </optgroup>
        {other.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/* A server's address, model and key -- and where what it's sent goes. */
function EngineFields({ engine, onChange }) {
  const hosted = !engine.mac && engine.base && !isLocalUrl(engine.base);
  return (
    <>
      {engine.note ? <p className="hint">{withCode(engine.note)}</p> : null}
      {engine.mac ? null : (
        <div className="voice-server">
          <input
            type="text"
            value={engine.base}
            placeholder="http://127.0.0.1:8000/v1"
            aria-label={`${engine.name} address`}
            spellCheck={false}
            onChange={(e) => onChange({ base: e.target.value.trim() })}
          />
          <input
            type="text"
            value={engine.model}
            placeholder="Model"
            aria-label={`${engine.name} model`}
            spellCheck={false}
            onChange={(e) => onChange({ model: e.target.value.trim() })}
          />
          <input
            type="password"
            value={engine.keyFrom ? "" : engine.key}
            placeholder={engine.keyFrom ? `Your ${engine.keyFrom} key from Models` : "Key (if it needs one)"}
            aria-label={`${engine.name} key`}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange({ key: e.target.value.trim() })}
          />
        </div>
      )}
      {hosted ? (
        <p className="hint">
          <span className="status">sends to {hostOf(engine.base)}</span>{" "}
          {engine.kind === "hear" ? "What you say is sent there to be written down." : "What agents say is sent there to be spoken."}
          {engine.keys ? (
            <>
              {" "}
              <a href={engine.keys} target="_blank" rel="noreferrer">
                Get a key
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** The voices an engine offers, with the default first. A server with no
 *  list can be given any name. */
export function VoicePicker({ engine, value, defaultLabel, onChange, label = "Voice" }) {
  const [voices, setVoices] = useState(null);
  useEffect(() => {
    let live = true;
    setVoices(null);
    voicesOf(engine)
      .then((list) => live && setVoices(list))
      .catch(() => live && setVoices([]));
    return () => {
      live = false;
    };
  }, [engine.id, engine.base, engine.key]);
  if (voices && !voices.length && !engine.mac) {
    return <input type="text" value={value} placeholder={defaultLabel || "Voice"} aria-label={label} spellCheck={false} onChange={(e) => onChange(e.target.value.trim())} />;
  }
  const list = voices || [];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={!voices}>
      <option value="">{voices ? `Default${defaultLabel ? ` (${defaultLabel})` : ""}` : "Finding voices…"}</option>
      {value && !list.includes(value) ? <option value={value}>{value}</option> : null}
      {list.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

/* Say something; see what was heard. */
function TryHearing({ engine, voice }) {
  const [state, setState] = useState({ step: "idle" });
  const why = unusable(engine);
  const run = async () => {
    setState({ step: "listening" });
    const vad = createVad({ pauseMs: PAUSES[voice.pause] || PAUSES.normal });
    let mic = null;
    let timer = 0;
    try {
      const wav = await new Promise((done, fail) => {
        timer = setTimeout(() => fail(new Error("Didn’t hear anything.")), 12_000);
        openMic({
          vad,
          onEvent: (e) => {
            if (e.type === "start") {
              clearTimeout(timer);
              setState({ step: "hearing" });
            }
            if (e.type === "end") done(e.wav);
          },
        })
          .then((m) => (mic = m))
          .catch(fail);
      });
      mic?.close();
      setState({ step: "writing" });
      const text = await transcribe(engine, wav, { language: languageOf(voice) });
      setState({ step: "done", text: text || "(nothing — try speaking up)" });
    } catch (problem) {
      setState({ step: "failed", text: problem?.message || String(problem) });
    } finally {
      clearTimeout(timer);
      mic?.close();
    }
  };
  const busy = ["listening", "hearing", "writing"].includes(state.step);
  return (
    <span className="voice-try">
      <button type="button" className="btn" onClick={run} disabled={busy || Boolean(why)} title={why || "Say something, then pause"}>
        <Icon name="mic" />
        {state.step === "listening" ? "Say something…" : state.step === "hearing" ? "Hearing you…" : state.step === "writing" ? "Writing it down…" : "Try it"}
      </button>
      {why ? <span className="hint warn">{why}</span> : null}
      {state.step === "done" ? <span className="voice-heard">“{state.text}”</span> : null}
      {state.step === "failed" ? <span className="hint warn">{state.text}</span> : null}
    </span>
  );
}

/* Hear the voice chosen. */
function TrySpeaking({ engine, voice }) {
  const [state, setState] = useState({ step: "idle" });
  const why = unusable(engine);
  const run = async () => {
    setState({ step: "speaking" });
    const out = voiceOut(engine, voice);
    try {
      await out.play(await out.synth(SAMPLE, null));
      setState({ step: "idle" });
    } catch (problem) {
      setState({ step: "failed", text: problem?.message || String(problem) });
    } finally {
      out.close();
    }
  };
  return (
    <span className="voice-try">
      <button type="button" className="btn" onClick={run} disabled={state.step === "speaking" || Boolean(why)} title={why || "Hear it"}>
        <Icon name="play" />
        {state.step === "speaking" ? "Speaking…" : "Hear it"}
      </button>
      {why ? <span className="hint warn">{why}</span> : null}
      {state.step === "failed" ? <span className="hint warn">{state.text}</span> : null}
    </span>
  );
}

/* `text in backticks` as code, the rest as it is. */
function withCode(text) {
  return String(text || "")
    .split(/(`[^`]+`)/)
    .map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part));
}
