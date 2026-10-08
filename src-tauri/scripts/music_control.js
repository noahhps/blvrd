// Play or pause, skip, go back, or seek, in Music or Spotify. argv[0] is JSON:
// { app: "music" | "spotify", command: "toggle" | "next" | "back" | "seek",
//   position?: seconds }. Only those -- anything else is refused.
//
// "back" is a player's back button: to the start of the song, or to the one
// before if it has only just begun. Music has that as one command; Spotify's
// only skips, so the restart is done here.
function run(argv) {
  const { app, command, position } = JSON.parse(argv[0] || "{}");
  const name = { music: "Music", spotify: "Spotify" }[app];
  if (!name || !["toggle", "next", "back", "seek"].includes(command)) throw new Error("unknown music command");
  const player = Application(name);
  if (!player.running()) return "{}";
  if (command === "seek") {
    const to = Number(position);
    if (!isFinite(to) || to < 0) throw new Error("seek needs a position in seconds");
    player.playerPosition = to;
  } else if (command === "toggle") player.playpause();
  else if (command === "next") player.nextTrack();
  else if (app === "music") player.backTrack();
  else if (player.playerPosition() > 3) player.playerPosition = 0;
  else player.previousTrack();
  return "{}";
}
