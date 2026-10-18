# Voice

Talking to an agent instead of typing: press the sound-wave button by Send in
any chat and talk. When you pause (or let go of Space, pushing to talk),
blvrd writes down what you said, sends it as your message, and reads the
answer out as it arrives -- a sentence at a time, so the first words are
heard about as soon as the first sentence is written. Talk over it and it
stops, listens, and is told how much you heard. A group chat works the same
way, each member in its own voice.

It is written for the same setup as the rest of blvrd: models of your own, on
this Mac, with hosted ones as an option -- so the default hears and speaks on
the Mac, with nothing to install, and a server of your own or a hosted one is
a choice under **Settings → Voice**.

**Built:** hands-free and push-to-talk listening, interrupting while it
speaks or thinks, the agent told what was heard when it was cut off, "stop"
and "goodbye", one message from a thought paused mid-way, answers read out as
they stream with captions, the full view, sound cues, Whisper's phantom
phrases dropped, spoken turns with reasoning off and an optional faster
model, the Mac's on-device recogniser and voices, Whisper- and OpenAI-style
speech servers, each agent's own voice, the Allow card said aloud, names
instead of @ in a group. **Not yet:** a shortcut to start talking from
anywhere (the quickview's), streaming recognition that shows your words
while you speak, a wake word, and a full-duplex speech model (OpenAI's
realtime voices) in place of the chain.

## Where it comes from

Three voice modes were looked at closely, and each gave something:

* **ChatGPT** moved voice into the chat itself (November 2025): what you say
  and what it answers stay in the thread, with pictures and lists on screen
  while it talks, and the old full-screen orb is an option ("Separate mode").
  blvrd does the same -- the strip over the box -- with the **full view** as
  its orb: the agent's own character, large.
* **Claude** keeps turn-taking simple and lets you choose how you're heard:
  **hands-free**, or **push to talk** for a noisy room; a stop button cuts it
  off; what it's saying shows on screen; voices and a pace to choose.
* **Hermes Agent** (Nous Research) is the closest in kind -- a chain of
  speech-to-text, the agent, and text-to-speech, local-first -- and the most
  thorough: interrupting while it *thinks*, not only while it speaks; the
  agent **told it was cut off**, so it doesn't carry on as if it had been
  heard; "stop" said alone; Whisper's **phantom phrases** filtered; short
  sentences **merged** before they're spoken; a **grace** moment as playback
  starts; **reasoning off** on spoken turns and an optional **voice model**;
  record **beeps**; ending after a long silence.

---

## 1. What the reader sees

A strip over the box while it's on: the agent, what's happening, what's
being said (a caption) or what you said, how loud you are, and Stop, Mute,
the full view and End.

| Strip says | |
|---|---|
| Listening | hands-free, waiting for you |
| Hold Space to talk | pushing to talk, waiting for you |
| Hearing you… | you're talking (or holding Space) |
| Writing down what you said… | the recording is with the recogniser |
| Thinking… | your message is sent; nothing to say yet |
| Working on it… | it's using a tool -- the computer, a search |
| Speaking | reading the answer out, the sentence shown under it |
| Muted | not listening; it still speaks |

**The full view** (the arrows in the strip; Esc to leave) puts the agent's
character large in the middle of the chat, breathing while it listens,
growing with your voice, bobbing while it speaks, with the sentence being
said under it -- a call rather than a chat. The chat is a click away and the
box still takes typing.

What you said is in the chat as your message, with a small microphone on it;
the answer is in the chat as always. Anything that needs your OK is asked on
the screen as usual -- the agent says it's waiting for you -- and is never
answered by voice: a misheard "yes" mustn't send an email.

**Sounds** (Settings → Voice, on by default; `src/lib/voice/cues.js`): two
rising notes when it starts listening, a soft tick when it has heard you, a
quiet pulse every couple of seconds while it works with nothing to say, two
falling notes when it ends. Made with Web Audio on the spot, short and quiet.

## 2. Taking turns

**Hands-free** (default): `src/lib/voice/vad.js` decides when you start and
stop, from how loud each ~21 ms frame of the microphone is over the room's
own level, which it follows as it changes.

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

**Push to talk:** it hears you only while Space is held (anywhere but a text
box) or the talk button is pressed, and sends what you said when you let go;
the detector only draws the level. For a noisy room, or speakers without good
echo cancelling.

**Interrupting.** Talk while it's speaking, or while it's thinking before
it has said anything, and it stops: speech cut mid-word, the answer stopped
as if you'd pressed Stop, and what you said is your next message. With that
message goes a note of how much of the answer you heard ("they heard only
'…' and none of the rest", or that you spoke before it said anything;
`cutOffNote`), so it can pick up where it was rather than assume you heard it
all -- in a group, only to the member who was talked over. While it's busy
with a tool (the computer, a search), what you say waits its turn instead,
like a message typed then: a half-finished task isn't thrown away for an
"mm-hm".

While it's speaking or working it takes louder, longer speech to count
(`setStrict`), so its own voice coming back through the speakers -- whatever
echo cancelling leaves -- doesn't cut it off; and a start in the first half
second of it speaking is taken for its own voice and dropped. *Talk over an
agent to interrupt it* can be turned off: it then stops listening while it
talks.

**Words alone** (`commandIn`, `src/lib/voice/turns.js`): "stop", "wait",
"hold on" said as the whole of an utterance stop the answer and aren't sent;
"goodbye", "bye", "stop listening" end the conversation. In a sentence
they're just words: "stop doing that and try the other file" is a message.

**It ends on its own** after five quiet minutes -- nobody talking, nothing
answering -- rather than leave a forgotten microphone open.

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
and says where your voice goes. What a recogniser writes for no words is
dropped (`cleanHeard`, `isPhantom`): "[BLANK_AUDIO]", "(music)", the
sign-offs Whisper learnt from videos ("Thanks for watching!", "Please
subscribe", "Subtitles by the Amara.org community" and their kin in other
languages), a lone "you", and a few words said over and over. "Thank you"
is kept: people say it to an agent. The language is this Mac's unless
chosen; Whisper is sent only its language ("en"), Apple the whole tag
("en-GB").

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
characters is said in parts, at its commas. Then `phrases` (`turns.js`)
joins a short sentence to the one after it -- some voices make a lone "Okay."
sound like someone else -- except the first, which goes alone so the answer
starts as soon as it can.

`src/lib/voice/speaker.js` says them in order, making each one's sound while
the one before plays and no more than two at once, so there's no gap and a
local server isn't handed a whole answer at once. It says which sentence
starts to be heard (the caption, and how much was heard if it's cut off).
Stopping cuts the one playing mid-word and drops the rest.

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

## 5. What the model is told, and which model

A spoken message is marked (`spoken: true`) and its request carries a note
(`SPOKEN_NOTE`, in `run.js`'s per-request `note`, so the system prompt and
its cache are unchanged): the user said this aloud and will hear the answer,
so answer as you'd say it -- briefly, without headings, tables or long lists,
numbers as they're said, anything that only works written down after what's
said -- and the words may be misheard, so ask if something doesn't make
sense. After an interruption, the cut-off note goes with it (§2).

A pause before it speaks is dead air, so a spoken turn **thinks as little as
its model allows** (`leastOf`: Ollama's `think: false`, the lowest effort
elsewhere) unless *Let models think before answering out loud* is on; and
Settings → Voice → *Answering out loud* can name **a faster model for spoken
turns** -- same agent, abilities and memory; typed messages keep the agent's
own.

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
