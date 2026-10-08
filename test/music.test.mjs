import { test } from "node:test";
import assert from "node:assert/strict";

import { pickPlayer } from "../src/lib/music.js";

test("the player shown is the one playing, else the one paused", () => {
  const music = { app: "music", state: "paused", title: "A", artist: "x" };
  const spotify = { app: "spotify", state: "playing", title: "B", artist: "y" };
  assert.equal(pickPlayer([music, spotify]), spotify);
  assert.equal(pickPlayer([music, { ...spotify, state: "paused" }]), music);
  assert.equal(pickPlayer([{ app: "music", state: "stopped" }, { app: "spotify", problem: "-1743" }]), null);
  assert.equal(pickPlayer([]), null);
});
