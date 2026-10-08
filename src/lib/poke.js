/* What a character does when it's poked (components/Mascot.jsx). Pure, so
 * the odds can be tested.
 *
 *   boop     squashes down and springs back, eyes squeezed shut
 *   hop      startled: a hop, eyes wide, looking up
 *   giggle   ticklish: a wiggle, eyes creased
 *   huff     poked once too often: half-lidded, looks away, a "hmph"
 *   backflip one poke in ten thousand: a backflip, then dizzy eyes */

export const EGG_ODDS = 1 / 10000;
// This many pokes inside PESTER_MS and it's had enough.
export const PESTERED = 5;
export const PESTER_MS = 4000;

const PLAIN = ["boop", "hop", "giggle"];

export function pokeReaction({ roll = Math.random(), pick = Math.random(), recent = 1, last = null } = {}) {
  if (roll < EGG_ODDS) return "backflip";
  if (recent >= PESTERED) return "huff";
  // Never the same one twice running, so a second poke reads as a new one.
  const choices = PLAIN.filter((kind) => kind !== last);
  return choices[Math.min(choices.length - 1, Math.floor(pick * choices.length))];
}
