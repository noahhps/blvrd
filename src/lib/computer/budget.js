/* What a model can afford on the computer, from its real window
 * (lib/profile.js) -- docs/computer.md §6.
 *
 *   observation  the most one tool answer may use: a tenth of the window,
 *                between 400 and 4000 tokens
 *   checkpoint   when the worker's context is folded: seven tenths
 *   reply        room kept for the model's own answer: three twentieths
 *
 * A window under MIN_WINDOW is too small for the computer's work at all. */

import { DEFAULT_WINDOW, usableWindow } from "../profile.js";

export const MIN_WINDOW = 6144;
export const CHARS_PER_TOKEN = 4;

export function budgetFor(provider, profile) {
  const window = usableWindow(provider, profile) || DEFAULT_WINDOW;
  const observation = Math.round(Math.min(4000, Math.max(400, window * 0.1)));
  return {
    window,
    observation,
    observationChars: observation * CHARS_PER_TOKEN,
    checkpoint: Math.round(window * 0.7),
    reply: Math.round(window * 0.15),
    enough: window >= MIN_WINDOW,
  };
}
