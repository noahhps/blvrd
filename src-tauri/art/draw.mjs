/* Drawing SVG or HTML into PNGs with a Chromium browser, through computer/'s
 * playwright-core: BLVRD_CHROMIUM, or the first of the usual ones found. */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* A Chromium to draw it with: one named, or the first of the usual ones. */
function chromium() {
  const named = process.env.BLVRD_CHROMIUM;
  const usual = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Arc.app/Contents/MacOS/Arc",
    "/Applications/Dia.app/Contents/MacOS/Dia",
  ];
  const found = [named, ...usual].find((p) => p && existsSync(p));
  if (!found) throw new Error("No Chromium browser found: set BLVRD_CHROMIUM to one.");
  return found;
}


/** Each of `shots` ({ html, width, height, scale, path }) drawn and saved. */
export async function draw(shots) {
  const require = createRequire(join(root, "computer", "package.json"));
  const { chromium: playwright } = require("playwright-core");
  const browser = await playwright.launch({ executablePath: chromium(), headless: true });
  try {
    for (const { html, width, height, scale = 1, path, transparent = false } of shots) {
      const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
      await tab.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${html}`);
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path, omitBackground: transparent });
      await tab.close();
    }
  } finally {
    await browser.close();
  }
}
