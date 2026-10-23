import { useMemo, useState } from "react";

import { cellsFor, halftone, rasterise } from "../lib/dotmatrix.js";
import { SHAPES } from "./Mascot.jsx";

/* An agent's character as the runner terminals print it: the same shape
 * (components/Mascot.jsx) in dots, for the UESC look ("uesc": a halftone
 * shell on a screen of the agent's colour) and Sekiguchi's ("sekiguchi": a
 * specimen scan in square pixels). lib/dotmatrix.js does the printing;
 * styles/dotmascot.css the inks and the moods.
 *
 * The eyes are two blocks over the dots, snapped to the grid. At rest they
 * blink now and then; reading, the pupils step along a line while a scan bar
 * runs down the screen; speaking, the shell steps up and down a cell. */

export function DotMascot({ shape = "circle", colour = "var(--ink)", size = 28, mood = "still", alive = true, look = "uesc", label = null, className = "" }) {
  const id = SHAPES[shape] ? shape : "circle";
  const s = SHAPES[id];
  const n = cellsFor(size);
  const seed = useMemo(() => [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) % 997, [id]);
  const dots = useMemo(() => {
    const cells = rasterise(id, s.art, s.eyes, n);
    return cells ? halftone(cells, n, look, seed) : null;
  }, [id, s, n, look, seed]);
  // Each its own blink, so a list of them never blinks in step.
  const [delay] = useState(() => `${-(Math.random() * 7).toFixed(2)}s`);

  const u = n / 100;
  const w = Math.max(2, Math.round(12.8 * u));
  const h = Math.max(2, Math.round(14.8 * u));
  const p = Math.max(1, Math.round(7.2 * u));

  return (
    <svg
      className={`dot-mascot ${className}`.trim()}
      data-look={look}
      data-mood={mood}
      data-alive={alive ? "" : undefined}
      data-wink={s.wink ? "" : undefined}
      data-ink={colour === "var(--ink)" ? "" : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      style={{ "--c": colour, "--dm-delay": delay, "--dm-n": n }}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    >
      <rect className="dm-screen" width={n} height={n} />
      {dots ? (
        <g className="dm-shell">
          <path className="dm-noise" d={dots.noise} />
          <path className="dm-ink" d={dots.ink} />
          <path className="dm-holes" d={dots.holes} />
          {s.eyes.map(([ex, ey], i) => {
            const x = Math.round(ex * u - w / 2);
            const y = Math.round(ey * u - h / 2);
            return (
              <g key={i} className={i ? "dm-eye dm-eye-r" : "dm-eye"}>
                <rect className="dm-white" x={x} y={y} width={w} height={h} />
                <rect className="dm-pupil" x={x + Math.floor((w - p) / 2)} y={y + h - p - (h - p >= 2 ? 1 : 0)} width={p} height={p} />
              </g>
            );
          })}
        </g>
      ) : null}
      <rect className="dm-scan" width={n} height={1} />
    </svg>
  );
}
