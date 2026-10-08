import { useEffect, useState } from "react";

import { httpFetch } from "./http.js";

/* The cover for what's playing (lib/music.js). Spotify says where its cover
 * is; Music doesn't, so its album is looked up in Apple's own catalogue
 * (the iTunes Search API -- no key, nothing but the artist and album sent)
 * and the 600px cover used. One lookup per album, kept for the session. */

const found = new Map(); // "artist|album" -> url | null | Promise

async function lookUp(artist, album) {
  const term = encodeURIComponent(`${artist} ${album}`.trim());
  const response = await httpFetch(`https://itunes.apple.com/search?media=music&entity=album&limit=5&term=${term}`);
  if (!response.ok) return null;
  const { results = [] } = await response.json();
  const same = (a, b) => String(a || "").toLowerCase().trim() === String(b || "").toLowerCase().trim();
  const best = results.find((r) => same(r.collectionName, album) && same(r.artistName, artist)) || results.find((r) => same(r.collectionName, album)) || results[0];
  return best?.artworkUrl100?.replace(/\/\d+x\d+bb\./, "/600x600bb.") || null;
}

export function coverFor(now) {
  if (!now) return Promise.resolve(null);
  if (now.artwork) return Promise.resolve(now.artwork);
  if (now.app !== "music" || !now.album) return Promise.resolve(null);
  const key = `${now.artist}|${now.album}`;
  if (!found.has(key)) {
    const pending = lookUp(now.artist, now.album).catch(() => null);
    found.set(key, pending);
    pending.then((url) => found.set(key, url));
  }
  return Promise.resolve(found.get(key));
}

/** The cover URL for `now`, or null while unknown or when there is none. */
export function useCover(now) {
  const [cover, setCover] = useState({ for: null, url: null });
  const key = now ? `${now.app}|${now.artwork || ""}|${now.artist}|${now.album}` : null;
  useEffect(() => {
    let live = true;
    coverFor(now).then((url) => live && setCover({ for: key, url }));
    return () => {
      live = false;
    };
    // `key` names everything coverFor reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cover.for === key ? cover.url : null;
}
