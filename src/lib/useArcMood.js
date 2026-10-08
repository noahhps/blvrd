import { useEffect, useRef, useState } from "react";

/* What blvrd's arch (components/Mascot.jsx) shows for the app as a whole.
 *
 * While an agent works: asking when it waits on the reader's Allow, speaking
 * once its words are arriving, thinking before that. When an answer lands --
 * any chat's newest assistant message changes -- a moment of done, or of
 * error if what landed was a failure; then idle. */

const SETTLE_MS = 1400;

/** The mood while something is running, or null when nothing is. Pure. */
export function busyMood({ live, approval }) {
  if (approval) return "asking";
  if (!live) return null;
  return live.text || live.parts?.some((p) => p.type === "text" && p.text) ? "speaking" : "thinking";
}

/** The newest assistant message across every chat's last message. Pure. */
export function newestAnswer(chats) {
  let newest = null;
  for (const messages of Object.values(chats || {})) {
    const last = messages?.[messages.length - 1];
    if (last?.role === "assistant" && (!newest || (last.at || 0) > (newest.at || 0))) newest = last;
  }
  return newest;
}

export function useArcMood({ live, approval, chats }) {
  const busy = busyMood({ live, approval });
  const answer = newestAnswer(chats);
  const seen = useRef(answer?.id);
  const [after, setAfter] = useState(null); // "done" | "error" | null

  useEffect(() => {
    if (!answer || answer.id === seen.current) return undefined;
    seen.current = answer.id;
    setAfter(answer.failure ? "error" : "done");
    const timer = setTimeout(() => setAfter(null), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [answer?.id]);

  // An answer mid-round in a group lands while the next is still coming:
  // what's running wins.
  return busy || after || "idle";
}
