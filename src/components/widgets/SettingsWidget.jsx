import { Icon } from "../Icon.jsx";
import { WidgetHead } from "./WidgetHead.jsx";

/* The way to what agents know about the user (the Notebook), what they were
 * asked to do later (Tasks), what they can reach, and the rest of Settings
 * -- models, how blvrd looks, the computer (⌘, too, App.jsx). */
export function SettingsWidget({ ctx, handle }) {
  const { view, setView, hasDefaultModel, scheduledCount = 0 } = ctx;
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
        aria-current={view.kind === "tasks" ? "true" : undefined}
        onClick={() => setView({ kind: "tasks" })}
      >
        <Icon name="clock" />
        Tasks
        {scheduledCount ? <span className="count" title={`${scheduledCount} waiting`}>{scheduledCount}</span> : null}
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
        aria-keyshortcuts="Meta+Comma"
        title="Settings (⌘,)"
        onClick={() => setView({ kind: "settings" })}
      >
        <Icon name="gear" />
        Settings
        {!hasDefaultModel ? <span className="dot" title="No default model yet" /> : null}
        <kbd>⌘,</kbd>
      </button>
    </>
  );
}
