import { useNowPlaying } from "../../lib/music.js";
import { BrandLogo } from "../BrandLogo.jsx";
import { Icon } from "../Icon.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

const APPS = { music: "Apple Music", spotify: "Spotify" };

/* What Music or Spotify is playing on this Mac (lib/music.js): the cover,
 * the song and who it's by, and back, play/pause and skip. */
export function MusicWidget({ handle }) {
  const { now, problem, available, control } = useNowPlaying();
  const playing = now?.state === "playing";
  return (
    <>
      <WidgetHead label="Now playing" handle={handle} />
      <div className="widget widget-music" data-state={now?.state}>
        {!available ? (
          <p className="side-empty">Music and Spotify show here in the desktop app.</p>
        ) : problem && !now ? (
          <p className="side-empty">{problem}</p>
        ) : !now ? (
          <p className="side-empty">Nothing playing. Start something in Music or Spotify.</p>
        ) : (
          <>
            <span className="music-art">
              {now.artwork ? <img src={now.artwork} alt="" /> : <BrandLogo id={now.app === "spotify" ? "spotify" : "applemusic"} size={22} tile={false} />}
            </span>
            <span className="music-text">
              <span className="music-title" title={now.title}>
                {now.title}
              </span>
              <span className="music-artist" title={`${now.artist}${now.album ? ` — ${now.album}` : ""}`}>
                {now.artist || APPS[now.app]}
              </span>
            </span>
            <span className="music-controls">
              <button type="button" className="round music-button" aria-label="Back" title={`Back to the start, or the song before, in ${APPS[now.app]}`} onClick={() => control("back")}>
                <Icon name="back" size={14} />
              </button>
              <button type="button" className="round music-button" aria-label={playing ? "Pause" : "Play"} title={`${playing ? "Pause" : "Play"} in ${APPS[now.app]}`} onClick={() => control("toggle")}>
                <Icon name={playing ? "pause" : "play"} size={14} />
              </button>
              <button type="button" className="round music-button" aria-label="Next song" title={`Next song in ${APPS[now.app]}`} onClick={() => control("next")}>
                <Icon name="next" size={14} />
              </button>
            </span>
          </>
        )}
      </div>
    </>
  );
}
