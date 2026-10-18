# Voice

Talking to an agent instead of typing: press the sound-wave button by Send in
any chat, say something, and pause. blvrd writes down what you said, sends it
as your message, and reads the answer out as it arrives -- a sentence at a
time, so the first words are heard about as soon as the first sentence is
written. Talk over it and it stops and listens. A group chat works the same
way, each member in its own voice.

It is written for the same setup as the rest of blvrd: models of your own, on
this Mac, with hosted ones as an option -- so the default hears and speaks on
the Mac, with nothing to install, and a server of your own or a hosted one is
a choice under **Settings → Voice**.

**Built:** listening and turn-taking, interrupting, one message from a
thought paused mid-way, reading answers out as they stream, the Mac's
on-device recogniser and voices, Whisper- and OpenAI-style speech servers,
each agent's own voice, the model told the conversation is spoken, the Allow
card said aloud, names instead of @ in a group, Settings → Voice with *Try
it* and *Hear it*. **Not yet:** a shortcut to start talking from anywhere
(the quickview's), streaming recognition that shows your words while you
speak, and trimming a stopped answer to what was actually heard.

---

## 1. What the reader sees

A strip over the box while it's on: the agent, what's happening, how loud
you are, Mute and End.

| Strip says | |
|---|---|
| Listening | waiting for you |
| Hearing you… | you're talking |
| Writing down what you said… | the recording is with the recogniser |
| Thinking… | your message is sent; nothing to say yet |
| Speaking — talk to interrupt | reading the answer out |
| Muted | not listening; it still speaks |

What you said is in the chat as your message, with a small microphone on it;
the answer is in the chat as always. The box still takes typing. Anything
that needs your OK is asked on the screen as usual -- the agent says it's
waiting for you -- and is never answered by voice: a misheard "yes" mustn't
send an email.

## 2. Taking turns

`src/lib/voice/vad.js` decides when you start and stop, from how loud each
~21 ms frame of the microphone is over the room's own level, which it follows
as it changes.

* **A start** needs ~160 ms of speech, built up over syllables, so a click or
  a cough doesn't count.
* **An end** is a pause of 0.55, 0.9 or 1.6 s (Settings → Voice → Taking
  turns). Longer suits people who stop to think mid-sentence.
* **Let go, not sent:** an utterance with under ~280 ms of speech in it, or
  one whose loudness barely moves -- speech rises and falls with each
  syllable, and a fan or a hum doesn't.
* **The first syllable** isn't lost: the microphone keeps the last few
  hundred milliseconds, and an utterance starts from before the start was
  sure.
* **Carrying on after a pause:** if you start again while what you said is
  still being written down, the two are sent as one message.

While the agent is **speaking**, it takes louder, longer speech to count
(`setStrict`), so its own voice coming back through the speakers -- whatever
the system's echo cancelling leaves -- doesn't cut it off. When you do talk
over it, it stops speaking, the answer is stopped as if you'd pressed Stop,
and what you said is your next message. While it's **thinking or working**
(tools, the computer), what you say waits its turn, like a message typed
then. *Talk over an agent to interrupt it* can be turned off, for speakers
without good echo cancelling: then it stops listening while it talks.

## 3. Hearing

The microphone is the webview's own (`getUserMedia`, with echo cancelling,
noise suppression and gain control); `src/lib/voice/audio.js` hands each
utterance on as a 16 kHz, 16-bit mono WAV (`pcm.js`), the one format every
recogniser takes.

| Engine | Where | |
|---|---|---|
| **This Mac** (default) | on the device | Apple's `SFSpeechRecognizer` with `requiresOnDeviceRecognition` (`src-tauri/src/voice.rs`). Nothing to install; needs Dictation's language downloaded. |
| whisper.cpp | this computer | `whisper-server -m ggml-large-v3-turbo.bin --port 2022`, its own `/inference` |
| Speaches | this computer | OpenAI-compatible `/audio/transcriptions` |
| Groq, OpenAI, Mistral | hosted | `/audio/transcriptions`, with the key already under Models |
| Another server | either | anything OpenAI-compatible |

A hosted engine uses the key its host has under Models unless given its own,
and says where your voice goes. What a recogniser writes for no words --
"[BLANK_AUDIO]", "(music)" -- is dropped (`cleanHeard`). The language is
this Mac's unless chosen; Whisper is sent only its language ("en"), Apple
the whole tag ("en-GB").

## 4. Speaking

`src/lib/voice/speakable.js` turns the answer's Markdown into sentences to
say: emphasis and links down to their words (a link is said as its site),
headings and list items each a sentence, code blocks, tables, pictures and
emoji left on the screen. Thinking (`<think>`), and a call written as text
(`<tool_call>`, `[TOOL_CALLS]`…) and everything after it, are never said.

It is asked again with the whole text every time more arrives, and gives the
same pieces for what it had before -- so the speaker says only the new ones.
Nothing is cut at a full stop until the space after it arrives ("3.14"), and
"Dr.", "e.g.", "p.m." and initials don't end sentences. A sentence over 240
characters is said in parts, at its commas.

`src/lib/voice/speaker.js` says them in order, making each one's sound while
the one before plays and no more than two at once, so there's no gap and a
local server isn't handed a whole answer at once. Stopping cuts the one
playing mid-word and drops the rest.

| Engine | Where | |
|---|---|---|
| **This Mac's voices** (default) | on the device | `say -o` to a WAV (`voice.rs`), played by the webview so it can be cut off. The Premium and Enhanced voices sound far better: System Settings → Accessibility → Spoken Content → Manage Voices. In a plain browser, the browser's own speech. |
| Kokoro | this computer | Kokoro-FastAPI on :8880, `/audio/speech`; its voices listed from `/audio/voices` |
| Speaches | this computer | Kokoro behind the same OpenAI-compatible API |
| OpenAI, Groq | hosted | `gpt-4o-mini-tts`; Orpheus on Groq (no speed) |
| Another server | either | anything with OpenAI's `/audio/speech` |

Each agent can have its own voice (Customize → Voice), kept per engine
(`agent.voices`), so switching engines and back keeps them. In a group,
different voices tell members apart.

## 5. What the model is told

A spoken message is marked (`spoken: true`) and its request carries a note
(`SPOKEN_NOTE`, in `run.js`'s per-request `note`, so the system prompt and
its cache are unchanged): the user said this aloud and will hear the answer,
so answer as you'd say it -- briefly, without headings, tables or long lists,
numbers as they're said, anything that only works written down after what's
said -- and the words may be misheard, so ask if something doesn't make
sense.

In a group, with no @ to say aloud, a message that opens by naming members
("Ada, what do you think?", "Ada and Bo: ideas?") is for them
(`addressedIn`, `lib/group.js`); a name anywhere else is only talking about
them.

## 6. Permissions

`Info.plist` has `NSMicrophoneUsageDescription` and
`NSSpeechRecognitionUsageDescription` -- without them macOS refuses both --
and `Entitlements.plist` has `com.apple.security.device.audio-input`, which a
build signed with the hardened runtime needs for any microphone at all. The
webview's request for the microphone is granted by wry; macOS asks the
reader the first time. If either is turned down, the strip says where to
turn it back on.
