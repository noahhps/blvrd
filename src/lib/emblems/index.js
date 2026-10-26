/* Emblems: what each agent is shown as in the UESC and Sekiguchi looks --
 * not a face but an emblem of what its callsign names (lib/callsigns.js),
 * crowned by the ring of diamonds the Marathon puts over Durandal's rider.
 * One set per look, keyed by callsign: the UESC's blades and astronomers
 * (emblems/uesc.js), Sekiguchi's Fates and Norns (emblems/sekiguchi.js);
 * a callsign with none of its own wears the unnamed one. lib/dotmatrix.js
 * says what an emblem is made of and prints it. */

import { SEKIGUCHI } from "./sekiguchi.js";
import { UESC } from "./uesc.js";

const SETS = { hazard: UESC, sekiguchi: SEKIGUCHI };

/* Any callsign without one of its own: the rider's head from the Marathon's
 * Durandal -- a smooth, featureless egg on a pair of shoulders, the halo
 * over it. */
export const UNNAMED = {
  subject: "A featureless head on a pair of shoulders, the halo over it",
  parts: [
    { d: "M18 92C18 74 31 66 50 66S82 74 82 92Z", tone: 0.72 },
    { d: "M50 30C61 30 67 40 67 50C67 60 60 68 50 68S33 60 33 50C33 40 39 30 50 30Z", tone: 0.72 },
  ],
  halo: { x: 50, y: 48, r: 27 },
};

/** The emblem for `callsign` (a spare's tag, "-07", aside) in `look`. */
export function emblemOf(look, callsign) {
  const set = SETS[look];
  if (!set || !callsign) return null;
  return set[String(callsign).replace(/-\d+$/, "")] || UNNAMED;
}
