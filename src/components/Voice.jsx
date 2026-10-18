import { useEffect, useRef, useState } from "react";

import { openMic, voiceOut } from "../lib/voice/audio.js";
import { engineOf, languageOf, transcribe, unusable } from "../lib/voice/engines.js";
import { createSpeaker } from "../lib/voice/speaker.js";
import { segments } from "../lib/voice/speakable.js";
import { PAUSES, createVad } from "../lib/voice/vad.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Icon } from "./Icon.jsx";

/* Talking with an agent instead of typing (docs/voice.md).
 *
 * Turned on in a chat, blvrd listens: when you stop for a moment, what you
 * said is written down (lib/voice/engines.js) and sent as your message, and
 * the answer is read out a sentence at a time as it arrives. Talk while it's
 * speaking and it stops and listens; talk while it's still thinking or
 * working and what you say waits its turn, like a message typed then. Go on
 * talking just after a pause and it's one message, not two.
 *
 * Everything else is the chat as it is: what you said and what it answered
 * are on the screen, the box still takes typing, and anything that needs
 * your OK is asked there -- it says so out loud. */

const MOODS = { listening: "listening", hearing: "listening", writing: "thinking", thinking: "thinking", speaking: "speaking" };

/**
 * The voice conversation in one chat. `live` is this chat's answer arriving
 * (or null); `agentOf(id)` the agent who said a message (a group's members,
 * by `agentId`), for its voice. `onSend(text)` sends what was said;
 * `onStop()` stops the answer.
 */
export function useVoice({ chatId, settings, providers, messages, live, approval, agentOf, onSend, onStop }) {
  // The chat it's on in: going to another chat ends it.
  const [onIn, setOnIn] = useState(null);
  const on = onIn === chatId;
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState(null); // { text, lasting }
  const [heard, setHeard] = useState("");
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const session = useRef(null);
  const latest = useRef(null);
  latest.current = { live, messages, onSend, onStop, agentOf, muted, settings };

  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (!on) return undefined;
    setProblem(null);
    setHeard("");
    const hear = engineOf("hear", settings, providers);
    const speak = engineOf("speak", settings, providers);
    const why = unusable(hear) || unusable(speak);
    if (why) {
      setProblem({ text: why, lasting: true });
      return undefined;
    }
    let closed = false;
    const vad = createVad({ pauseMs: PAUSES[settings.pause] || PAUSES.normal });
    const out = voiceOut(speak, settings);
    const s = {
      vad,
      out,
      mic: null,
      pending: 0, // recordings being written down
      parts: [], // what was said, waiting to go as one message
      said: 0, // pieces of the answer arriving already handed to the speaker
      seen: latest.current.messages.length,
      silenced: false, // talked over: nothing more of this answer is said
      asked: null, // the approval last said out loud
    };
    // With interrupting off, it doesn't listen while it talks.
    const listen = () => s.mic?.pause(latest.current.muted || (!settings.interrupt && s.speaker.busy));
    s.speaker = createSpeaker({
      synth: out.synth,
      play: out.play,
      halt: out.halt,
      onBusy: (busy) => {
        vad.setStrict(busy);
        listen();
        refresh();
      },
      onProblem: (p) => setProblem({ text: `Couldn’t speak: ${p?.message || p}` }),
    });
    s.listen = listen;
    session.current = s;

    // What's been said, once nothing more is coming: not while a recording
    // is still being written down, nor while the reader has started again.
    const flush = () => {
      if (s.pending || vad.speaking || !s.parts.length) return;
      const text = s.parts.join(" ");
      s.parts = [];
      latest.current.onSend(text);
    };

    const onMic = (event) => {
      if (closed) return;
      if (event.type === "start") {
        // Talking over the agent: it stops, and listens.
        if (s.speaker.busy) {
          s.speaker.stop();
          if (latest.current.live) {
            s.silenced = true;
            latest.current.onStop();
          }
        }
      } else if (event.type === "end") {
        s.pending += 1;
        transcribe(hear, event.wav, { language: languageOf(settings) })
          .then((text) => {
            if (closed || !text) return;
            s.parts.push(text);
            setHeard(text);
            setProblem((p) => (p?.lasting ? p : null));
          })
          .catch((p) => !closed && setProblem({ text: `Couldn’t hear that: ${p?.message || p}` }))
          .finally(() => {
            s.pending -= 1;
            if (!closed) {
              flush();
              refresh();
            }
          });
      } else if (event.type === "lost") {
        setProblem({ text: "The microphone went away. Turn voice off and on again to pick another.", lasting: true });
      }
      if (event.type === "abandon") flush();
      refresh();
    };

    openMic({ vad, onEvent: onMic })
      .then((mic) => {
        if (closed) return mic.close();
        s.mic = mic;
        listen();
        refresh();
      })
      .catch((p) => !closed && setProblem({ text: micProblem(p), lasting: true }));

    return () => {
      closed = true;
      s.mic?.close();
      s.speaker.stop();
      out.close();
      session.current = null;
      refresh();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, settingsKey]);

  // Muting stops the listening, not the speaking.
  useEffect(() => session.current?.listen(), [muted]);

  // The answer, read out as it arrives: finished messages first (their last
  // piece with them), then whatever whole sentences have arrived of the one
  // under way. Pieces already handed over aren't said again.
  useEffect(() => {
    const s = session.current;
    if (!s) return;
    const say = (pieces, who) => {
      for (const piece of pieces.slice(s.said)) s.speaker.say(piece, who);
      s.said = Math.max(s.said, pieces.length);
    };
    for (let i = s.seen; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      if (!s.silenced) {
        const who = agentOf(m.agentId);
        if (m.failure) s.speaker.say("That didn’t work. The reason is on the screen.", who);
        else say(segments(m.content || "", { final: true }), who);
      }
      s.said = 0;
    }
    s.seen = messages.length;
    if (live) {
      if (!s.silenced) say(segments(live.text || ""), agentOf(live.agentId));
    } else {
      s.silenced = false;
      s.said = 0;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, live?.text, Boolean(live), on]);

  // A question waiting on the screen is said out loud, once.
  useEffect(() => {
    const s = session.current;
    if (!s || !approval || s.asked === approval) return;
    s.asked = approval;
    s.speaker.say(`${approval.agentName} needs your OK on the screen before going on.`, agentOf(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval, on]);

  const s = session.current;
  const phase = !on
    ? "off"
    : problem?.lasting
      ? "problem"
      : !s?.mic
        ? "starting"
        : muted
          ? "muted"
          : s.vad.speaking
            ? "hearing"
            : s.pending
              ? "writing"
              : s.speaker.busy
                ? "speaking"
                : live
                  ? "thinking"
                  : "listening";

  return {
    on,
    phase,
    muted,
    problem: problem?.text || "",
    heard,
    level: () => session.current?.mic?.level || 0,
    start: () => {
      setMuted(false);
      setOnIn(chatId);
    },
    end: () => setOnIn(null),
    toggleMute: () => setMuted((m) => !m),
    /** Quiet: the answer was stopped from the screen. */
    hush: () => {
      const s = session.current;
      if (!s) return;
      s.speaker.stop();
      if (latest.current.live) s.silenced = true;
    },
  };
}

function micProblem(problem) {
  const name = problem?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "blvrd isn’t allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "There’s no microphone to listen with.";
  return `Couldn’t start the microphone: ${problem?.message || problem}`;
}

const SAYS = {
  starting: "Starting the microphone…",
  listening: "Listening",
  hearing: "Hearing you…",
  writing: "Writing down what you said…",
  thinking: "Thinking…",
  speaking: "Speaking — talk to interrupt",
  muted: "Muted",
};

/** The button in the composer that starts and ends talking. */
export function VoiceButton({ voice }) {
  return (
    <button
      type="button"
      className="chip icon voice-toggle"
      aria-pressed={voice.on}
      aria-label={voice.on ? "Stop talking by voice" : "Talk by voice"}
      title={voice.on ? "Stop talking by voice" : "Talk by voice"}
      onClick={voice.on ? voice.end : voice.start}
    >
      <Icon name="wave" size={16} />
    </button>
  );
}

/** Above the composer while talking: the agent, what's happening, how
 *  loud you are, and mute and end. */
export function VoiceBar({ voice, agent, interrupt = true }) {
  const meter = useRef(null);
  useEffect(() => {
    if (!voice.on) return undefined;
    let frame = 0;
    const draw = () => {
      meter.current?.style.setProperty("--level", voice.level().toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [voice.on, voice.level]);
  if (!voice.on) return null;
  const says = voice.phase === "problem" ? voice.problem : voice.phase === "speaking" && !interrupt ? "Speaking" : SAYS[voice.phase];
  const note = voice.phase === "problem" ? "" : voice.problem || (voice.heard ? `“${voice.heard}”` : "Say something, then pause. Your words are sent when you stop.");
  return (
    <div className="voice-bar" data-phase={voice.phase} role="status" aria-live="polite">
      {agent ? <AgentAvatar look={agent.look} name={agent.name} size={34} alive={false} mood={MOODS[voice.phase] || null} /> : null}
      <span className="voice-says">
        <span className="voice-state">{says}</span>
        {note ? <span className={`voice-note${voice.problem && voice.phase !== "problem" ? " warn" : ""}`}>{note}</span> : null}
      </span>
      <span className="voice-meter" ref={meter} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <button
        type="button"
        className="btn icon-only"
        aria-pressed={voice.muted}
        aria-label={voice.muted ? "Unmute" : "Mute"}
        title={voice.muted ? "Unmute" : "Mute: it stops listening, and still speaks"}
        onClick={voice.toggleMute}
        disabled={voice.phase === "problem"}
      >
        <Icon name={voice.muted ? "mic-off" : "mic"} size={16} />
      </button>
      <button type="button" className="btn voice-end" onClick={voice.end}>
        End
      </button>
    </div>
  );
}
