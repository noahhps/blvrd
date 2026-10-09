import { useEffect, useState } from "react";

import { inDesktop } from "../lib/http.js";
import { browserAt, browsersFound, revealExtension } from "../lib/computer/connection.js";

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
  const [folder, setFolder] = useState(null);
  useEffect(() => {
    if (inDesktop() && separate && found === null) browsersFound().then(setFound).catch(() => setFound([]));
  }, [separate, found]);
  if (!inDesktop()) return null;

  const setMode = (mode) => {
    setProblem(null);
    onBrowser({ ...(browser || {}), mode });
  };
  const showFolder = async () => {
    setProblem(null);
    try {
      setFolder(await revealExtension());
    } catch (e) {
      setProblem(e.message || String(e));
    }
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
      {!separate ? (
        <>
          <ol className="hint browser-steps">
            <li>
              <button type="button" className="btn" onClick={showFolder}>
                Show the extension folder
              </button>{" "}
              {folder ? <code>{folder}</code> : null}
            </li>
            <li>
              In your browser (Dia, Chrome, Arc, Brave, Edge…), open <code>chrome://extensions</code> and turn on Developer mode.
            </li>
            <li>Choose Load unpacked, and pick that folder.</li>
          </ol>
          <p className="hint">
            Keep the browser open while agents work: each chat’s agent gets a window of its own, and your own tabs are left alone. It’s signed in as you,
            so watch what it does on the screen beside the chat. Safari and Firefox can’t be used this way.
          </p>
        </>
      ) : null}
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
