import { useMemo, useState } from "react";

import { cellsFor, halftone, haloDiamonds, hash, rasterise } from "../lib/dotmatrix.js";

/* An agent as the runner terminals show their AIs: not a face but an
 * emblem of what its callsign names (lib/emblems), printed in dots like the
 * Marathon's Durandal (lib/dotmatrix.js) -- for the UESC look ("uesc": a
 * halftone on a screen of the agent's colour) and Sekiguchi's ("sekiguchi":
 * a specimen scan in square pixels). styles/emblem.css has the inks.
 *
 * Over it, the halo: seven diamonds in a ring, as over Durandal's rider.
 * It says what the agent is doing and nothing more -- still at rest, a
 * diamond catching the light now and then; turning, a step at a time, while
 * it works; lit in turn while its words arrive; all at once when it asks
 * something of you. Large ones (72px and up) sit in the viewer's frame: the
 * screen's curve, and the turntable's R- R+ dial. `onOpen` makes it a
 * button (the chat's own copies), to see it on the whole screen
 * (components/EmblemViewer.jsx). */

export function Emblem({ emblem, name = "", colour = "var(--ink)", size = 28, mood = "still", alive = true, look = "uesc", label = null, onOpen = null, className = "" }) {
  const n = cellsFor(size);
  const seed = useMemo(() => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7), [name]);
  const dots = useMemo(() => {
    const cells = rasterise(emblem, n);
    return cells ? halftone(cells, n, look, seed) : null;
  }, [emblem, name, n, look, seed]);
  const diamonds = useMemo(() => (emblem.halo ? haloDiamonds(emblem.halo, n) : []), [emblem, n]);
  // Each its own glint, so a list of them never moves in step.
  const [delay] = useState(() => `${-(Math.random() * 9).toFixed(2)}s`);
  const framed = size >= 72 && look === "uesc";
  const u = n / 100;

  return (
    <svg
      className={`emblem ${className}`.trim()}
      data-look={look}
      data-mood={mood}
      data-alive={alive ? "" : undefined}
      data-ink={colour === "var(--ink)" ? "" : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      style={{ "--c": colour, "--em-delay": delay, "--em-n": n }}
      role={onOpen ? "button" : label ? "img" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `See ${name} on the whole screen` : label || undefined}
      aria-hidden={onOpen || label ? undefined : "true"}
      onClick={onOpen || undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <rect className="em-screen" width={n} height={n} />
      {dots ? (
        <g className="em-figure">
          <path className="em-noise" d={dots.noise} />
          <path className="em-ink" d={dots.ink} />
          <path className="em-holes" d={dots.holes} />
        </g>
      ) : null}
      {diamonds.length ? (
        <g className="em-halo" shapeRendering="geometricPrecision" style={{ transformOrigin: `${emblem.halo.x * u}px ${emblem.halo.y * u}px` }}>
          {diamonds.map((d, k) => (
            <g key={k} className="em-diamond" style={{ "--k": k }}>
              <polygon points={d.points} />
              {d.s >= 2.4 ? <rect className="em-core" x={d.cx - d.s / 3} y={d.cy - d.s / 3} width={(d.s * 2) / 3} height={(d.s * 2) / 3} /> : null}
            </g>
          ))}
        </g>
      ) : null}
      {framed ? <Frame n={n} seed={seed} /> : null}
      <rect className="em-scan" width={n} height={1} />
    </svg>
  );
}

/* The model viewer round a large one: the screen's curve top and bottom,
 * and on the bottom bar the turntable's dial, R- to R+, at rest. */
function Frame({ n, seed }) {
  const top = n * 0.05;
  const bottom = n * 0.9;
  const y = n * 0.955;
  const left = n * 0.3;
  const right = n * 0.7;
  const at = left + (right - left) * (0.4 + (hash(seed, 3, 1) % 200) / 1000);
  return (
    <g className="em-frame" shapeRendering="geometricPrecision">
      <path className="em-bezel" d={`M0 0H${n}V${top * 1.6}Q${n / 2} ${-top * 0.4} 0 ${top * 1.6}Z`} />
      <path className="em-bezel" d={`M0 ${n}H${n}V${bottom}Q${n / 2} ${bottom + top * 1.4} 0 ${bottom}Z`} />
      <g className="em-dial">
        <path d={`M${left} ${y}H${right}M${left} ${y - 1.2}V${y + 1.2}M${right} ${y - 1.2}V${y + 1.2}M${(left + right) / 2} ${y - 0.8}V${y}`} />
        <rect x={at - 2} y={y - 0.8} width={4} height={1.6} />
      </g>
    </g>
  );
}
