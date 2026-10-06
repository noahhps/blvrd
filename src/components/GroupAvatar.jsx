import { AgentAvatar } from "./AgentAvatar.jsx";

/* A group, drawn: its first members' avatars, overlapping, and a count for
 * the rest. The one answering right now is the one that moves. */
export function GroupAvatar({ members, size = 34, answeringId = null }) {
  const shown = members.slice(0, 3);
  const more = members.length - shown.length;
  const each = Math.round(size * (shown.length > 2 ? 0.62 : 0.7));
  return (
    <span className="group-avatar" style={{ "--size": `${size}px`, "--each": `${each}px` }} aria-hidden="true">
      {shown.map((m) => (
        <span key={m.id} className="group-avatar-member">
          <AgentAvatar look={m.look} name={m.name} size={each} spinning={answeringId === m.id} />
        </span>
      ))}
      {more > 0 ? <span className="group-avatar-more">+{more}</span> : null}
    </span>
  );
}
