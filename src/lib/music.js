import { useCallback, useEffect, useRef, useState } from "react";

import { inDesktop } from "./http.js";
import { invoke } from "./desktop.js";

/* What's playing in Music or Spotify on this Mac, through fixed scripts in
 * the app (src-tauri/scripts/music_*.js) -- no account to connect: whichever
 * of the two is open is read. macOS asks once, per app, before blvrd may.
 *
 *   { app: "music" | "spotify", state: "playing" | "paused" | "stopped",
 *     title, artist, album, artwork? }   artwork: Spotify's cover URL */

const EVERY_MS = 3000;

async function script(action, args = {}) {
  const out = await invoke("apple_script", { action, args: JSON.stringify(args) }, "Music");
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

/** The one worth showing: playing first, then paused, Music before Spotify. */
export function pickPlayer(players = []) {
  const live = players.filter((p) => p.title && !p.problem);
  return live.find((p) => p.state === "playing") || live.find((p) => p.state === "paused") || null;
}

/** { now, problem, available, control(command) } -- read every few seconds
 *  while the window is in view, and at once when it comes back. */
export function useNowPlaying() {
  const available = inDesktop();
  const [now, setNow] = useState(null);
  const [problem, setProblem] = useState(null);
  const busy = useRef(false);

  const read = useCallback(async () => {
    if (!available || busy.current || document.hidden) return;
    busy.current = true;
    try {
      const players = await script("music_now");
      const shown = pickPlayer(Array.isArray(players) ? players : []);
      setNow(shown);
      // Not allowed yet is worth saying; an app that hiccupped once isn't.
      const blocked = (Array.isArray(players) ? players : []).find((p) => /-1743|not authori[sz]ed|not allowed/i.test(p.problem || ""));
      setProblem(blocked ? "Allow blvrd to control Music or Spotify in System Settings → Privacy & Security → Automation." : null);
    } catch (err) {
      setProblem(String(err?.message || err));
    } finally {
      busy.current = false;
    }
  }, [available]);

  useEffect(() => {
    if (!available) return undefined;
    read();
    const timer = setInterval(read, EVERY_MS);
    const onShow = () => !document.hidden && read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [available, read]);

  const control = useCallback(
    async (command) => {
      if (!now) return;
      // Shown at once; the next read confirms it.
      if (command === "toggle") setNow((n) => n && { ...n, state: n.state === "playing" ? "paused" : "playing" });
      try {
        await script("music_control", { app: now.app, command });
      } catch (err) {
        setProblem(String(err?.message || err));
      }
      setTimeout(read, 250);
    },
    [now, read],
  );

  return { now, problem, available, control };
}
