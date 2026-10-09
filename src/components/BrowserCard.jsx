import { useEffect, useState } from "react";

import { inDesktop } from "../lib/http.js";
import { browserAt, browsersFound } from "../lib/computer/connection.js";

/* Which browser the computer uses on this Mac (src-tauri/src/browsers.rs):
 * any built on Chromium -- Dia, Arc, Chrome, Brave, Edge... -- found here, or
 * pointed at. Always with a profile of its own, so none of the reader's logins
 * or tabs; the sandbox has its own Chromium. */
export function BrowserCard({ browser, onBrowser }) {
  const [found, setFound] = useState(null);
  const [other, setOther] = useState("");
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (inDesktop()) browsersFound().then(setFound).catch(() => setFound([]));
  }, []);
  if (!inDesktop()) return null;

  const listed = [...(found || [])];
  if (browser?.path && !listed.some((b) => b.path === browser.path)) listed.push(browser);
  const value = browser?.path || "";
  const pick = (path) => {
    setProblem(null);
    if (path === "other") return setOther(other || "/Applications/");
    const b = listed.find((x) => x.path === path);
    onBrowser(b ? { ...b, show: Boolean(browser?.show) } : browser?.show ? { show: true } : null);
  };
  const useOther = async () => {
    setProblem(null);
    try {
      const b = await browserAt(other);
      onBrowser({ ...b, show: Boolean(browser?.show) });
      setOther("");
    } catch (e) {
      setProblem(e.message || String(e));
    }
  };

  return (
    <section className="card">
      <h2>The computer’s browser</h2>
      <p className="hint">
        What the computer browses with on this Mac: any browser built on Chromium. It always has a profile of its own —
        none of your logins or tabs — and the sandbox uses its own Chromium. Safari and Firefox can’t be driven this way.
      </p>
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
      {problem ? <p className="error-line">{problem}</p> : null}
      <label className="check browser-show">
        <input type="checkbox" checked={Boolean(browser?.show)} onChange={(e) => onBrowser({ ...(browser || {}), show: e.target.checked })} />
        <span>Show its window while agents use it (some browsers won’t run hidden)</span>
      </label>
    </section>
  );
}
