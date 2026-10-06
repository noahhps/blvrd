/* Home Assistant: the home's lights, climate, locks, covers, media and scenes,
 * through its REST API with a long-lived access token.
 *
 * Looking is free; doing asks first (unless the reader has said this home's
 * actions needn't), because "turn off the heating" said by a model reading a
 * web page is not the reader saying it. */

import { failure, httpFetch } from "../http.js";

const obj = (properties, required = []) => ({ type: "object", properties, required });
const trim = (base) => String(base || "").replace(/\/+$/, "");

export async function haApi(config, path, { method = "GET", body } = {}) {
  if (!config.url || !config.token) throw new Error("Home Assistant isn't set up. Add its address and a token under Connectors.");
  const response = await httpFetch(`${trim(config.url)}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw await failure(response, "Home Assistant");
  return response.json();
}

/** Entities matching words in their id or name, optionally in one domain. */
export function findEntities(states, { query = "", domain = "" } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return states
    .filter((s) => !domain || s.entity_id.startsWith(`${domain}.`))
    .filter((s) => {
      const hay = `${s.entity_id} ${s.attributes?.friendly_name || ""} ${s.attributes?.area || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
}

const line = (s) => {
  const a = s.attributes || {};
  const extra = [
    a.unit_of_measurement ? `${s.state} ${a.unit_of_measurement}` : null,
    a.brightness != null ? `brightness ${Math.round((a.brightness / 255) * 100)}%` : null,
    a.temperature != null ? `target ${a.temperature}` : null,
    a.current_temperature != null ? `now ${a.current_temperature}` : null,
  ].filter(Boolean);
  return `- ${s.entity_id} | ${a.friendly_name || ""} | ${a.unit_of_measurement ? extra.shift() : s.state}${extra.length ? ` | ${extra.join(", ")}` : ""}`;
};

export function homeAssistantTools(config) {
  return [
    {
      name: "home_find",
      label: "Home: find devices",
      description: "Find devices and sensors in the user's Home Assistant by words in their name (e.g. 'kitchen light', 'thermostat'), optionally one domain (light, switch, climate, lock, cover, media_player, scene, sensor). Returns entity ids and current states.",
      parameters: obj({ query: { type: "string" }, domain: { type: "string" } }),
      run: async (a) => {
        const found = findEntities(await haApi(config, "/states"), a);
        if (!found.length) return "Nothing matches.";
        return found.slice(0, 40).map(line).join("\n") + (found.length > 40 ? `\n(${found.length - 40} more; narrow the search)` : "");
      },
    },
    {
      name: "home_state",
      label: "Home: device state",
      description: "The full current state and attributes of one Home Assistant entity.",
      parameters: obj({ entity_id: { type: "string" } }, ["entity_id"]),
      run: async ({ entity_id }) => JSON.stringify(await haApi(config, `/states/${encodeURIComponent(entity_id)}`), null, 1).slice(0, 6000),
    },
    {
      name: "home_action",
      label: "Home: control a device",
      confirm: config.ask !== false,
      description: "Call a Home Assistant service on an entity: e.g. domain 'light', service 'turn_on', entity_id 'light.kitchen', data {\"brightness_pct\": 40}; 'climate'/'set_temperature' with {\"temperature\": 20}; 'scene'/'turn_on'; 'lock'/'lock'. Find the entity first with home_find.",
      parameters: obj(
        {
          domain: { type: "string" },
          service: { type: "string" },
          entity_id: { type: "string" },
          data: { type: "object", description: "Extra service data" },
        },
        ["domain", "service", "entity_id"],
      ),
      summary: (a) => `${a.domain}.${a.service} on ${a.entity_id}${a.data && Object.keys(a.data).length ? ` (${JSON.stringify(a.data)})` : ""}`,
      run: async ({ domain, service, entity_id, data }) => {
        if (!/^[a-z_]+$/.test(domain) || !/^[a-z_]+$/.test(service)) throw new Error("domain and service are lower-case words, like light and turn_on");
        const changed = await haApi(config, `/services/${domain}/${service}`, { method: "POST", body: { entity_id, ...(data || {}) } });
        return changed.length ? `Done. Now:\n${changed.map(line).join("\n")}` : "Done.";
      },
    },
  ];
}
