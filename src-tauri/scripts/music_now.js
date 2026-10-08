// What Music and Spotify are playing, from whichever of them is open. An app
// that isn't open is skipped without starting it; one not installed is too.
function run() {
  const out = [];
  for (const [id, name] of [["music", "Music"], ["spotify", "Spotify"]]) {
    let app;
    try {
      app = Application(name);
      if (!app.running()) continue;
    } catch (e) {
      continue;
    }
    try {
      const state = String(app.playerState());
      if (state === "stopped") {
        out.push({ app: id, state });
        continue;
      }
      const t = app.currentTrack;
      const item = { app: id, state, title: t.name(), artist: t.artist(), album: t.album() };
      if (id === "spotify") {
        try {
          item.artwork = t.artworkUrl();
        } catch (e) {}
      }
      out.push(item);
    } catch (e) {
      out.push({ app: id, problem: String((e && e.message) || e) });
    }
  }
  return JSON.stringify(out);
}
