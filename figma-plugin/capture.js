/* Capture what the app shows on screen as plain data the Figma plugin can
 * rebuild as layers (figma-plugin/code.js).
 *
 * Run in the page (the dev server, any screen): `await captureScreen("Name")`
 * returns { name, width, height, theme, root } where root is a tree of
 *
 *   frame  { type, name, x, y, w, h, fills, strokes, radius, effects, opacity, clip, children }
 *   text   { type, name, x, y, w, h, runs: [{ text, font }], align, single, truncate }
 *   svg    { type, name, x, y, w, h, svg }
 *   image  { type, name, x, y, w, h, radius, data }   data: base64
 *
 * Positions are relative to the parent node. Colours are { r, g, b, a } in 0..1.
 * Only what is in the viewport and visible is kept; nothing is fetched. */

(() => {
  const INLINE = new Set(["inline", "contents"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);

  function colour(value) {
    if (!value || value === "transparent" || value === "none") return null;
    let m = value.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      const c = { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length > 3 ? p[3] : 1 };
      return c.a > 0 ? c : null;
    }
    m = value.match(/^color\(srgb ([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
      const c = { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      return c.a > 0 ? c : null;
    }
    // Anything else (oklab, named): let a canvas normalise it.
    const ctx = colour.ctx || (colour.ctx = document.createElement("canvas").getContext("2d"));
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    return ctx.fillStyle === value ? null : colour(ctx.fillStyle.startsWith("#") ? hexToRgb(ctx.fillStyle) : ctx.fillStyle);
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }

  // "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, inset ..." -> Figma effects
  function shadows(value) {
    if (!value || value === "none") return [];
    const parts = value.split(/,(?![^(]*\))/);
    const out = [];
    for (const part of parts) {
      const col = part.match(/(rgba?\([^)]+\)|color\([^)]+\)|#[0-9a-f]+)/i);
      const nums = part.replace(col ? col[0] : "", "").match(/-?[\d.]+px|-?[\d.]+(?=\s|$)/g) || [];
      const [x = 0, y = 0, blur = 0, spread = 0] = nums.map(parseFloat);
      const c = colour(col ? col[0] : "rgb(0,0,0)");
      if (!c) continue;
      out.push({ type: /inset/.test(part) ? "INNER_SHADOW" : "DROP_SHADOW", color: c, offset: { x, y }, radius: blur, spread });
    }
    return out;
  }

  function radii(cs, w, h) {
    const one = (v) => {
      const n = parseFloat(v) || 0;
      return /%/.test(v) ? (n / 100) * Math.min(w, h) : n;
    };
    const r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(one);
    const cap = Math.min(w, h) / 2;
    return r.map((v) => Math.min(v, cap));
  }

  function nameOf(el) {
    const label = el.getAttribute?.("aria-label");
    if (label) return label;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return cls || el.tagName.toLowerCase();
  }

  function fontOf(cs) {
    const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === "normal" ? size * 1.2 : parseFloat(cs.lineHeight);
    return {
      family,
      weight: Number(cs.fontWeight) || 400,
      italic: cs.fontStyle === "italic",
      size,
      lineHeight: lh,
      letterSpacing: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing),
      color: colour(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
      decoration: cs.textDecorationLine.includes("underline") ? "UNDERLINE" : cs.textDecorationLine.includes("line-through") ? "STRIKETHROUGH" : "NONE",
      transform: cs.textTransform,
    };
  }

  const visible = (cs) => cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.01;
  const transformText = (t, how) => (how === "uppercase" ? t.toUpperCase() : how === "lowercase" ? t.toLowerCase() : t);

  // An element whose content is only text and inline elements becomes one text
  // layer with styled runs, so wrapped, mixed-weight lines stay as they read.
  function inlineOnly(el) {
    let any = false;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (node.textContent.trim()) any = true;
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (node.tagName === "BR") continue;
      const cs = getComputedStyle(node);
      if (cs.display === "none") continue;
      if (!INLINE.has(cs.display) || node.tagName === "svg" || node.tagName === "IMG" || cs.position === "absolute") return false;
      if (!inlineOnly(node) && node.childNodes.length) return false;
      any = any || Boolean(node.textContent.trim());
    }
    return any;
  }

  function runsOf(el, pre, out = []) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const cs = getComputedStyle(node.parentElement);
        let text = pre ? node.textContent : node.textContent.replace(/\s+/g, " ");
        text = transformText(text, cs.textTransform);
        if (text) out.push({ text, font: fontOf(cs) });
      } else if (node.nodeType === 1) {
        if (node.tagName === "BR") out.push({ text: "\n", font: fontOf(getComputedStyle(el)) });
        else if (getComputedStyle(node).display !== "none") runsOf(node, pre, out);
      }
    }
    return out;
  }

  function tidyRuns(runs, pre) {
    if (pre) {
      // Drop one trailing newline, as the browser does.
      const last = runs[runs.length - 1];
      if (last) last.text = last.text.replace(/\n$/, "");
      return runs.filter((r) => r.text);
    }
    // Collapse spaces across run boundaries and trim the ends.
    let prevSpace = true;
    for (const r of runs) {
      if (r.text === "\n") { prevSpace = true; continue; }
      if (prevSpace) r.text = r.text.replace(/^ /, "");
      prevSpace = r.text.endsWith(" ") || (prevSpace && !r.text);
    }
    for (let i = runs.length - 1; i >= 0; i--) {
      runs[i].text = runs[i].text.replace(/ $/, "");
      if (runs[i].text) break;
    }
    return runs.filter((r) => r.text);
  }

  function textBox(el, cs, rect, runs, name) {
    const pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const pr = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
    const pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const pb = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
    // The text's own extent, which for a flex item or a padded box is
    // tighter than the element's.
    const range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    const truncate = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
    const single = lines <= 1 && !truncate && !/\n/.test(runs.map((r) => r.text).join(""));
    const x = single ? tr.left : rect.left + pl;
    const w = single ? tr.width : rect.width - pl - pr;
    return {
      type: "text",
      name,
      x, y: rect.top + pt, w: Math.max(1, w), h: Math.max(1, rect.height - pt - pb),
      runs,
      align: { left: "LEFT", start: "LEFT", center: "CENTER", right: "RIGHT", end: "RIGHT", justify: "JUSTIFIED" }[cs.textAlign] || "LEFT",
      single,
      truncate,
      pre: /pre/.test(cs.whiteSpace),
      // Single-line text is placed where the glyphs actually are: Figma
      // centres a line in its line height, as CSS centres it in the line box.
      ty: single ? centred(tr, runs) : null,
    };
  }

  function centred(r, runs) {
    const lh = Math.max(...runs.map((run) => run.font.lineHeight));
    return r.top + (r.height - lh) / 2;
  }

  function svgNode(el, rect) {
    const clone = el.cloneNode(true);
    const src = [el, ...el.querySelectorAll("*")];
    const dst = [clone, ...clone.querySelectorAll("*")];
    src.forEach((node, i) => {
      const cs = getComputedStyle(node);
      const d = dst[i];
      for (const prop of ["fill", "stroke"]) {
        const v = cs[prop];
        if (v && v !== "none") {
          const c = colour(v);
          d.setAttribute(prop, c ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})` : v);
          if (c && c.a < 1) d.setAttribute(`${prop}-opacity`, String(c.a));
        } else if (v === "none" && node.getAttribute(prop)) d.setAttribute(prop, "none");
      }
      if (cs.strokeWidth && node !== el) d.setAttribute("stroke-width", cs.strokeWidth.replace("px", ""));
      d.removeAttribute("class");
      d.removeAttribute("style");
    });
    clone.setAttribute("width", rect.width);
    clone.setAttribute("height", rect.height);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return { type: "svg", name: nameOf(el) === "svg" ? "icon" : nameOf(el), x: rect.left, y: rect.top, w: rect.width, h: rect.height, svg: clone.outerHTML };
  }

  function imageNode(el, rect, cs) {
    let data = null;
    try {
      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      const ctx = canvas.getContext("2d");
      // object-fit: cover
      const iw = el.naturalWidth, ih = el.naturalHeight;
      const k = Math.max(canvas.width / iw, canvas.height / ih);
      ctx.drawImage(el, (canvas.width - iw * k) / 2, (canvas.height - ih * k) / 2, iw * k, ih * k);
      data = canvas.toDataURL("image/png").split(",")[1];
    } catch {}
    return { type: "image", name: el.alt || "image", x: rect.left, y: rect.top, w: rect.width, h: rect.height, radius: radii(cs, rect.width, rect.height), data };
  }

  // The visual part of a box: background, border, radius, shadow.
  function boxStyle(cs, w, h) {
    const fills = [];
    const bg = colour(cs.backgroundColor);
    if (bg) fills.push(bg);
    const sides = ["Top", "Right", "Bottom", "Left"].map((s) => ({
      side: s,
      width: cs[`border${s}Style`] === "none" ? 0 : parseFloat(cs[`border${s}Width`]) || 0,
      color: colour(cs[`border${s}Color`]),
    }));
    return { fills, sides, radius: radii(cs, w, h), effects: shadows(cs.boxShadow) };
  }

  function pseudo(el, which, rect) {
    const cs = getComputedStyle(el, which);
    if (!cs || cs.content === "none" || cs.content === "normal" || cs.display === "none") return null;
    const content = cs.content.replace(/^["']|["']$/g, "");
    let x, y, w, h;
    if (cs.position === "absolute") {
      const val = (v) => (v === "auto" ? null : parseFloat(v));
      const L = val(cs.left), R = val(cs.right), T = val(cs.top), B = val(cs.bottom);
      const ph = el.getBoundingClientRect();
      const W = parseFloat(cs.width), H = parseFloat(cs.height);
      w = Number.isFinite(W) ? W : ph.width - (L || 0) - (R || 0);
      h = Number.isFinite(H) ? H : ph.height - (T || 0) - (B || 0);
      x = ph.left + (L != null ? L : R != null ? ph.width - R - w : 0);
      y = ph.top + (T != null ? T : B != null ? ph.height - B - h : 0);
    } else if (!content) {
      return null; // an in-flow empty pseudo-element has no box we can place
    } else {
      return null;
    }
    if (w <= 0 || h <= 0) return null;
    const style = boxStyle(cs, w, h);
    if (!style.fills.length && !style.effects.length && !content) return null;
    return { type: "frame", name: which.replace("::", ""), x, y, w, h, ...style, opacity: parseFloat(cs.opacity), clip: false, children: [] };
  }

  function walk(el, vw, vh) {
    if (SKIP.has(el.tagName)) return null;
    const cs = getComputedStyle(el);
    if (!visible(cs)) return null;
    const rect = el.getBoundingClientRect();
    if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return null;
    if (el.tagName === "svg") return rect.width && rect.height ? svgNode(el, rect) : null;
    if (el.tagName === "IMG") return rect.width && rect.height ? imageNode(el, rect, cs) : null;

    const node = {
      type: "frame",
      name: nameOf(el),
      x: rect.left, y: rect.top, w: rect.width, h: rect.height,
      ...boxStyle(cs, rect.width, rect.height),
      opacity: parseFloat(cs.opacity),
      clip: el !== document.body && /hidden|auto|scroll|clip/.test(cs.overflow),
      children: [],
    };

    const before = pseudo(el, "::before", rect);
    if (before) node.children.push(before);

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      if (!(el.type === "checkbox" || el.type === "radio" || el.type === "range" || el.type === "hidden")) {
        const value = el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent || "" : el.value;
        const ph = !value && el.placeholder;
        const text = value || el.placeholder || "";
        if (text) {
          const fcs = ph ? getComputedStyle(el, "::placeholder") : cs;
          const font = fontOf(cs);
          if (ph) font.color = colour(fcs.color) || font.color;
          const t = textBox(el, cs, rect, [{ text: el.type === "password" ? "•".repeat(text.length) : text, font }], ph ? "placeholder" : "value");
          t.single = el.tagName !== "TEXTAREA";
          t.truncate = el.tagName !== "TEXTAREA";
          t.ty = null;
          // An input centres its line in the box.
          if (el.tagName !== "TEXTAREA") {
            t.y = rect.top + (rect.height - font.lineHeight) / 2;
            t.h = font.lineHeight;
          }
          node.children.push(t);
        }
      } else if (el.type === "checkbox" || el.type === "radio") {
        node.fills = [colour(el.checked ? getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#141414" : "#ffffff")].filter(Boolean);
        node.sides = ["Top", "Right", "Bottom", "Left"].map((side) => ({ side, width: 1, color: colour("#8a8a86") }));
        node.radius = el.type === "radio" ? [rect.width / 2, rect.width / 2, rect.width / 2, rect.width / 2] : [3, 3, 3, 3];
      }
    } else if (inlineOnly(el)) {
      const pre = /pre/.test(cs.whiteSpace);
      const runs = tidyRuns(runsOf(el, pre), pre);
      if (runs.length) {
        if (cs.display === "list-item" && cs.listStyleType !== "none") {
          const f = fontOf(cs);
          node.children.push({
            type: "text", name: "marker", x: rect.left - 16, y: rect.top, w: 12, h: f.lineHeight,
            runs: [{ text: cs.listStyleType === "decimal" ? `${[...el.parentElement.children].indexOf(el) + 1}.` : "•", font: f }],
            align: "RIGHT", single: true, truncate: false, pre: false, ty: null,
          });
        }
        node.children.push(textBox(el, cs, rect, runs, "text"));
      }
    } else {
      for (const child of el.childNodes) {
        if (child.nodeType === 1) {
          const c = walk(child, vw, vh);
          if (c) node.children.push(c);
        } else if (child.nodeType === 3 && child.textContent.trim()) {
          // Loose text beside elements: place it by its own box.
          const range = document.createRange();
          range.selectNodeContents(child);
          const r = range.getBoundingClientRect();
          if (!r.width) continue;
          const text = transformText(child.textContent.replace(/\s+/g, " ").trim(), cs.textTransform);
          node.children.push({ type: "text", name: "text", x: r.left, y: r.top, w: r.width, h: r.height, runs: [{ text, font: fontOf(cs) }], align: "LEFT", single: true, truncate: false, pre: false, ty: centred(r, [{ font: fontOf(cs) }]) });
        }
      }
    }

    const after = pseudo(el, "::after", rect);
    if (after) node.children.push(after);

    // A box with nothing to draw and nothing in it is dropped.
    const drawn = node.fills.length || node.effects.length || node.sides.some((s) => s.width && s.color);
    if (!drawn && !node.children.length) return null;
    return node;
  }

  // Positions become relative to the parent, as Figma wants them.
  function relative(node, ox, oy) {
    const ax = node.x, ay = node.y;
    node.x = +(ax - ox).toFixed(2);
    node.y = +(ay - oy).toFixed(2);
    if (node.ty != null) node.ty = +(node.ty - oy).toFixed(2);
    for (const c of node.children || []) relative(c, ax, ay);
    return node;
  }

  window.captureScreen = function captureScreen(name) {
    const vw = innerWidth, vh = innerHeight;
    const root = walk(document.body, vw, vh) || { type: "frame", children: [] };
    root.x = 0; root.y = 0; root.w = vw; root.h = vh;
    root.fills = root.fills.length ? root.fills : [colour(getComputedStyle(document.body).backgroundColor) || { r: 1, g: 1, b: 1, a: 1 }];
    root.clip = true;
    root.name = name;
    relative(root, 0, 0);
    return { name, width: vw, height: vh, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", root };
  };
})();
