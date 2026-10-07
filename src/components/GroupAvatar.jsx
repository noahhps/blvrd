import { AgentAvatar } from "./AgentAvatar.jsx";

// Each face overlaps the one before by this much of its width (the CSS reads
// it as --overlap), so up to three, side by side, are this wide:
// each × (1 + (1 − OVERLAP) × (shown − 1)).
const OVERLAP = 0.45;

/* A group, drawn: its first members' avatars, overlapping, and a count for
 * the rest in the corner. The faces are sized to fit inside `size` however
 * many there are, so a big group never spills onto its name. A group whose
 * agents have all been deleted shows an empty ring. The one answering right
 * now is the one that moves. */
export function GroupAvatar({ members, size = 34, answeringId = null }) {
  const shown = members.slice(0, 3);
  const more = members.length - shown.length;
  const fits = size / (1 + (1 - OVERLAP) * Math.max(0, shown.length - 1));
  const each = Math.min(Math.round(size * 0.7), Math.floor(fits));
  return (
    <span className="group-avatar" style={{ "--size": `${size}px`, "--each": `${each}px`, "--overlap": OVERLAP }} aria-hidden="true">
      {shown.length ? (
        shown.map((m) => (
          <span key={m.id} className="group-avatar-member">
            <AgentAvatar look={m.look} name={m.name} size={each} spinning={answeringId === m.id} />
          </span>
        ))
      ) : (
        <span className="group-avatar-empty" />
      )}
      {more > 0 ? <span className="group-avatar-more">+{more}</span> : null}
    </span>
  );
}
