/* Finding the @ being typed, and the agents it could mean (components/Mentions.jsx). */

/** Agents an @ can reach, best first: names that start with what was typed,
 *  then names that contain it, each in the order given. */
export function mentionable(agents, query) {
  const q = query.trim().toLowerCase();
  if (!q) return agents;
  const starts = agents.filter((a) => a.name.toLowerCase().startsWith(q));
  const has = agents.filter((a) => !starts.includes(a) && a.name.toLowerCase().includes(q));
  return [...starts, ...has];
}

/** The @ being typed just before the caret, if there is one. */
export function mentionAt(text, caret) {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2] } : null;
}
