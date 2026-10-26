import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { halftone, rasteriseView } from "../lib/dotmatrix.js";

/* An agent's emblem on the whole screen, the way the Marathon shows
 * Durandal: the screen in the agent's colour, the emblem printed as tall as
 * it will go, scan streaks running out to its edges, the curve of the glass
 * top and bottom, and under it the turntable's dial -- R- and R+ turn the
 * figure round (the arrow keys too), as in a model viewer. The halo does
 * what it does everywhere (styles/emblem.css): it turns while the agent
 * works. Escape, or a click anywhere off the dial, puts it away.
 *
 * Printed on a canvas: at this size it's tens of thousands of dots. */

const STEP = 15; // degrees a turn of the dial goes
const LIMIT = 75; // and no further: edge on, a flat figure is a line

export function EmblemViewer({ emblem, callsign, look = "uesc", colour = "var(--ink)", mood = "still", onClose }) {
  const root = useRef(null);
  const [turn, setTurn] = useState(0);
  const back = useRef(null);
  useEffect(() => {
    back.current = document.activeElement;
    root.current?.focus();
    return () => back.current?.focus?.();
  }, []);
  const spin = (d) => setTurn((t) => Math.max(-LIMIT, Math.min(LIMIT, t + d)));
  const onKeyDown = (e) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowLeft") spin(-STEP);
    else if (e.key === "ArrowRight") spin(STEP);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={root}
      className="emblem-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${callsign}${emblem.subject ? `: ${emblem.subject}` : ""}`}
      tabIndex={-1}
      data-look={look}
      data-mood={mood}
      data-ink={colour === "var(--ink)" ? "" : undefined}
      style={{ "--c": colour }}
      onKeyDown={onKeyDown}
      onClick={onClose}
    >
      <Screen emblem={emblem} callsign={callsign} look={look} turn={turn} onTurn={spin} onClose={onClose} />
    </div>,
    document.body,
  );
}

function Screen({ emblem, callsign, look, turn, onTurn, onClose }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const el = box.current;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // The layout, in screen pixels and in cells.
  const frame = useMemo(() => {
    if (!size) return null;
    const pitch = look === "sekiguchi" ? 5 : 4;
    const w = Math.floor(size.w / pitch);
    const h = Math.floor(size.h / pitch);
    const top = 0.05 * h;
    const room = 0.86 * h;
    // As tall as the room allows, unless a wide one (its view) would then
    // run off the sides.
    const [v0, v1] = emblem.view || [0, 100];
    const span = (v1 - v0) / 100;
    const n = Math.floor(Math.min(room, (w * 0.98) / span, w * 0.94));
    return { pitch, w, h, n, v0, ox: Math.floor((w - Math.round(n * span)) / 2), oy: Math.round(top + (room - n) / 2), bezel: size.h * 0.09 };
  }, [size, look, emblem]);

  const seed = useMemo(() => [...callsign].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7), [callsign]);
  const cos = Math.cos((turn * Math.PI) / 180);

  useEffect(() => {
    const el = canvas.current;
    if (!frame || !el) return;
    const { pitch, w, h, n, ox, oy } = frame;
    const { cells: art, w: aw } = rasteriseView(emblem, n, cos);
    if (!art) return;
    const grid = new Float32Array(w * h);
    for (let j = 0; j < n; j++) for (let i = 0; i < aw; i++) if (ox + i >= 0 && ox + i < w && oy + j < h) grid[(oy + j) * w + ox + i] = art[j * aw + i];
    const dots = halftone(grid, w, look, seed, h);
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * ratio);
    el.height = Math.round(size.h * ratio);
    const ctx = el.getContext("2d");
    const style = getComputedStyle(el.parentElement);
    const screen = style.getPropertyValue("--ev-screen").trim() || "#c8ff00";
    const ink = style.getPropertyValue("--ev-ink").trim() || "#0a0a0a";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = screen;
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.setTransform(pitch * ratio, 0, 0, pitch * ratio, 0, 0);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.fill(new Path2D(dots.noise));
    ctx.globalAlpha = 1;
    ctx.fill(new Path2D(dots.ink));
    ctx.fillStyle = screen;
    ctx.fill(new Path2D(dots.holes));
  }, [frame, emblem, cos, look, seed, size]);

  if (!size || !frame) return <div ref={box} className="ev-screen" />;
  const { pitch, n, ox, oy, bezel, v0 } = frame;
  const W = size.w;
  const H = size.h;
  // The halo, over the emblem's mind wherever the turn has taken it.
  const halo = emblem.halo
    ? { x: (ox + ((50 + (emblem.halo.x - 50) * cos - v0) * n) / 100) * pitch, y: (oy + (emblem.halo.y * n) / 100) * pitch, r: ((emblem.halo.r * n) / 100) * pitch }
    : null;
  const curve = look !== "sekiguchi";
  const dialW = Math.min(240, W * 0.3);
  const dialY = H - bezel * 0.55;
  const at = W / 2 + (turn / LIMIT) * (dialW / 2);

  return (
    <div ref={box} className="ev-screen">
      <canvas ref={canvas} className="ev-print" style={{ width: W, height: H }} aria-hidden="true" />
      <svg className="ev-over" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {halo ? (
          <g className="em-halo" style={{ transformOrigin: `${halo.x}px ${halo.y}px` }}>
            {Array.from({ length: 7 }, (_, k) => {
              const a = -Math.PI / 2 + (k * 2 * Math.PI) / 7;
              const cx = halo.x + halo.r * Math.cos(a);
              const cy = halo.y + halo.r * Math.sin(a);
              const s = Math.max(5, halo.r * 0.16);
              const diamond = (d) => [0, 1, 2, 3].map((q) => `${cx + d * Math.cos(a + Math.PI / 4 + (q * Math.PI) / 2)},${cy + d * Math.sin(a + Math.PI / 4 + (q * Math.PI) / 2)}`).join(" ");
              // A frame of a diamond with a dot in it, as round Durandal's rider.
              return (
                <g key={k} className="em-diamond" style={{ "--k": k }}>
                  <polygon points={diamond(s)} />
                  <polygon className="em-core" points={diamond(s * 0.62)} />
                  <rect x={cx - s * 0.22} y={cy - s * 0.22} width={s * 0.44} height={s * 0.44} />
                </g>
              );
            })}
          </g>
        ) : null}
        <path className="ev-bezel" d={curve ? `M0 0H${W}V${bezel * 0.6}Q${W / 2} ${-bezel * 0.25} 0 ${bezel * 0.6}Z` : `M0 0H${W}V${bezel * 0.32}H0Z`} />
        <path className="ev-bezel" d={curve ? `M0 ${H}H${W}V${H - bezel}Q${W / 2} ${H - bezel * 0.35} 0 ${H - bezel}Z` : `M0 ${H}H${W}V${H - bezel * 0.8}H0Z`} />
        <g className="ev-dial">
          <path d={`M${W / 2 - dialW / 2} ${dialY}H${W / 2 + dialW / 2}M${W / 2 - dialW / 2} ${dialY - 6}V${dialY + 6}M${W / 2 + dialW / 2} ${dialY - 6}V${dialY + 6}M${W / 2} ${dialY - 4}V${dialY}`} />
          <rect x={at - 14} y={dialY - 4} width={28} height={8} />
          <path d={`M${at - 7} ${dialY - 4}V${dialY + 4}`} />
        </g>
      </svg>
      <p className="ev-label">
        {callsign}
        {emblem.caption ? <span> // {emblem.caption}</span> : null}
      </p>
      <button type="button" className="ev-close" onClick={onClose} aria-label="Close">
        ESC ✕
      </button>
      <div className="ev-turns" style={{ left: W / 2 - dialW / 2 - 18, width: dialW + 36, top: dialY + 6 }} onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Turn left" disabled={turn <= -LIMIT} onClick={() => onTurn(-STEP)}>
          R-
        </button>
        <button type="button" aria-label="Turn right" disabled={turn >= LIMIT} onClick={() => onTurn(STEP)}>
          R+
        </button>
      </div>
    </div>
  );
}
