import assert from "node:assert/strict";
import { test } from "node:test";

import { FACTIONS, callsignOf } from "../src/lib/callsigns.js";

test("ready-made agents take their faction's callsign", () => {
  assert.equal(callsignOf("Researcher", "traxus"), "MINERVA");
  assert.equal(callsignOf("coder", "arachne"), "CANON");
  assert.equal(callsignOf("Tutor", "hazard"), "ALCUIN");
});

test("other agents draw a tagged spare, the same one each time", () => {
  const one = callsignOf("Scout", "mida");
  assert.match(one, /^(GIRDER|RIVET|CRANE|PYLON)-\d\d$/);
  assert.equal(callsignOf("Scout", "mida"), one);
});

test("outside the Marathon looks, names are left alone", () => {
  assert.equal(callsignOf("Researcher", "dark"), "Researcher");
  assert.equal(callsignOf("Researcher", "system"), "Researcher");
});

test("every faction names all twenty roles", () => {
  for (const faction of Object.values(FACTIONS)) assert.equal(faction.roles.length, 20);
});
