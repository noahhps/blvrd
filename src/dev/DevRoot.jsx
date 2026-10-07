import { load } from "../lib/store.js";
import { DataToggle, useDataset } from "./DataToggle.jsx";
import { DATASETS } from "./fixtures.js";

/* The app with the data switch under it (dev only, main.jsx). A fixture is
 * laid over the saved state -- providers, settings and all kept -- and the
 * app remounted for each, so nothing carries over between them. */
export function DevRoot({ App }) {
  const [dataset, choose] = useDataset();
  const make = DATASETS.find((d) => d.id === dataset)?.make;
  const fixture = make ? { ...load(), ...make() } : null;
  return (
    <>
      <App key={dataset} fixture={fixture} />
      <DataToggle value={dataset} onChange={choose} />
    </>
  );
}
