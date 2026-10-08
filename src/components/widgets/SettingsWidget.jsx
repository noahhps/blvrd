import { Icon } from "../Icon.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

/* The way to what agents know about the user (the Notebook), what they can
 * reach, and which models they run on. */
export function SettingsWidget({ ctx, handle }) {
  const { view, setView, hasDefaultModel } = ctx;
  return (
    <>
      <WidgetHead label="Settings" handle={handle} />
      <button
        type="button"
        className="side-settings"
        aria-current={view.kind === "notebook" ? "true" : undefined}
        onClick={() => setView({ kind: "notebook" })}
      >
        <Icon name="book" />
        Notebook
      </button>
      <button
        type="button"
        className="side-settings"
        aria-current={view.kind === "connectors" ? "true" : undefined}
        onClick={() => setView({ kind: "connectors" })}
      >
        <Icon name="plug" />
        Connectors
      </button>
      <button
        type="button"
        className="side-settings"
        aria-current={view.kind === "settings" ? "true" : undefined}
        onClick={() => setView({ kind: "settings" })}
      >
        <Icon name="gear" />
        Models
        {!hasDefaultModel ? <span className="dot" title="No default model yet" /> : null}
      </button>
    </>
  );
}
