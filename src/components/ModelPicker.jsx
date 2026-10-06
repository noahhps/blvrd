import { useEffect, useState } from "react";

import { hostOf, isLocalUrl } from "../lib/catalog.js";
import { modelsOf } from "../lib/models.js";

/* A server, then one of its models.
 *
 * Servers are the enabled ones, this computer's first. A server that will not
 * list its models (not running, no key, or a host without a list endpoint)
 * still takes a typed model name, so nothing blocks a reader who knows what
 * they want. `value` is { provider, model } or null; `allowDefault` adds a
 * "use the default" choice, for an agent that should follow Settings. */
export function ModelPicker({ providers, value, onChange, allowDefault = false, defaultLabel = "", compact = false }) {
  const enabled = providers.filter((p) => p.enabled);
  const current = value ? enabled.find((p) => p.id === value.provider) : null;
  const [list, setList] = useState({ models: [], error: null, loading: false });

  useEffect(() => {
    let live = true;
    if (!current) {
      setList({ models: [], error: null, loading: false });
      return undefined;
    }
    setList((was) => ({ ...was, loading: true }));
    modelsOf(current).then((result) => live && setList({ ...result, loading: false }));
    return () => {
      live = false;
    };
  }, [current?.id, current?.base, current?.key]);

  const pickProvider = (id) => {
    if (id === "") return onChange(null);
    onChange({ provider: id, model: "" });
  };

  const local = enabled.filter((p) => isLocalUrl(p.base));
  const hosted = enabled.filter((p) => !isLocalUrl(p.base));
  const typed = current && (list.error || (!list.loading && list.models.length === 0));

  return (
    <div className={compact ? "picker compact" : "picker"}>
      <select
        value={current ? current.id : ""}
        onChange={(e) => pickProvider(e.target.value)}
        aria-label="Server"
      >
        {allowDefault ? <option value="">{defaultLabel || "Use the default model"}</option> : <option value="">Choose a server…</option>}
        {local.length ? (
          <optgroup label="On this computer or network">
            {local.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        ) : null}
        {hosted.length ? (
          <optgroup label="Hosted -- sends your messages out">
            {hosted.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        ) : null}
      </select>

      {current ? (
        typed ? (
          <input
            type="text"
            value={value?.model || ""}
            placeholder="Model name, e.g. llama3.3"
            aria-label="Model"
            onChange={(e) => onChange({ provider: current.id, model: e.target.value })}
          />
        ) : (
          <select
            value={value?.model || ""}
            onChange={(e) => onChange({ provider: current.id, model: e.target.value })}
            aria-label="Model"
            disabled={list.loading}
          >
            <option value="">{list.loading ? "Asking for models…" : "Choose a model…"}</option>
            {list.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {value?.model && !list.models.includes(value.model) ? <option value={value.model}>{value.model}</option> : null}
          </select>
        )
      ) : null}

      {!compact && current && list.error ? (
        <p className="hint warn">{current.name} did not list its models ({list.error}). Type a model name, or check Settings.</p>
      ) : null}
      {!compact && current && !isLocalUrl(current.base) ? (
        <p className="hint">Messages to this agent go to {hostOf(current.base)}.</p>
      ) : null}
    </div>
  );
}
