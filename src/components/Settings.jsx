import { Fragment, useState } from "react";

import { HOSTED_CLOSED, HOSTED_OPEN, hostOf, isLocalUrl } from "../lib/catalog.js";
import { forget, modelsOf } from "../lib/models.js";
import { findBase } from "../lib/serverBase.js";
import { COMPACT_CHOICES, DEFAULT_COMPACT_AT } from "../lib/compact.js";
import { FREE, PAID } from "../lib/search.js";
import { DEFAULT_SHORTCUT, shortcutFromKey, shortcutLabel } from "../lib/quick.js";
import { FONT_SLOTS, FONTS, stackOf } from "../lib/fonts.js";
import { THEMES } from "../lib/theme.js";
import { ICONS, ICON_LOOKS, figureOn, lookOf } from "../lib/appIcon.js";
import { Mascot } from "./Mascot.jsx";
import { Icon } from "./Icon.jsx";
import { ModelAccess } from "./ModelAccess.jsx";
import { SandboxCard } from "./SandboxCard.jsx";
import { BrowserCard } from "./BrowserCard.jsx";
import { ModelPicker } from "./ModelPicker.jsx";
import { FontPicker } from "./FontPicker.jsx";

/* Settings, in three tabs (⌘, opens it, App.jsx).
 *
 * General: how blvrd looks and the faces it's set in, its shortcut, long chats, web search.
 * Models: where the models come from. This computer first: every local
 * server the app knows, which it can look for on its own. Then hosted
 * servers -- those that serve open-weight models, then the closed APIs --
 * each off until it has a key, and each saying where your messages would go.
 * Then any other OpenAI-compatible server by URL.
 * Computer: the browser and the sandbox an agent's computer uses. */
const TABS = [
  { id: "general", label: "General" },
  { id: "models", label: "Models" },
  { id: "computer", label: "Computer" },
];
let lastTab = null; // the tab Settings was last left on, while the app runs

export function Settings({
  providers,
  defaultModel,
  onDefaultModel,
  onProvider,
  onAddCustom,
  onRemoveCustom,
  shortcut,
  shortcutProblem,
  onShortcut,
  compactAt,
  onCompactAt,
  search,
  onSearch,
  inUse = [],
  browser = null,
  onBrowser = () => {},
  theme = "system",
  onTheme = () => {},
  fonts = null,
  onFont = () => {},
  appIcon = null,
  dark = false,
  onAppIcon = () => {},
}) {
  // Without a default model, nothing runs yet: that comes first.
  const [tab, setTabState] = useState(() => lastTab || (defaultModel?.model ? "general" : "models"));
  const setTab = (next) => {
    lastTab = next;
    setTabState(next);
  };
  const [probe, setProbe] = useState({}); // id -> { state, count, error }
  const [probing, setProbing] = useState(false);

  const local = providers.filter((p) => !p.keys && !p.custom);
  const custom = providers.filter((p) => p.custom);
  const byId = new Map(providers.map((p) => [p.id, p]));

  const findLocal = async () => {
    setProbing(true);
    await Promise.all(
      local.map(async (p) => {
        setProbe((s) => ({ ...s, [p.id]: { state: "asking" } }));
        const { models, error } = await modelsOf(p, { fresh: true });
        setProbe((s) => ({
          ...s,
          [p.id]: error ? { state: "off", error } : { state: "on", count: models.length },
        }));
      }),
    );
    setProbing(false);
  };

  const status = (p) => {
    const s = probe[p.id];
    if (!s) return null;
    if (s.state === "asking") return <span className="status">looking…</span>;
    if (s.state === "on") return <span className="status on">running · {s.count} model{s.count === 1 ? "" : "s"}</span>;
    return <span className="status off">not running</span>;
  };

  return (
    <div className="settings">
      <header>
        <h1>Settings</h1>
      </header>
      <Tabs tab={tab} onTab={setTab} attention={defaultModel?.model ? null : "models"} />

      {tab === "general" ? (
        <div className="settings-panel" role="tabpanel" id="settings-general" aria-labelledby="settings-tab-general">
          <AppearanceCard theme={theme} onTheme={onTheme} />
          {appIcon ? <AppIconCard icon={appIcon} dark={dark} onChange={onAppIcon} /> : null}
          {fonts ? <FontsCard fonts={fonts} onFont={onFont} /> : null}
          <QuickviewCard shortcut={shortcut} problem={shortcutProblem} onShortcut={onShortcut} />
          <section className="card">
            <h2>Long chats</h2>
            <p className="hint">
              When a chat grows past this — or nears what the agent’s model can take, if that comes first — its older
              messages are summarized by the agent’s model and only the summary and the recent part are sent. The chat still shows everything. You can also compact one any time:
              right-click it in the sidebar.
            </p>
            <select
              className="compact-at"
              value={compactAt === null ? "off" : String(compactAt)}
              onChange={(e) => onCompactAt(e.target.value === "off" ? null : Number(e.target.value))}
              aria-label="Compact chats after"
            >
              {COMPACT_CHOICES.map((n) => (
                <option key={n} value={n}>
                  After about {n / 1000}k tokens{n === DEFAULT_COMPACT_AT ? " (default)" : ""}
                </option>
              ))}
              <option value="off">Never</option>
            </select>
          </section>

          <SearchCard search={search} onSearch={onSearch} />
        </div>
      ) : tab === "models" ? (
        <div className="settings-panel" role="tabpanel" id="settings-models" aria-labelledby="settings-tab-models">
          <p className="settings-lede">
            blvrd talks to model servers directly. Local ones keep everything on your machine; hosted ones are sent
            each message you write to an agent that uses them.
          </p>
          <section className="card">
            <h2>Default model</h2>
            <p className="hint">What an agent runs on unless you give it a model of its own.</p>
            <ModelPicker providers={providers} value={defaultModel} onChange={onDefaultModel} />
          </section>

          <ModelAccess inUse={inUse} />
          <section className="card">
            <div className="card-head">
              <h2>On this computer</h2>
              <button type="button" className="btn" onClick={findLocal} disabled={probing}>
                <Icon name="search" />
                {probing ? "Looking…" : "Find local servers"}
              </button>
            </div>
            <p className="hint">
              Open-source servers that run models on your own hardware. Start one, then look for it here.
              Change an address if yours runs elsewhere — another machine on your network counts as local.
            </p>
            <ul className="servers">
              {local.map((p) => (
                <li key={p.id} className="server">
                  <label className="switch" title={p.enabled ? "On" : "Off"}>
                    <input type="checkbox" checked={p.enabled} onChange={(e) => onProvider(p.id, { enabled: e.target.checked })} />
                    <span />
                  </label>
                  <span className="server-main">
                    <span className="server-top">
                      <span className="server-name">{p.name}</span>
                      {status(p)}
                    </span>
                    <span className="server-note">{withCode(p.note)}</span>
                  </span>
                  <span className="server-fields">
                    <input
                      className="server-url"
                      type="text"
                      value={p.base}
                      aria-label={`${p.name} address`}
                      spellCheck={false}
                      onChange={(e) => {
                        forget(p);
                        onProvider(p.id, { base: e.target.value });
                      }}
                    />
                    {p.localKey ? (
                      <input
                        className="server-url"
                        type="password"
                        value={p.key}
                        placeholder="API key"
                        aria-label={`${p.name} API key`}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => {
                          forget(p);
                          onProvider(p.id, { key: e.target.value.trim() });
                        }}
                      />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <HostedList
            title="Hosted open models"
            hint="The same open-weight models — Llama, Qwen, DeepSeek, Mistral, Gemma — on someone else's GPUs. Useful when a model is too big for this machine."
            entries={HOSTED_OPEN}
            byId={byId}
            onProvider={onProvider}
          />
          <HostedList title="Closed APIs" hint="Proprietary models, reached with your own key." entries={HOSTED_CLOSED} byId={byId} onProvider={onProvider} />

          <section className="card">
            <h2>Another server</h2>
            <p className="hint">Anything that speaks the OpenAI-compatible chat API: a server on another machine, LiteLLM, a company gateway.</p>
            {custom.length ? (
              <ul className="servers">
                {custom.map((p) => (
                  <li key={p.id} className="server">
                    <label className="switch">
                      <input type="checkbox" checked={p.enabled} onChange={(e) => onProvider(p.id, { enabled: e.target.checked })} />
                      <span />
                    </label>
                    <span className="server-main">
                      <span className="server-top">
                        <span className="server-name">{p.name}</span>
                        <span className={`status ${isLocalUrl(p.base) ? "on" : ""}`}>{isLocalUrl(p.base) ? "local" : hostOf(p.base)}</span>
                      </span>
                      <span className="server-note">{p.base}</span>
                    </span>
                    <button type="button" className="btn icon-only" aria-label={`Remove ${p.name}`} onClick={() => onRemoveCustom(p.id)}>
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <AddServer onAdd={onAddCustom} />
          </section>
        </div>
      ) : (
        <div className="settings-panel" role="tabpanel" id="settings-computer" aria-labelledby="settings-tab-computer">
          <p className="settings-lede">What an agent’s computer works with, when you turn one on for a chat.</p>
          <BrowserCard browser={browser} onBrowser={onBrowser} />
          <SandboxCard />
        </div>
      )}

      <p className="fineprint">
        Agents, chats, notes and keys are stored on this computer only, in the app's own storage. Keys are kept in
        plain text there, so anyone with access to your user account could read them.
      </p>
    </div>
  );
}

/* The three tabs. Switching is instant: it happens many times, and the page
 * under it changes completely anyway. Arrow keys move between them. */
function Tabs({ tab, onTab, attention }) {
  const onKeyDown = (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id;
    onTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };
  return (
    <div className="settings-tabs-bar">
      <div className="settings-tabs" role="tablist" aria-label="Settings" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`settings-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
          >
            {t.label}
            {attention === t.id ? <span className="dot" title="No default model yet" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Light, dark, or the Mac's own setting -- each a small picture of the app
 * in that look, as macOS shows its own. */
function AppearanceCard({ theme, onTheme }) {
  return (
    <section className="card">
      <h2>Appearance</h2>
      <p className="hint">System follows your Mac, and changes with it.</p>
      <div className="theme-choices" role="radiogroup" aria-label="Appearance">
        {THEMES.map((t) => (
          <label key={t.id} className="theme-choice">
            <input type="radio" name="theme" value={t.id} checked={theme === t.id} onChange={() => onTheme(t.id)} />
            <span className="theme-thumb" data-look={t.id} aria-hidden="true">
              <ThumbLook look={t.id === "dark" ? "dark" : "light"} />
              {t.id === "system" ? <ThumbLook look="dark" half /> : null}
            </span>
            <span className="theme-label">{t.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

/* The Dock's icon: blvrd's wordmark with a character peeking up from the
 * bottom edge -- each drawn here the way the icon is (src-tauri/icons/
 * variants.mjs), in the look picked: light, dark, or whichever the app is. */
function AppIconCard({ icon, dark, onChange }) {
  const look = lookOf(icon, dark);
  return (
    <section className="card">
      <div className="card-head">
        <h2>App icon</h2>
        <div className="icon-looks" role="radiogroup" aria-label="Icon look">
          {ICON_LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={icon.look === l.id} onClick={() => onChange({ look: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">The Dock shows it while blvrd is open. Match follows the app’s light or dark look.</p>
      <div className="icon-choices" role="radiogroup" aria-label="App icon">
        {ICONS.map((i) => (
          <label key={i.id} className="icon-choice" title={i.label}>
            <input type="radio" name="app-icon" value={i.id} checked={icon.mascot === i.id} onChange={() => onChange({ mascot: i.id })} />
            <span className="icon-tile" data-look={look} data-mascot={i.id} aria-hidden="true">
              <span className="icon-word">Blvrd</span>
              <Figure id={i.id} colour={typeof i.colour === "object" ? i.colour[look] : i.colour} />
            </span>
            <span className="icon-label">{i.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

const TILE = 64;
const Figure = ({ id, colour }) => {
  const { size, top, shift } = figureOn(id, TILE);
  return (
    <span className="icon-figure" style={{ top, width: size, marginLeft: -size / 2 + shift }}>
      <Mascot shape={id} colour={colour} size={size} alive={false} />
    </span>
  );
};

/* The app's face, and the Notebook's three, over a small picture of the app
 * set in them: the sidebar, and a page with a section, a widget and words
 * written on it. A font pointed at in a menu shows there before it's picked. */
function FontsCard({ fonts, onFont }) {
  const [preview, setPreview] = useState(null); // { slot, id } while a menu is open
  const shown = preview ? { ...fonts, [preview.slot]: preview.id } : fonts;
  const face = (slot) => ({ fontFamily: stackOf(shown, slot) });
  const optionsFor = (slot) => [
    ...(slot.id === "app"
      ? []
      : [{ id: "app", label: "Same as the app", stack: stackOf(fonts, "app"), note: slot.fallback === "app" ? "Default" : null }]),
    ...FONTS.map((f) => ({ ...f, note: f.id === slot.fallback ? "Default" : null })),
  ];
  return (
    <section className="card">
      <h2>Fonts</h2>
      <p className="hint">Conversations keep their own face.</p>
      <div className="font-preview" data-slot={preview?.slot} aria-hidden="true">
        <div className="font-preview-side" data-part="app" style={face("app")}>
          <span className="font-preview-dots" />
          <span className="font-preview-label">Agents</span>
          <span className="font-preview-row">Researcher</span>
          <span className="font-preview-row">Writer</span>
          <span className="font-preview-label">Settings</span>
          <span className="font-preview-row" data-on="">
            Notebook
          </span>
          <span className="font-preview-row">Tasks</span>
        </div>
        <div className="font-preview-page">
          <div className="font-preview-block">
            <span className="font-preview-title" data-part="sections" style={face("sections")}>
              Gift ideas
            </span>
            <span className="font-preview-widget" data-part="widgets" style={face("widgets")}>
              <span className="font-preview-item">
                <span className="font-preview-box" />A good fountain pen
              </span>
              <span className="font-preview-item" data-done="">
                <span className="font-preview-box" />
                Wireless headphones
              </span>
            </span>
          </div>
          <div className="font-preview-block">
            <span className="font-preview-title" data-part="sections" style={face("sections")}>
              About me
            </span>
            <span className="font-preview-widget" data-part="widgets" style={face("widgets")}>
              <span className="font-preview-fact">
                <span>Birthday</span>March 4
              </span>
              <span className="font-preview-fact">
                <span>Coffee</span>Oat flat white
              </span>
            </span>
          </div>
          <p className="font-preview-text" data-part="text" style={face("text")}>
            Likes quiet mornings, long walks, and books with maps.
          </p>
        </div>
      </div>
      <div className="font-rows">
        {FONT_SLOTS.map((slot) => (
          <Fragment key={slot.id}>
            {slot.id === "text" ? <p className="font-rows-group">Notebook</p> : null}
            <div className="font-row">
              <span className="font-row-label">
                {slot.short}
                <span className="font-row-hint">{slot.hint}</span>
              </span>
              <FontPicker
                id={`font-${slot.id}`}
                label={slot.label}
                value={fonts[slot.id]}
                options={optionsFor(slot)}
                onChange={(id) => onFont(slot.id, id)}
                onPreview={(id) => setPreview(id ? { slot: slot.id, id } : null)}
              />
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

const ThumbLook = ({ look, half = false }) => (
  <span className="thumb" data-look={look} data-half={half ? "" : undefined}>
    <span className="thumb-side">
      <span className="thumb-dot" />
      <span className="thumb-line" />
      <span className="thumb-line short" />
    </span>
    <span className="thumb-main">
      <span className="thumb-line" />
      <span className="thumb-line short" />
      <span className="thumb-box" />
    </span>
  </span>
);

/* Where an agent's web searches go. The free tier needs nothing; a provider
 * of the reader's own takes a key (or, for SearXNG, an address) and is asked
 * first. */
function SearchCard({ search, onSearch }) {
  const id = search.provider;
  const paid = PAID[id];
  const free = Object.values(FREE).map((v) => v.name).join(", ");
  return (
    <section className="card">
      <h2>Web search</h2>
      <p className="hint">
        What an agent’s “Search the web” ability uses. Only the search itself is sent, never your chat.
      </p>
      <div className="search-fields">
        <select value={id} onChange={(e) => onSearch({ provider: e.target.value })} aria-label="Search provider">
          <option value="free">Free, no key ({free} in turn)</option>
          {Object.entries(PAID).map(([key, p]) => (
            <option key={key} value={key}>
              {p.name}
              {key === "searxng" ? " (your own server)" : " (your key)"}
            </option>
          ))}
        </select>
        {id === "searxng" ? (
          <input
            type="text"
            value={search.searxng}
            placeholder="http://127.0.0.1:8080"
            aria-label="SearXNG address"
            spellCheck={false}
            onChange={(e) => onSearch({ searxng: e.target.value.trim() })}
          />
        ) : paid ? (
          <input
            type="password"
            value={search.keys[id] || ""}
            placeholder={`${paid.name} API key`}
            aria-label={`${paid.name} API key`}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onSearch({ keys: { ...search.keys, [id]: e.target.value.trim() } })}
          />
        ) : null}
      </div>
      {id === "free" ? (
        <p className="hint">
          Each search goes to the next of these services’ free tiers, and to the one after if it’s busy. Fine for
          everyday use; a key of your own is steadier.
        </p>
      ) : id === "searxng" ? (
        <p className="hint">Your SearXNG needs the JSON format turned on (search.formats in its settings.yml).</p>
      ) : (
        <p className="hint">
          <a href={paid.keys} target="_blank" rel="noreferrer">
            Get a {paid.name} key
          </a>
          . Searches go to {paid.name}.
        </p>
      )}
      {paid ? (
        <label className="check search-fallback">
          <input type="checkbox" checked={search.fallback} onChange={(e) => onSearch({ fallback: e.target.checked })} />
          When {paid.name} fails, use the free services instead
        </label>
      ) : null}
    </section>
  );
}

/* The quickview's shortcut: press "Change", then the keys you want. */
function QuickviewCard({ shortcut, problem, onShortcut }) {
  const [recording, setRecording] = useState(false);
  const onKey = (e) => {
    e.preventDefault();
    if (e.key === "Escape") return setRecording(false);
    const next = shortcutFromKey(e);
    if (!next) return;
    setRecording(false);
    onShortcut(next);
  };
  return (
    <section className="card">
      <h2>Quickview</h2>
      <p className="hint">
        A box that comes up over any app. Type @ to pick an agent, write to it, and press Enter: blvrd opens on
        that chat with your message sent.
      </p>
      <div className="shortcut-row">
        <button
          type="button"
          className={`btn shortcut${recording ? " recording" : ""}`}
          onClick={() => setRecording(true)}
          onKeyDown={recording ? onKey : undefined}
          onBlur={() => setRecording(false)}
          aria-label={recording ? "Press the keys for the shortcut" : `Shortcut: ${shortcutLabel(shortcut)}. Change it`}
        >
          {recording ? "Press keys…" : <kbd>{shortcutLabel(shortcut)}</kbd>}
        </button>
        {shortcut !== DEFAULT_SHORTCUT ? (
          <button type="button" className="btn" onClick={() => onShortcut(DEFAULT_SHORTCUT)}>
            Use {shortcutLabel(DEFAULT_SHORTCUT)}
          </button>
        ) : null}
        {shortcut ? (
          <button type="button" className="btn" onClick={() => onShortcut(null)}>
            Turn off
          </button>
        ) : null}
      </div>
      {problem ? (
        <p className="hint warn">
          Couldn’t take {shortcutLabel(shortcut)}: another app may have it. Pick another. ({problem})
        </p>
      ) : (
        <p className="hint">
          {recording ? "Hold modifiers and press a key. Esc to cancel." : "Any keys with ⌘, ⌥, ⌃ or ⇧, or an F-key. fn can’t be used: macOS keeps it."}
        </p>
      )}
    </section>
  );
}

function HostedList({ title, hint, entries, byId, onProvider }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      <ul className="servers">
        {entries.map((entry) => {
          const p = byId.get(entry.id);
          return (
            <li key={entry.id} className="server">
              <label className="switch" title={p.key ? "" : "Add a key to turn it on"}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  disabled={!p.key}
                  onChange={(e) => onProvider(p.id, { enabled: e.target.checked })}
                />
                <span />
              </label>
              <span className="server-main">
                <span className="server-top">
                  <span className="server-name">{p.name}</span>
                  <span className="status">sends to {hostOf(p.base)}</span>
                </span>
                <a className="server-note" href={entry.keys} target="_blank" rel="noreferrer">
                  Get a key
                </a>
              </span>
              <input
                className="server-url"
                type="password"
                value={p.key}
                placeholder="API key"
                aria-label={`${p.name} API key`}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  forget(p);
                  const key = e.target.value.trim();
                  onProvider(p.id, { key, enabled: Boolean(key) });
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddServer({ onAdd }) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Added only where it answers (lib/serverBase.js): http or https, with or
  // without /v1, whichever the server actually serves.
  const add = async (e) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError("");
    const found = await findBase(base, key.trim());
    setChecking(false);
    if (found.problem) return setError(found.problem);
    onAdd({ name: name.trim() || new URL(found.base).host, base: found.base, key: key.trim() });
    setName("");
    setBase("");
    setKey("");
  };

  return (
    <form className="add-server" onSubmit={add}>
      <input type="text" value={name} placeholder="Name" aria-label="Name" onChange={(e) => setName(e.target.value)} />
      <input type="text" value={base} placeholder="192.168.1.20:8080" aria-label="Address" spellCheck={false} onChange={(e) => setBase(e.target.value)} />
      <input type="password" value={key} placeholder="Key (if it needs one)" aria-label="Key" autoComplete="off" onChange={(e) => setKey(e.target.value)} />
      <button type="submit" className="btn" disabled={!base.trim() || checking}>
        <Icon name="plus" />
        {checking ? "Checking…" : "Add"}
      </button>
      {error ? <p className="error-line">{error}</p> : null}
    </form>
  );
}

/* `text in backticks` as code, the rest as it is. */
function withCode(text) {
  return String(text || "")
    .split(/(`[^`]+`)/)
    .map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part));
}
