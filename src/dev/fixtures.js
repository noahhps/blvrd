/* Dev only: data for stress-testing the sidebar's conversation list, chosen
 * with the Demo / Worst case / Empty / One / 300 rows switch (DataToggle.jsx).
 * Each fixture is the app's saved state (lib/store.js) with its agents,
 * groups and chats swapped; it is never saved over the real data.
 *
 * The worst case is what real people produce, not noise: long names with
 * diacritics and dashes, a two-letter name, a name in Chinese and one
 * starting with an emoji, file-only messages, code and markdown in previews,
 * a failed turn, a message from last year, and groups whose agents were
 * deleted down to one, or none. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let n = 0;
const id = (p) => `${p}_dev${++n}`;
const msg = (role, content, at, extra = {}) => ({ id: id("m"), role, content, at, ...extra });

export function worstCase(now = Date.now()) {
  const agents = [
    { id: "w_long", name: "Aleksandra Wiśniewska-Kowalczyk’s Research Assistant", instructions: "Reads what you point it at and says where each answer came from.", look: { colour: "blue", dots: 5 } },
    { id: "w_jo", name: "Jo", instructions: "", look: { colour: "green", dots: 3 } },
    { id: "w_cjk", name: "数据分析助手", instructions: "帮你分析表格和数据。", look: { colour: "orange", dots: 6 } },
    { id: "w_emoji", name: "🧪 Lab Notes", instructions: "Keeps a running log of experiments.", look: { colour: "violet", dots: 4 } },
    { id: "w_cs", name: "C# Code Reviewer", instructions: "Reviews C# and .NET code.", look: { colour: "ink", dots: 2 } },
    { id: "w_old", name: "Bartholomew Fitzgerald – Northwind Industries Holdings Procurement", instructions: "Drafts vendor emails.", look: { colour: "red", dots: 8 } },
    { id: "w_empty", name: "Planner", instructions: "Plans your week from your calendar.", look: { colour: "yellow", dots: 4 } },
    { id: "w_rtl", name: "مساعد البحث", instructions: "يقرأ المصادر ويلخصها.", look: { colour: "blue", dots: 3 } },
  ].map((a, i) => ({ tools: null, model: null, createdAt: now - (i + 30) * DAY, ...a }));

  const chats = {
    w_long: [
      msg("user", "Summarise the attached sales data", now - 3 * MIN),
      msg("assistant", "Here's the summary of `quarterly_revenue_by_region_v2.csv`: **Q3** grew 14% in EMEA, driven by the *north_east* accounts — see the table below.", now - 2 * MIN),
    ],
    // w_jo: never talked to, and no instructions.
    w_cjk: [
      msg("user", "", now - 40 * MIN, {
        files: [
          { name: "Screenshot 2026-10-06 at 14.32.07.png", kind: "image", dataUrl: "" },
          { name: "notes_from_call_with_bartholomew.md", kind: "text", text: "…" },
          { name: "Q3-board-deck-final-v12-APPROVED (1).csv", kind: "text", text: "…" },
        ],
      }),
    ],
    w_emoji: [msg("user", "Log today's run", now - 2 * HOUR), msg("assistant", "", now - 2 * HOUR, { failure: "Ollama isn't answering at http://localhost:11434." })],
    w_cs: [
      msg("user", "Arrays or lists?", now - 5 * HOUR),
      msg("assistant", "In C# use `List<T>` when the size changes; arrays are fixed > see the docs. ## Rule of thumb: 2 > 1.", now - 5 * HOUR),
    ],
    // From last year: the date alone reads like this year's.
    w_old: [msg("user", "Draft the renewal email", now - 368 * DAY), msg("assistant", "Done — it's in your drafts.", now - 368 * DAY)],
    // A turn that ended in tool calls and no words.
    w_empty: [
      msg("user", "What's on Thursday?", now - 26 * HOUR),
      msg("assistant", "", now - 26 * HOUR, { calls: [{ id: "c1", name: "calendar_events", args: {} }] }),
      msg("tool", "No events.", now - 26 * HOUR, { callId: "c1", name: "calendar_events" }),
      msg("assistant", "", now - 26 * HOUR),
    ],
    w_rtl: [msg("user", "What's 2+2?", now - 3 * DAY), msg("assistant", "2 + 2 = 4", now - 3 * DAY)],
  };

  const groups = [
    { id: "g_big", name: "Northwind Industries Holdings – Q4 Procurement & Vendor Review Committee", members: ["w_long", "w_jo", "w_cjk", "w_emoji", "w_cs", "w_old", "w_rtl"] },
    // Its other agents were deleted.
    { id: "g_one", name: "Research pair", members: ["w_jo"] },
    { id: "g_none", name: "Old team", members: [] },
    // The last word is from an agent that has since been deleted.
    { id: "g_ghost", name: "Launch", members: ["w_long", "w_jo"] },
  ].map((g, i) => ({ createdAt: now - (i + 10) * DAY, ...g }));

  chats.g_big = [
    msg("user", "Can everyone weigh in on the Contoso renewal?", now - 30 * MIN),
    msg("assistant", "Done — I've flagged the two clauses that changed.", now - 29 * MIN, { agentId: "w_long" }),
  ];
  chats.g_one = [msg("user", "Ping", now - 6 * DAY)];
  chats.g_ghost = [msg("assistant", "Shipping it Friday.", now - 4 * DAY, { agentId: "a_deleted" })];

  return { agents, groups, chats, notes: {} };
}

export function oneOfEach(now = Date.now()) {
  const agent = { id: "o_1", name: "Helper", instructions: "Answers quick questions.", tools: null, model: null, look: { colour: "blue", dots: 4 }, createdAt: now - DAY };
  return { agents: [agent], groups: [], chats: { o_1: [msg("user", "Hi", now - 2 * MIN), msg("assistant", "Hello!", now - MIN)] }, notes: {} };
}

export const empty = () => ({ agents: [], groups: [], chats: {}, notes: {} });

export function manyRows(now = Date.now(), count = 300) {
  const names = ["Researcher", "Planner", "Coder", "Writer", "Helper", "Translator", "Analyst", "Editor"];
  const colours = ["red", "orange", "yellow", "green", "blue", "violet", "ink"];
  const agents = [];
  const chats = {};
  for (let i = 0; i < count; i++) {
    const a = { id: `r_${i}`, name: `${names[i % names.length]} ${i + 1}`, instructions: "Helps with things.", tools: null, model: null, look: { colour: colours[i % colours.length], dots: 2 + (i % 11) }, createdAt: now - i * HOUR };
    agents.push(a);
    chats[a.id] = [msg("user", `Question ${i + 1}`, now - i * HOUR), msg("assistant", `Answer ${i + 1}, with a sentence long enough to be cut off at the end.`, now - i * HOUR)];
  }
  const groups = Array.from({ length: 40 }, (_, g) => ({ id: `rg_${g}`, name: `Team ${g + 1}`, members: agents.slice(g * 3, g * 3 + 4).map((a) => a.id), createdAt: now - g * DAY }));
  return { agents, groups, chats, notes: {} };
}

export const DATASETS = [
  { id: "demo", label: "Demo data", make: null },
  { id: "worst", label: "Worst case", make: worstCase },
  { id: "empty", label: "Empty", make: empty },
  { id: "one", label: "One", make: oneOfEach },
  { id: "many", label: "300 rows", make: manyRows },
];
