import { useEffect, useRef, useState } from "react";

import { useCover } from "../../lib/cover.js";
import { useNowPlaying } from "../../lib/music.js";
import { BrandLogo } from "../BrandLogo.jsx";
import { Icon } from "../Icon.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

const APPS = { music: "Apple Music", spotify: "Spotify" };

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const clamp = (x) => Math.min(1, Math.max(0, x));

/* How far into the song, and where to go in it. Between reads the bar runs on
   by itself (a CSS animation from where the player said it was to the end,
   over the time left), started again from each read so it never drifts far.
   Press or drag along it to seek: the bar and its knob follow the pointer
   exactly, a bubble says where you'll land, and letting go seeks there. The
   arrow keys move 5 seconds. */
// How far a reading may differ from where the bar already is before the bar
// is put right. Playing, the round trip to the app wobbles by a few hundred
// ms, and restarting the bar for that would nudge it every few seconds.
// Paused, nothing moves, so a reading is exact and is taken as it is.
const DRIFT_S = { playing: 0.75, paused: 0.05 };

function Scrubber({ now, onSeek }) {
  const track = useRef(null);
  const [scrub, setScrub] = useState(null); // 0..1 while dragging
  // Where the bar's running animation started: { key, song, state, position,
  // at }, and `seen`, the newest reading it has been checked against.
  // Kept across readings that agree with it, so the animation runs on
  // untouched; replaced only by a new song, play/pause, a seek, or real drift.
  const anchor = useRef(null);
  if (!(now.duration > 0) || !(now.position >= 0)) return null;
  const song = `${now.app}:${now.title}:${now.artist}`;
  const sampled = now.sampledAt || Date.now();
  const a = anchor.current;
  const playing = now.state === "playing";
  const expected = a && a.song === song && a.state === now.state ? a.position + (playing ? (sampled - a.at) / 1000 : 0) : null;
  if (expected == null || Math.abs(now.position - expected) > (playing ? DRIFT_S.playing : DRIFT_S.paused)) {
    // Started from where the song is now, not where it was when read. A
    // change made here before any new reading (pressing pause) carries an
    // old position: then the bar stays where it visibly is.
    const late = playing ? (Date.now() - sampled) / 1000 : 0;
    const shown = a && a.song === song ? a.position + (a.state === "playing" ? (Date.now() - a.at) / 1000 : 0) : null;
    const position = shown != null && sampled <= a.seen ? shown : now.position + late;
    anchor.current = { key: (a?.key || 0) + 1, song, state: now.state, position: Math.min(now.duration, Math.max(0, position)), at: Date.now() };
  }
  anchor.current.seen = Math.max(anchor.current.seen || 0, sampled);
  const from = anchor.current;
  const at = scrub ?? clamp(from.position / now.duration);
  const left = Math.max(0, now.duration - from.position);
  const run = { "--at": at, animationDuration: `${left}s` };
  const key = from.key;
  const under = (e) => {
    const box = track.current.getBoundingClientRect();
    return clamp((e.clientX - box.left) / box.width);
  };
  const seek = (seconds) => onSeek(Math.min(now.duration, Math.max(0, seconds)));
  return (
    <div
      className="music-scrub"
      role="slider"
      tabIndex={0}
      aria-label="Position in the song"
      aria-valuemin={0}
      aria-valuemax={Math.round(now.duration)}
      aria-valuenow={Math.round(at * now.duration)}
      aria-valuetext={`${clock(at * now.duration)} of ${clock(now.duration)}`}
      data-scrubbing={scrub != null ? "" : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setScrub(under(e));
      }}
      onPointerMove={(e) => scrub != null && setScrub(under(e))}
      onPointerUp={() => {
        if (scrub == null) return;
        seek(scrub * now.duration);
        setScrub(null);
      }}
      onPointerCancel={() => setScrub(null)}
      onKeyDown={(e) => {
        // Escape mid-drag: back to where the song is, nothing changed.
        if (e.key === "Escape" && scrub != null) return setScrub(null);
        const by = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5 }[e.key];
        if (by == null && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        seek(e.key === "Home" ? 0 : e.key === "End" ? now.duration - 1 : now.position + by);
      }}
    >
      <span className="music-progress" ref={track}>
        <span key={key} className="music-progress-fill" style={run} />
      </span>
      <span key={key} className="music-knob-rail" style={run}>
        <span className="music-knob" />
        {scrub != null ? (
          <span className="music-time" style={{ "--at": at }}>
            <span className="music-time-bubble">{clock(scrub * now.duration)}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* Spotify's cover, from the network: shown once it has loaded, not in
   pieces after the title. */
function Cover({ src }) {
  const [loaded, setLoaded] = useState(false);
  return <img src={src} alt="" data-loaded={loaded ? "" : undefined} onLoad={() => setLoaded(true)} />;
}

/* The album's cover behind the whole widget, blurred and darkened, so the
   song is in its colours. A new cover fades in over the one before once it
   has loaded -- changing songs never flashes blank. `shown` is true once any
   cover is up, which is when the widget's text turns light. */
function useBanner(src) {
  const [layers, setLayers] = useState([]); // the cover before, and the one coming in
  useEffect(() => {
    setLayers((now) => (!src ? [] : now.at(-1)?.src === src ? now : [...now.filter((l) => l.loaded).slice(-1), { src, loaded: false }]));
  }, [src]);
  const loaded = (layer) => setLayers((now) => now.map((l) => (l.src === layer ? { ...l, loaded: true } : l)));
  const node = layers.length ? (
    <span className="music-banner" aria-hidden="true">
      {layers.map((l) => (
        <img key={l.src} src={l.src} alt="" data-loaded={l.loaded ? "" : undefined} onLoad={() => loaded(l.src)} onError={() => setLayers((now) => now.filter((x) => x.src !== l.src))} />
      ))}
    </span>
  ) : null;
  return { node, shown: layers.some((l) => l.loaded) };
}

/* What Music or Spotify is playing on this Mac (lib/music.js): the cover,
 * the song and who it's by, back, play/pause and skip, and how far in --
 * over the album's cover, blurred, as a banner. */
export function MusicWidget({ handle }) {
  const { now, problem, available, control } = useNowPlaying();
  const playing = now?.state === "playing";
  // Which way a new song comes in: from the left just after Back, from the
  // right otherwise (Next, or the next song starting by itself).
  const pressed = useRef({ command: null, at: 0 });
  const press = (command) => {
    pressed.current = { command, at: Date.now() };
    control(command);
  };
  const track = now ? `${now.app}:${now.title}:${now.artist}` : null;
  const from = pressed.current.command === "back" && Date.now() - pressed.current.at < 3000 ? "back" : "next";
  const cover = useCover(now);
  const banner = useBanner(cover);
  return (
    <>
      <WidgetHead label="Now playing" handle={handle} />
      <div className="widget widget-music" data-state={now?.state} data-banner={banner.shown ? "" : undefined}>
        {banner.node}
        {!available ? (
          <p className="side-empty">Music and Spotify show here in the desktop app.</p>
        ) : problem && !now ? (
          <p className="side-empty">{problem}</p>
        ) : !now ? (
          <p className="side-empty">Nothing playing. Start something in Music or Spotify.</p>
        ) : (
          <>
            <span className="music-row">
            {/* A new song is a new element, so it comes in (CSS
                @starting-style) rather than swapping in place. */}
            <span key={track} className="music-track" data-from={from}>
              <span className="music-art">
                {cover ? <Cover key={cover} src={cover} /> : <BrandLogo id={now.app === "spotify" ? "spotify" : "applemusic"} size={22} tile={false} />}
              </span>
              <span className="music-text">
                <span className="music-title" title={now.title}>
                  {now.title}
                </span>
                <span className="music-artist" title={`${now.artist}${now.album ? ` — ${now.album}` : ""}`}>
                  {now.artist || APPS[now.app]}
                </span>
              </span>
            </span>
            <span className="music-controls">
              <button type="button" className="round music-button" aria-label="Back" title={`Back to the start, or the song before, in ${APPS[now.app]}`} onClick={() => press("back")}>
                <Icon name="back" size={14} />
              </button>
              <button type="button" className="round music-button" aria-label={playing ? "Pause" : "Play"} title={`${playing ? "Pause" : "Play"} in ${APPS[now.app]}`} onClick={() => press("toggle")}>
                <span key={playing ? "pause" : "play"} className="music-glyph">
                  <Icon name={playing ? "pause" : "play"} size={14} />
                </span>
              </button>
              <button type="button" className="round music-button" aria-label="Next song" title={`Next song in ${APPS[now.app]}`} onClick={() => press("next")}>
                <Icon name="next" size={14} />
              </button>
            </span>
            </span>
            <Scrubber now={now} onSeek={(seconds) => control("seek", seconds)} />
          </>
        )}
      </div>
    </>
  );
}
