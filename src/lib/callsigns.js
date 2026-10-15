/* Callsigns: what agents are called while one of the Marathon looks is on
 * (styles/hazard.css). Each look is a faction, and each faction names its
 * agents the way its own AI is named -- Gaius, Vulcan, Gantry, Charter, Nona,
 * ONI, and the UESC's Durandal and Tycho before them. Only the name shown
 * changes -- the agent keeps its own name for @mentions, the editor and its
 * instructions.
 *
 * The ready-made agents (lib/presets.js) are matched by name; any other agent
 * draws one of the faction's spare callsigns, with a two-digit tag so two of
 * them rarely collide. */

import { useSyncExternalStore } from "react";

const ROLES = [
  "researcher", "coder", "writer", "planner", "analyst", "designer", "organizer", "tutor",
  // The specialists (lib/presets.js).
  "tagger", "fixer", "translator", "summarizer", "extractor", "commit scribe", "regex smith", "titler",
  "indexer", "ranker", "transcriber", "spotter",
];

// Per faction: a callsign for each ready-made role, in ROLES order, then
// spares. Each faction names its agents the way its own AI is named.
export const FACTIONS = {
  // The UESC's ship AIs were Durandal (Roland's sword) and Tycho (Tycho
  // Brahe): legendary blades and astronomers -- and Roland's horn, and
  // Charlemagne's teacher. The specialists: Annie Cannon, who sorted the
  // stars; the blunted sword of mercy; Hypatia; Ptolemy's compendium;
  // Messier's catalogue; Turpin, Roland's chronicler; Wayland the smith;
  // Bayer, who named the stars. The System 1 units: Flamsteed's star
  // catalogue, Pickering's ranked plates, Olivier (Roland's companion, who
  // heard the horn), and Tombaugh, who spotted Pluto.
  hazard: {
    roles: ["KEPLER", "HAUTECLAIRE", "OLIPHANT", "HALLEY", "LEAVITT", "JOYEUSE", "HERSCHEL", "ALCUIN",
      "CANNON", "CURTANA", "HYPATIA", "PTOLEMY", "MESSIER", "TURPIN", "WAYLAND", "BAYER",
      "FLAMSTEED", "PICKERING", "OLIVIER", "TOMBAUGH"],
    spares: ["TIZONA", "COLADA", "HUBBLE", "GALILEO"],
  },
  // CyberAcme's is ONI, Onboard Navigational Intelligence: a system
  // acronym. Archival Retrieval, Kernel Assembly, Language Expression,
  // Operations Planning, Analytical eXamination, Image Rendering, Ordered
  // Records, Educational Directive; then Tagging, Revision, Language
  // eXchange, Summarization, EXtraction, Version Control, Pattern Matching,
  // Naming; EMbedding, RAnking, Speech Recognition, Object Detection --
  // each an Intelligence.
  cyberacme: {
    roles: ["ARI", "KAI", "LEXI", "OPI", "AXI", "IRI", "ORI", "EDI",
      "TAI", "REI", "LXI", "SUMI", "EXI", "VCI", "PMI", "NAI",
      "EMI", "RAI", "SRI", "ODI"],
    spares: ["UNI", "AMI", "ELI", "ZOI"],
  },
  // NuCaloric's is Gaius: a plain Roman name. Romans who wrote on the land
  // and on doing things well -- Pliny's natural history, Frontinus's
  // aqueducts, Virgil's Georgics, Columella's estates, Varro's tallies,
  // Vitruvius's buildings, Cato's farm manual, Quintilian's schooling; and
  // for the specialists Festus's dictionary, Priscian's grammar, Cicero the
  // translator, Eutropius's short history, Gellius's notebooks, Tiro's
  // shorthand, a faber (a smith), and Titus for the titler; Verrius's
  // lexicon, Censorinus, Asconius who wrote down Cicero's speeches, and
  // Agrippa who mapped the world.
  nucaloric: {
    roles: ["PLINY", "FRONTINUS", "VIRGIL", "COLUMELLA", "VARRO", "VITRUVIUS", "CATO", "QUINTILIAN",
      "FESTUS", "PRISCIAN", "CICERO", "EUTROPIUS", "GELLIUS", "TIRO", "FABER", "TITUS",
      "VERRIUS", "CENSORINUS", "ASCONIUS", "AGRIPPA"],
    spares: ["SEXTUS", "GNAEUS", "MARCUS", "DECIMUS"],
  },
  // Traxus's is Vulcan: the god of the forge. The pantheon of craft and
  // commerce -- wisdom, the inventor, the messenger, the god of beginnings,
  // the mint, the woman Vulcan made, the god of boundary stones, the tutor;
  // then order, healing, the rainbow messenger, the god of silence, wealth
  // dug up, the muse of record, Vulcan's thunder-smith, and fame; memory,
  // justice with her scales, Echo, and hundred-eyed Argus.
  traxus: {
    roles: ["MINERVA", "DAEDALUS", "MERCURY", "JANUS", "MONETA", "PANDORA", "TERMINUS", "CHIRON",
      "THEMIS", "ASCLEPIUS", "IRIS", "HARPOCRATES", "PLUTUS", "CLIO", "BRONTES", "FAMA",
      "MNEMOSYNE", "JUSTITIA", "ECHO", "ARGUS"],
    spares: ["TALOS", "AETNA", "CACUS", "STEROPES"],
  },
  // MIDA's is Gantry: a piece of hard industry. The machine shop and the
  // print shop of an insurgency -- down to the label punch, the grinder,
  // the relay, the compressor, the drill, the ticker tape, the jig, and the
  // placard; and the sorter, the sieve, the wiretap and the searchlight.
  mida: {
    roles: ["PERISCOPE", "LATHE", "PRESS", "SCAFFOLD", "GAUGE", "STENCIL", "DEPOT", "BULLHORN",
      "PUNCH", "GRINDER", "RELAY", "COMPRESSOR", "DRILL", "TICKER", "JIG", "PLACARD",
      "SORTER", "SIEVE", "WIRETAP", "SEARCHLIGHT"],
    spares: ["GIRDER", "RIVET", "CRANE", "PYLON"],
  },
  // Arachne's is Charter: a founding document. The cult's paperwork --
  // its books, laws, oaths, seals and rolls; its index, errata, vulgate,
  // breviary, book of excerpts, chronicle, formulary, and the rubrics in
  // red; its concordance, ordinal, transcripts and inventory.
  arachne: {
    roles: ["CODEX", "CANON", "TESTAMENT", "COVENANT", "TALLY", "SIGIL", "ROLL", "CATECHISM",
      "INDEX", "ERRATA", "VULGATE", "BREVIARY", "FLORILEGIUM", "CHRONICLE", "FORMULARY", "RUBRIC",
      "CONCORDANCE", "ORDINAL", "TRANSCRIPT", "INVENTORY"],
    spares: ["WRIT", "EDICT", "DECREE", "VERDICT"],
  },
  // Sekiguchi's is Nona: the Fate who spins the thread of life, whose name
  // means "ninth". Her sisters in the line -- first to eighth -- and, past
  // her, Decima and Morta, the other two Fates. The specialists are the
  // Fates of the Greeks and the Norns: who allots, who spins, who is
  // becoming, who cuts short, what shall be, what was, Necessity, and Parca;
  // wyrd, Fortuna, Moira and Nemesis.
  sekiguchi: {
    roles: ["PRIMA", "SECUNDA", "TERTIA", "QUARTA", "QUINTA", "SEXTA", "SEPTIMA", "OCTAVIA",
      "LACHESIS", "CLOTHO", "VERDANDI", "ATROPOS", "SKULD", "URD", "ANANKE", "PARCA",
      "WYRD", "FORTUNA", "MOIRA", "NEMESIS"],
    spares: ["DECIMA", "MORTA", "UNDECIMA", "DUODECIMA"],
  },
};

function hashed(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** The name to show for an agent called `name` under `theme`. */
export function callsignOf(name, theme) {
  const faction = FACTIONS[theme];
  if (!faction || !name) return name;
  const role = ROLES.indexOf(String(name).trim().toLowerCase());
  if (role >= 0) return faction.roles[role];
  const h = hashed(name);
  return `${faction.spares[h % faction.spares.length]}-${String((h >>> 8) % 100).padStart(2, "0")}`;
}

// The look in force, from html data-theme (lib/theme.js), as it changes.
const themeNow = () => (typeof document === "undefined" ? "system" : document.documentElement.dataset.theme || "system");
function onTheme(change) {
  if (typeof MutationObserver !== "function") return () => {};
  const watch = new MutationObserver(change);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watch.disconnect();
}

/** A function from an agent's name to the name to show for it right now. */
export function useCallsign() {
  const theme = useSyncExternalStore(onTheme, themeNow, () => "system");
  return (name) => callsignOf(name, theme);
}
