import { useEffect, useRef, useState } from "react";

import { openMic, voiceOut } from "../lib/voice/audio.js";
import { createCues } from "../lib/voice/cues.js";
import { engineOf, languageOf, transcribe, unusable } from "../lib/voice/engines.js";
import { createSpeaker } from "../lib/voice/speaker.js";
import { segments } from "../lib/voice/speakable.js";
import { commandIn, phrases } from "../lib/voice/turns.js";
import { PAUSES, createVad } from "../lib/voice/vad.js";
import { AgentAvatar } from "./AgentAvatar.jsx";
import { Icon } from "./Icon.jsx";

/* Talking with an agent instead of typing (docs/voice.md).
 *
 * Turned on in a chat, blvrd listens -- hands-free, or while you hold Space
 * or the talk button. What you said is written down (lib/voice/engines.js)
 * and sent as your message, and the answer is read out a sentence at a time
 * as it arrives, with what's being said shown as it's said. Talk over it --
 * while it speaks or while it's still thinking -- and it stops, listens, and
 * is told how much you heard; talk while it's busy with a tool and what you
 * say waits its turn, like a message typed then. Go on talking just after a
 * pause and it's one message. "Stop" alone stops it; "goodbye" ends the
 * conversation, as does five quiet minutes.
 *
 * Everything else is the chat as it is: what you said and what it answered
 * are on the screen, the box still takes typing, and anything that needs
 * your OK is asked there -- it says so out loud. The full view puts the
 * agent large in the middle, like a phone call. */

const MOODS = { listening: "listening", ready: "listening", hearing: "listening", writing: "thinking", thinking: "thinking", working: "thinking", speaking: "speaking" };
const IDLE_MS = 5 * 60_000; // quiet this long, and it ends
const GRACE_MS = 500; // a start this soon after it begins to speak is its own voice

/**
 * The voice conversation in one chat. `live` is this chat's answer arriving
 * (or null); `agentOf(id)` the agent who said a message (a group's members,
 * by `agentId`), for its voice. `onSend(text, { cutOff })` sends what was
 * said, with -- after the reader talked over an answer -- how much of it they
 * heard (lib/voice/turns.js cutOffNote); `onStop()` stops the answer.
 */
export function useVoice({ chatId, settings, providers, messages, live, approval, agentOf, onSend, onStop }) {
  // The chat it's on in: going to another chat ends it.
  const [onIn, setOnIn] = useState(null);
  const on = onIn === chatId;
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [problem, setProblem] = useState(null); // { text, lasting }
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState(""); // what the agent is saying now
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const session = useRef(null);
  const latest = useRef(null);
  latest.current = { live, messages, onSend, onStop, agentOf, muted, settings };
  const push = settings?.mode === "push";

  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (!on) return undefined;
    setProblem(null);
    setHeard("");
    setCaption("");
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
    const cues = createCues({ on: settings.sounds !== false });
    const s = {
      vad,
      out,
      cues,
      mic: null,
      pending: 0, // recordings being written down
      parts: [], // what was said, waiting to go as one message
      said: 0, // phrases of the answer arriving already handed to the speaker
      seen: latest.current.messages.length,
      silenced: false, // talked over: nothing more of this answer is said
      asked: null, // the approval last said out loud
      played: [], // what of the last answer was heard, and by whom
      by: null,
      cutOff: null, // { heard, agentId } once talked over, until the next message
      busySince: 0,
      waiting: false, // sent, and nothing said back yet
      answering: false, // its answer has begun since it was sent
      lastActive: Date.now(),
    };
    const busyNow = () => s.speaker.busy || s.waiting;
    // Harder to start while it talks or works; and with interrupting off, it
    // doesn't listen while it talks at all.
    const listen = () => {
      vad.setStrict(busyNow());
      s.mic?.pause(latest.current.muted || (!settings.interrupt && !push && s.speaker.busy));
    };
    const wait = (on) => {
      s.waiting = on;
      cues.working(on);
      listen();
    };
    s.speaker = createSpeaker({
      synth: out.synth,
      play: out.play,
      halt: out.halt,
      onBusy: (busy) => {
        if (busy) s.busySince = Date.now();
        else setCaption("");
        s.lastActive = Date.now();
        listen();
        refresh();
      },
      onPlay: (text, who) => {
        s.played.push(text);
        s.by = who?.id ?? null;
        setCaption(text);
        wait(false);
      },
      onProblem: (p) => setProblem({ text: `Couldn’t speak: ${p?.message || p}` }),
    });
    s.listen = listen;
    // The reader talking: while the key is held when pushing to talk (the
    // detector then only draws the level), else as the detector hears it.
    s.talking = () => (push ? Boolean(s.holding) : vad.speaking);

    // Busy with a tool -- the computer, a search -- rather than writing: the
    // reader's words wait their turn instead of stopping it.
    const working = () => {
      const l = latest.current.live;
      return Boolean(l && (l.status || l.parts?.at(-1)?.type === "call"));
    };
    // Talked over: quiet now, and the answer stopped unless a tool is at work.
    // What was heard of it goes with the next message.
    s.interrupt = () => {
      const l = latest.current.live;
      const speaking = s.speaker.busy;
      s.speaker.stop();
      wait(false);
      if (!speaking && !(l && !working())) return;
      s.cutOff = { heard: s.played.join(" "), agentId: s.by ?? l?.agentId ?? null };
      if (l) {
        s.silenced = true;
        if (!working()) latest.current.onStop();
      }
    };
    s.end = () => {
      cues.ended();
      setOnIn(null);
    };
    session.current = s;

    // What's been said, once nothing more is coming: not while a recording
    // is still being written down, nor while the reader has started again.
    const flush = () => {
      if (s.pending || s.talking() || !s.parts.length) return;
      const text = s.parts.join(" ");
      s.parts = [];
      latest.current.onSend(text, { cutOff: s.cutOff });
      s.cutOff = null;
      s.played = [];
      s.by = null;
      s.answering = false;
      wait(true);
    };

    const onMic = (event) => {
      if (closed) return;
      s.lastActive = Date.now();
      if (event.type === "start") {
        // Its own voice, the moment it starts to speak: not the reader.
        if (!push && s.speaker.busy && Date.now() - s.busySince < GRACE_MS) {
          s.mic.drop();
          return;
        }
        if ((push || settings.interrupt) && (s.speaker.busy || (latest.current.live && !working()))) s.interrupt();
      } else if (event.type === "end") {
        s.pending += 1;
        cues.heard();
        transcribe(hear, event.wav, { language: languageOf(settings) })
          .then((text) => {
            if (closed || !text) return;
            const command = commandIn(text);
            if (command === "end") return s.end();
            if (command === "stop") return s.interrupt();
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

    openMic({ vad, onEvent: onMic, push })
      .then((mic) => {
        if (closed) return mic.close();
        s.mic = mic;
        listen();
        cues.listening();
        refresh();
      })
      .catch((p) => !closed && setProblem({ text: micProblem(p), lasting: true }));

    // Five quiet minutes -- nobody talking, nothing answering -- and it ends,
    // rather than leave a microphone open that's been forgotten.
    const idle = setInterval(() => {
      const quiet = !latest.current.live && !s.speaker.busy && !s.talking() && !s.pending;
      if (!quiet) s.lastActive = Date.now();
      else if (Date.now() - s.lastActive > IDLE_MS) s.end();
    }, 10_000);

    return () => {
      closed = true;
      clearInterval(idle);
      s.mic?.close();
      s.speaker.stop();
      cues.working(false);
      out.close();
      // Long enough for the closing notes to be heard.
      setTimeout(() => cues.close(), 600);
      session.current = null;
      setFull(false);
      refresh();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, settingsKey]);

  // Muting stops the listening, not the speaking.
  useEffect(() => session.current?.listen(), [muted]);

  // Push to talk: Space held anywhere but in a box being typed in.
  useEffect(() => {
    if (!on || !push) return undefined;
    const typing = (e) => e.target.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
    const down = (e) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      e.preventDefault();
      hold(true);
    };
    const up = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      hold(false);
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", up);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, push]);

  // The answer, read out as it arrives: finished messages first (their last
  // phrase with them), then whatever whole phrases have arrived of the one
  // under way. Phrases already handed over aren't said again.
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
        else say(phrases(segments(m.content || "", { final: true }), { final: true }), who);
      }
      s.said = 0;
    }
    s.seen = messages.length;
    if (live) {
      s.answering = true;
      if (!s.silenced) say(phrases(segments(live.text || "")), agentOf(live.agentId));
    } else {
      s.silenced = false;
      s.said = 0;
      // Answered and nothing to say (a stopped turn). Not before the answer
      // has begun: the message shows a moment before it does.
      if (s.waiting && s.answering && !s.speaker.busy) {
        s.waiting = false;
        s.cues.working(false);
        s.listen();
      }
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

  const hold = (down) => {
    const s = session.current;
    if (!s?.mic || latest.current.muted) return;
    s.holding = down;
    s.mic.hold(down);
    refresh();
  };

  const s = session.current;
  const phase = !on
    ? "off"
    : problem?.lasting
      ? "problem"
      : !s?.mic
        ? "starting"
        : muted
          ? "muted"
          : s.talking()
            ? "hearing"
            : s.pending
              ? "writing"
              : s.speaker.busy
                ? "speaking"
                : live
                  ? live.status || live.parts?.at(-1)?.type === "call"
                    ? "working"
                    : "thinking"
                  : push
                    ? "ready"
                    : "listening";

  return {
    on,
    phase,
    push,
    muted,
    full,
    problem: problem?.text || "",
    heard,
    caption,
    level: () => session.current?.mic?.level || 0,
    start: () => {
      setMuted(false);
      setOnIn(chatId);
    },
    end: () => session.current?.end() ?? setOnIn(null),
    toggleMute: () => setMuted((m) => !m),
    toggleFull: () => setFull((f) => !f),
    hold,
    /** Stop it talking (the strip's button), as talking over it would. */
    interrupt: () => session.current?.interrupt(),
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
  ready: "Hold Space to talk",
  hearing: "Hearing you…",
  writing: "Writing down what you said…",
  thinking: "Thinking…",
  working: "Working on it…",
  speaking: "Speaking",
  muted: "Muted",
};

const saysOf = (voice) => (voice.phase === "problem" ? voice.problem : SAYS[voice.phase]);

/* What goes under the state: what's being said, else what you said, else
   how this works. */
function noteOf(voice, interrupt) {
  if (voice.phase === "problem") return "";
  if (voice.problem) return voice.problem;
  if (voice.phase === "speaking" && voice.caption) return voice.caption;
  if (voice.push && voice.phase === "hearing") return "Let go when you’re done.";
  if (voice.heard) return `“${voice.heard}”`;
  if (voice.push) return "Or hold the talk button. Let go and it’s sent.";
  return interrupt ? "Talk, then pause. Talk over it any time to interrupt." : "Talk, then pause. Your words are sent when you stop.";
}

/* Drawn every frame from how loud the reader is, as --level on `ref`. */
function useLevel(voice, ref) {
  useEffect(() => {
    if (!voice.on) return undefined;
    let frame = 0;
    const draw = () => {
      ref.current?.style.setProperty("--level", voice.level().toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [voice.on, voice.level]);
}

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

/* Held to talk: pointer down to up, as Space is. */
function TalkButton({ voice, big = false }) {
  const press = (down) => (e) => {
    e.preventDefault();
    if (down) e.currentTarget.setPointerCapture?.(e.pointerId);
    voice.hold(down);
  };
  return (
    <button
      type="button"
      className={`btn voice-talk${big ? " big" : ""}`}
      aria-pressed={voice.phase === "hearing"}
      disabled={voice.muted || voice.phase === "problem" || voice.phase === "starting"}
      onPointerDown={press(true)}
      onPointerUp={press(false)}
      onPointerCancel={press(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon name="mic" size={16} />
      {voice.phase === "hearing" ? "Let go to send" : "Hold to talk"}
    </button>
  );
}

/** Above the composer while talking: the agent, what's happening and being
 *  said, how loud you are, and stop, mute, the full view and end. */
export function VoiceBar({ voice, agent, interrupt = true }) {
  const meter = useRef(null);
  useLevel(voice, meter);
  if (!voice.on) return null;
  const note = noteOf(voice, interrupt);
  const stoppable = voice.phase === "speaking" || voice.phase === "thinking";
  return (
    <div className="voice-bar" data-phase={voice.phase} role="status" aria-live="polite">
      {agent ? <AgentAvatar look={agent.look} name={agent.name} size={34} alive={false} mood={MOODS[voice.phase] || null} /> : null}
      <span className="voice-says">
        <span className="voice-state">{saysOf(voice)}</span>
        {note ? <span className={`voice-note${voice.problem && voice.phase !== "problem" ? " warn" : ""}${voice.phase === "speaking" && voice.caption ? " caption" : ""}`}>{note}</span> : null}
      </span>
      <span className="voice-meter" ref={meter} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      {voice.push ? <TalkButton voice={voice} /> : null}
      {stoppable ? (
        <button type="button" className="btn icon-only" aria-label="Stop" title="Stop: quiet now, and it listens" onClick={voice.interrupt}>
          <Icon name="stop" size={15} />
        </button>
      ) : null}
      <button
        type="button"
        className="btn icon-only voice-mute"
        aria-pressed={voice.muted}
        aria-label={voice.muted ? "Unmute" : "Mute"}
        title={voice.muted ? "Unmute" : "Mute: it stops listening, and still speaks"}
        onClick={voice.toggleMute}
        disabled={voice.phase === "problem"}
      >
        <Icon name={voice.muted ? "mic-off" : "mic"} size={16} />
      </button>
      <button
        type="button"
        className="btn icon-only"
        aria-pressed={voice.full}
        aria-label={voice.full ? "Back to the chat" : "Full view"}
        title={voice.full ? "Back to the chat" : "Full view: just the agent, large"}
        onClick={voice.toggleFull}
        disabled={voice.phase === "problem"}
      >
        <Icon name={voice.full ? "compact" : "expand"} size={15} />
      </button>
      <button type="button" className="btn voice-end" onClick={voice.end}>
        End
      </button>
    </div>
  );
}

/** The full view: the agent large in the middle of the chat, moving with
 *  the conversation -- listening, thinking, speaking -- and what's being said
 *  under it. The chat is still there, a click away (or Esc). */
export function VoiceStage({ voice, agent }) {
  const orb = useRef(null);
  useLevel(voice, orb);
  useEffect(() => {
    if (!voice.full) return undefined;
    const onKey = (e) => e.key === "Escape" && voice.toggleFull();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [voice.full, voice.toggleFull]);
  if (!voice.on || !voice.full || !agent) return null;
  const line = voice.phase === "speaking" ? voice.caption : voice.phase === "hearing" || voice.phase === "writing" || voice.phase === "thinking" ? voice.heard : "";
  return (
    <div className="voice-stage" data-phase={voice.phase}>
      <div className="voice-orb" ref={orb}>
        <AgentAvatar look={agent.look} name={agent.name} size={168} mood={MOODS[voice.phase] || null} follow />
      </div>
      <p className="voice-stage-name">{agent.name}</p>
      <p className="voice-stage-state">{saysOf(voice)}</p>
      <p className="voice-stage-line" key={line}>
        {line ? (voice.phase === "speaking" ? line : `“${line}”`) : " "}
      </p>
      {voice.push ? <TalkButton voice={voice} big /> : null}
    </div>
  );
}
