import { useEffect, useRef, useState } from "react";

import { inDesktop } from "../lib/http.js";
import { openInBrowser } from "../lib/desktop.js";
import { browserAt, browserConnected, browsersFound, installExtension, stopBrowserCheck } from "../lib/computer/connection.js";
import { EXTENSION_STORE_URL } from "../lib/computer/extension.js";

/* Which browser the computer uses on this Mac. By default the reader's own
 * -- Dia, Chrome, Arc, whichever, with their logins -- through the blvrd
 * extension (computer/extension), each chat's agent in a window of its own.
 * Or a separate one the computer starts (src-tauri/src/browsers.rs): any
 * built on Chromium, found here or pointed at, with a profile of its own.
 * The sandbox always has its own Chromium. */
export function BrowserCard({ browser, onBrowser }) {
  const separate = browser?.mode === "separate";
  const [found, setFound] = useState(null);
  const [other, setOther] = useState("");
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (inDesktop()) browsersFound().then(setFound).catch(() => setFound([]));
  }, []);
  if (!inDesktop()) return null;

  const setMode = (mode) => {
    setProblem(null);
    onBrowser({ ...(browser || {}), mode });
  };

  const listed = [...(found || [])];
  if (browser?.path && !listed.some((b) => b.path === browser.path)) listed.push(browser);
  const value = browser?.path || "";
  const pick = (path) => {
    setProblem(null);
    if (path === "other") return setOther(other || "/Applications/");
    const b = listed.find((x) => x.path === path);
    onBrowser({ ...(b || {}), mode: "separate", show: Boolean(browser?.show) });
  };
  const useOther = async () => {
    setProblem(null);
    try {
      const b = await browserAt(other);
      onBrowser({ ...b, mode: "separate", show: Boolean(browser?.show) });
      setOther("");
    } catch (e) {
      setProblem(e.message || String(e));
    }
  };

  return (
    <section className="card">
      <h2>The computer’s browser</h2>
      <p className="hint">What agents browse with when a chat’s computer is This Mac. The sandbox always uses its own Chromium.</p>
      <div className="browser-modes" role="radiogroup" aria-label="The computer's browser">
        <label className="check">
          <input type="radio" name="browser-mode" checked={!separate} onChange={() => setMode("own")} />
          <span>Your browser, with your logins — through the blvrd extension</span>
        </label>
        <label className="check">
          <input type="radio" name="browser-mode" checked={separate} onChange={() => setMode("separate")} />
          <span>A separate browser, with none of your logins or tabs</span>
        </label>
      </div>
      {!separate ? <OwnBrowser found={found} /> : null}
      {problem ? <p className="error-line">{problem}</p> : null}
      {separate ? separatePicker() : null}
    </section>
  );

  function separatePicker() {
    return (
      <>
        {found === null ? (
          <p className="hint">Looking for browsers…</p>
        ) : (
          <div className="field-row">
            <select value={other ? "other" : value} onChange={(e) => pick(e.target.value)} aria-label="The computer's browser">
              <option value="">{listed.length ? `The first one found (${listed[0].name})` : "None found"}</option>
              {listed.map((b) => (
                <option key={b.path} value={b.path}>
                  {b.name}
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </div>
        )}
        {other ? (
          <div className="field-row">
            <input type="text" value={other} onChange={(e) => setOther(e.target.value)} placeholder="/Applications/Some Browser.app" aria-label="The browser's app" />
            <button type="button" className="btn" onClick={useOther} disabled={!other.trim()}>
              Use it
            </button>
            <button type="button" className="btn" onClick={() => setOther("")}>
              Cancel
            </button>
          </div>
        ) : null}
        <label className="check browser-show">
          <input type="checkbox" checked={Boolean(browser?.show)} onChange={(e) => onBrowser({ ...(browser || {}), show: e.target.checked })} />
          <span>Show its window while agents use it (some browsers won’t run hidden)</span>
        </label>
      </>
    );
  }
}

/* The reader's own browser: adding the extension to it, and whether it's
   connected. With a Web Store listing (lib/computer/extension.js) that's one
   click; without, one click opens everything needed and says the two
   moves left to make there -- and this turns green when the browser
   connects. */
const WATCH_MS = 3 * 60 * 1000;
function OwnBrowser({ found }) {
  const [target, setTarget] = useState("");
  const [connected, setConnected] = useState(null); // null: still finding out
  const [setup, setSetup] = useState(null); // { folder, browser } once asked
  const [problem, setProblem] = useState(null);
  const until = useRef(Date.now() + 40_000);

  // Looks every two seconds: quietly for a while at first (an extension
  // already added connects within a few), then for a few minutes after the
  // reader is sent to add it.
  useEffect(() => {
    let gone = false;
    let timer = null;
    const look = async () => {
      const yes = await browserConnected().catch(() => false);
      if (gone) return;
      setConnected(yes);
      if (!yes && Date.now() < until.current) timer = setTimeout(look, 2000);
    };
    look();
    return () => {
      gone = true;
      clearTimeout(timer);
      stopBrowserCheck();
    };
  }, [setup]);

  const browsers = found || [];
  const chosen = browsers.find((b) => b.path === target) || browsers[0] || null;
  const name = chosen?.name || "your browser";
  const add = async () => {
    setProblem(null);
    if (EXTENSION_STORE_URL) {
      until.current = Date.now() + WATCH_MS;
      setSetup({ store: true });
      return openInBrowser(EXTENSION_STORE_URL);
    }
    try {
      const done = await installExtension(chosen?.path);
      until.current = Date.now() + WATCH_MS;
      setConnected(null);
      setSetup(done);
    } catch (e) {
      setProblem(e.message || String(e));
    }
  };

  if (connected) {
    return (
      <p className="browser-status browser-status-on">
        <span aria-hidden="true">●</span> Connected — agents use your browser, each chat in a window of its own. Keep it open while they work.
      </p>
    );
  }
  return (
    <>
      <p className="browser-status">
        {connected === null && !setup ? "Checking for your browser…" : setup ? `Waiting for ${setup.browser || name} to connect…` : "Not set up yet: your browser needs the blvrd extension."}
      </p>
      <div className="field-row">
        {browsers.length > 1 && !EXTENSION_STORE_URL ? (
          <select value={chosen?.path || ""} onChange={(e) => setTarget(e.target.value)} aria-label="Your browser">
            {browsers.map((b) => (
              <option key={b.path} value={b.path}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn primary" onClick={add}>
          {setup ? "Open it again" : `Add blvrd to ${EXTENSION_STORE_URL ? "your browser" : name}`}
        </button>
      </div>
      {setup && !setup.store ? (
        <ol className="hint browser-steps">
          <li>
            In {setup.browser || name}’s extensions page, turn on <strong>Developer mode</strong>.
          </li>
          <li>
            Drag the <strong>Extension</strong> folder from the Finder window onto that page. (Or choose Load unpacked, press ⌘⇧G, paste — its path is copied —
            and press Return.)
          </li>
        </ol>
      ) : null}
      {setup && !setup.store ? (
        <p className="hint">
          Nothing opened? Go to <code>chrome://extensions</code> in your browser; the folder is <code>{setup.folder}</code>.
        </p>
      ) : null}
      {setup?.store ? <p className="hint">Choose “Add to Chrome” on the page that opened (it works in Dia, Arc, Brave and Edge too).</p> : null}
      {problem ? <p className="error-line">{problem}</p> : null}
      <p className="hint">It’s signed in as you, so watch what agents do on the screen beside the chat. Safari and Firefox can’t be used this way.</p>
    </>
  );
}
