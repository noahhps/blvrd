/* blvrd UI -> Figma. Rebuilds the app's screens, as captured from the running
 * app by capture.js, as editable Figma layers: frames for boxes, text layers
 * with their real fonts and runs, vector icons, and the agents' dot avatars.
 *
 * `SCREENS` and `FONTS` are filled in by build.mjs. */

/* global figma, SCREENS, FONTS */

const GAP = 120;

const FAMILIES = {
  "Bricolage Grotesque": ["Bricolage Grotesque", "Inter"],
  "Helvetica Neue": ["Helvetica Neue", "Helvetica", "Inter"],
  Helvetica: ["Helvetica", "Helvetica Neue", "Inter"],
  "ui-monospace": ["SF Mono", "Roboto Mono", "JetBrains Mono", "Source Code Pro", "Inter"],
  "SF Mono": ["SF Mono", "Roboto Mono", "JetBrains Mono", "Source Code Pro", "Inter"],
  Menlo: ["Menlo", "SF Mono", "Roboto Mono", "Inter"],
  monospace: ["Roboto Mono", "Source Code Pro", "Inter"],
};

const STYLE_WEIGHTS = [
  [/thin|hairline/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/light/, 300],
  [/semi ?bold|demi ?bold/, 600],
  [/extra ?bold|ultra ?bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700],
  [/medium/, 500],
];
function weightOfStyle(style) {
  const s = style.toLowerCase();
  for (const [re, w] of STYLE_WEIGHTS) if (re.test(s)) return w;
  return 400;
}

let available = null; // family -> [style]
async function fontFor(font) {
  if (!available) {
    available = new Map();
    for (const f of await figma.listAvailableFontsAsync()) {
      const list = available.get(f.fontName.family) || [];
      list.push(f.fontName.style);
      available.set(f.fontName.family, list);
    }
  }
  const families = [...(FAMILIES[font.family] || [font.family]), "Inter"];
  for (const family of families) {
    const styles = available.get(family);
    if (!styles) continue;
    let best = null;
    let score = Infinity;
    for (const style of styles) {
      const italic = /italic|oblique/i.test(style);
      const s = Math.abs(weightOfStyle(style) - font.weight) + (italic !== Boolean(font.italic) ? 1000 : 0) + (/condensed|narrow|display|text/i.test(style) ? 50 : 0);
      if (s < score) {
        score = s;
        best = style;
      }
    }
    if (best) return { family, style: best };
  }
  return { family: "Inter", style: "Regular" };
}

const loaded = new Map(); // "family|weight|italic" -> FontName
async function prepareFonts() {
  for (const font of FONTS) {
    const key = `${font.family}|${font.weight}|${font.italic}`;
    if (loaded.has(key)) continue;
    let name = await fontFor(font);
    try {
      await figma.loadFontAsync(name);
    } catch (e) {
      name = { family: "Inter", style: "Regular" };
      await figma.loadFontAsync(name);
    }
    loaded.set(key, name);
  }
}
const fontNameOf = (font) => loaded.get(`${font.family}|${font.weight}|${font.italic}`) || { family: "Inter", style: "Regular" };

const solid = (c) => ({ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a == null ? 1 : c.a });
const same = (a, b) => a && b && Math.abs(a.r - b.r) < 0.002 && Math.abs(a.g - b.g) < 0.002 && Math.abs(a.b - b.b) < 0.002 && Math.abs(a.a - b.a) < 0.002;

function place(node, data) {
  node.name = data.name || node.name;
  node.x = data.x;
  node.y = data.y;
}

function applyBox(frame, data) {
  frame.fills = (data.fills || []).map(solid);
  const [tl, tr, br, bl] = data.radius || [0, 0, 0, 0];
  frame.topLeftRadius = tl;
  frame.topRightRadius = tr;
  frame.bottomRightRadius = br;
  frame.bottomLeftRadius = bl;
  if (data.effects && data.effects.length) {
    frame.effects = data.effects.map((e) => ({
      type: e.type,
      color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a },
      offset: e.offset,
      radius: e.radius,
      spread: e.spread,
      visible: true,
      blendMode: "NORMAL",
      showShadowBehindNode: false,
    }));
  }
  if (data.opacity != null && data.opacity < 1) frame.opacity = data.opacity;

  // Borders: Figma has one stroke paint per node, with a weight per side. The
  // commonest border colour becomes the stroke; a side in another colour (the
  // red edge on an approval) is drawn as its own bar on top.
  const sides = (data.sides || []).filter((s) => s.width > 0 && s.color);
  if (!sides.length) return [];
  const main = sides.reduce((best, s) => (sides.filter((t) => same(t.color, s.color)).length > sides.filter((t) => same(t.color, best.color)).length ? s : best), sides[0]);
  const weights = { Top: 0, Right: 0, Bottom: 0, Left: 0 };
  const extra = [];
  for (const s of sides) {
    if (same(s.color, main.color)) weights[s.side] = s.width;
    else extra.push(s);
  }
  frame.strokes = [solid(main.color)];
  frame.strokeAlign = "INSIDE";
  const ws = Object.values(weights);
  if (ws.every((w) => w === ws[0])) frame.strokeWeight = ws[0];
  else {
    frame.strokeTopWeight = weights.Top;
    frame.strokeRightWeight = weights.Right;
    frame.strokeBottomWeight = weights.Bottom;
    frame.strokeLeftWeight = weights.Left;
  }
  return extra;
}

function sideBar(side, w, h, radius) {
  const r = figma.createRectangle();
  r.name = `border-${side.side.toLowerCase()}`;
  const t = side.width;
  const geo = { Top: [0, 0, w, t], Bottom: [0, h - t, w, t], Left: [0, 0, t, h], Right: [w - t, 0, t, h] }[side.side];
  r.x = geo[0];
  r.y = geo[1];
  r.resize(Math.max(geo[2], 0.01), Math.max(geo[3], 0.01));
  r.fills = [solid(side.color)];
  const [tl, tr, br, bl] = radius || [0, 0, 0, 0];
  if (side.side === "Left") {
    r.topLeftRadius = tl;
    r.bottomLeftRadius = bl;
  }
  if (side.side === "Right") {
    r.topRightRadius = tr;
    r.bottomRightRadius = br;
  }
  return r;
}

function buildText(data) {
  const runs = data.runs.map((run) => ({ text: run.text, font: FONTS[run.font] }));
  const t = figma.createText();
  const first = runs[0].font;
  t.fontName = fontNameOf(first);
  t.characters = runs.map((r) => r.text).join("");
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (end > at) {
      const f = run.font;
      t.setRangeFontName(at, end, fontNameOf(f));
      t.setRangeFontSize(at, end, f.size);
      t.setRangeLineHeight(at, end, { unit: "PIXELS", value: f.lineHeight });
      t.setRangeLetterSpacing(at, end, { unit: "PIXELS", value: f.letterSpacing || 0 });
      t.setRangeFills(at, end, [solid(f.color)]);
      if (f.decoration && f.decoration !== "NONE") t.setRangeTextDecoration(at, end, f.decoration);
    }
    at = end;
  }
  t.textAlignHorizontal = data.align || "LEFT";
  t.name = data.name === "text" || data.name === "value" ? t.characters.slice(0, 40) : data.name;
  if (data.truncate) {
    t.textAutoResize = "NONE";
    t.resize(Math.max(data.w, 1), Math.max(...runs.map((r) => r.font.lineHeight)));
    t.textTruncation = "ENDING";
    t.maxLines = 1;
    t.x = data.x;
    t.y = data.y;
  } else if (data.single) {
    t.textAutoResize = "WIDTH_AND_HEIGHT";
    t.x = data.align === "CENTER" ? data.x + (data.w - t.width) / 2 : data.align === "RIGHT" ? data.x + data.w - t.width : data.x;
    t.y = data.ty != null ? data.ty : data.y;
  } else {
    t.textAutoResize = "HEIGHT";
    // A hair of room, since a fallback font can run wider than the original.
    t.resize(Math.max(data.w + 1, 1), t.height);
    t.x = data.x;
    t.y = data.y;
  }
  return t;
}

function buildSvg(data) {
  try {
    const node = figma.createNodeFromSvg(data.svg);
    node.name = data.name;
    node.x = data.x;
    node.y = data.y;
    node.fills = [];
    if (Math.abs(node.width - data.w) > 0.5 || Math.abs(node.height - data.h) > 0.5) node.resize(Math.max(data.w, 0.01), Math.max(data.h, 0.01));
    return node;
  } catch (e) {
    return null;
  }
}

function buildImage(data) {
  const r = figma.createRectangle();
  place(r, data);
  r.resize(Math.max(data.w, 0.01), Math.max(data.h, 0.01));
  const [tl, tr, br, bl] = data.radius || [0, 0, 0, 0];
  r.topLeftRadius = tl;
  r.topRightRadius = tr;
  r.bottomRightRadius = br;
  r.bottomLeftRadius = bl;
  if (data.data) {
    const image = figma.createImage(figma.base64Decode(data.data));
    r.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
  } else r.fills = [solid({ r: 0.9, g: 0.9, b: 0.9, a: 1 })];
  return r;
}

function buildFrame(data) {
  const f = figma.createFrame();
  place(f, data);
  f.resize(Math.max(data.w, 0.01), Math.max(data.h, 0.01));
  const extra = applyBox(f, data);
  f.clipsContent = Boolean(data.clip);
  for (const child of data.children || []) {
    const node = build(child);
    if (node) f.appendChild(node);
  }
  for (const side of extra) f.appendChild(sideBar(side, data.w, data.h, data.radius));
  return f;
}

function build(data) {
  if (data.type === "text") return buildText(data);
  if (data.type === "svg") return buildSvg(data);
  if (data.type === "image") return buildImage(data);
  return buildFrame(data);
}

async function main() {
  await prepareFonts();
  const page = figma.currentPage;
  // Start to the right of whatever is already on the page.
  let x = page.children.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  x = x ? x + GAP * 2 : 0;
  const startX = x;
  let y = 0;
  let row = null;
  const made = [];
  for (const screen of SCREENS) {
    // Light screens on the first row, dark ones under them.
    if (row !== null && screen.theme !== row) {
      x = startX;
      y += Math.max(...made.map((n) => n.height)) + GAP * 2;
    }
    row = screen.theme;
    figma.notify(`Building ${screen.name}…`, { timeout: 800 });
    const frame = buildFrame(screen.root);
    frame.name = screen.name;
    frame.x = x;
    frame.y = y;
    page.appendChild(frame);
    made.push(frame);
    x += frame.width + GAP;
  }
  figma.currentPage.selection = made;
  figma.viewport.scrollAndZoomIntoView(made);
  figma.closePlugin(`Built ${made.length} blvrd screens`);
}

main().catch((e) => figma.closePlugin(`Couldn't build the screens: ${e.message}`));
