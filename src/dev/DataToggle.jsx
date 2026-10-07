import { useState } from "react";

import { DATASETS } from "./fixtures.js";
import "./dev.css";

/* Dev only (main.jsx renders it only under `vite` dev): a switch at the foot
 * of the window between your own data and the stress-test fixtures. The
 * choice is kept in the URL (?data=worst), so a reload keeps it. Plain on
 * purpose -- it's not part of the design under test. */
export const datasetFromUrl = () => new URLSearchParams(location.search).get("data") || "demo";

export function DataToggle({ value, onChange }) {
  return (
    <div className="dev-data" role="radiogroup" aria-label="Data">
      {DATASETS.map((d) => (
        <button key={d.id} type="button" role="radio" aria-checked={value === d.id} onClick={() => onChange(d.id)}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

export function useDataset() {
  const [dataset, setDataset] = useState(datasetFromUrl);
  const choose = (next) => {
    const url = new URL(location.href);
    if (next === "demo") url.searchParams.delete("data");
    else url.searchParams.set("data", next);
    history.replaceState(null, "", url);
    setDataset(next);
  };
  return [dataset, choose];
}
