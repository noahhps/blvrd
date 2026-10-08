/* When a scheduled task runs (lib/schedule.js): the reader's own words in, a
 * rule out, and the next time that rule comes round.
 *
 * The model passes on what the user said -- "every weekday at 8", "in 20
 * minutes", "tomorrow at 9am" -- rather than a cron line or a date it worked
 * out, because small models copy words well and do date arithmetic badly. The
 * words are read here, by code, and the rule is described back in plain words
 * for the reader to confirm, so what they approve is what will happen.
 *
 * Rules are in local wall-clock time, and float with the Mac: 08:00 is 08:00
 * wherever it is.
 *
 *   { once: "2026-10-09T09:00" }
 *   { every: "minute" | "hour", n, from }            from: the first run
 *   { every: "day", n, at, from }                    from: a date, "2026-10-08"
 *   { every: "week", n, days: [1, 4], at, from }     days: 0 = Sunday
 *   { every: "month", n, day, at, from }             day 31 = the month's last
 *   { every: "year", month, day, at }                month: 1 = January
 *   + until: "2026-10-10T23:59" | times: 5 (counted by lib/schedule.js)
 */

export const MIN_EVERY_MINUTES = 5;
const DEFAULT_AT = "09:00";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60, other: 2 };
const NUMBER = `(?:\\d+|${Object.keys(NUMBERS).join("|")})`;
const numberOf = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBERS[word]);

const UNIT_WORDS = {
  minute: ["m", "min", "mins", "minute", "minutes"],
  hour: ["h", "hr", "hrs", "hour", "hours"],
  day: ["d", "day", "days"],
  week: ["w", "wk", "wks", "week", "weeks"],
  month: ["mo", "month", "months"],
  year: ["y", "yr", "yrs", "year", "years"],
};
const UNIT_OF = new Map(Object.entries(UNIT_WORDS).flatMap(([unit, words]) => words.map((w) => [w, unit])));
const UNIT = `(?:${[...UNIT_OF.keys()].sort((a, b) => b.length - a.length).join("|")})`;
const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

// "mon", "tues", "thurs", "fridays" -> the day's number.
const DAY_WORD = "(?:sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day)?s?|(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?";
const dayOf = (word) => WEEKDAYS.findIndex((d) => d.startsWith(word.replace(/s$/, "").slice(0, 3)));
const MONTH_WORD = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const monthOf = (word) => MONTHS.findIndex((m) => m.startsWith(word.slice(0, 3))) + 1;

// Words that carry no meaning of their own once everything else is read.
const FILLER = new Set(["at", "on", "the", "of", "every", "each", "next", "this", "coming", "and", "then", "please", "around", "about", "starting", "from", "now", "beginning", "in", "day", "month", "week", "same", "time", "o", "clock", "afterwards", "later", "after", "that", "once", "be", "do", "it", "to", "is"]);

// Times of day said in words.
const PARTS_OF_DAY = { morning: "09:00", noon: "12:00", midday: "12:00", afternoon: "15:00", evening: "18:00", night: "21:00", midnight: "00:00" };

export const EXAMPLES = [
  "in 20 minutes",
  "at 15:30",
  "tomorrow at 9am",
  "on 14 Oct at 18:00",
  "every day at 7",
  "every weekday at 8:00",
  "every Monday and Thursday at 9",
  "every 2 hours",
  "every month on the 1st at 9",
  "every hour until Friday",
];

/** What `parseWhen` says when it can't read the words. */
export class WhenError extends Error {}

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoMinute = (d) => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Days between two local midnights, whole, whatever the clocks did between.
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / UNIT_MS.day);
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate(); // m: 0-11

/** A local date and wall-clock time as a Date. A time the clocks skip that
 *  night (02:30 when they go forward) becomes the first minute after it. */
export function localTime(y, m, d, hh, mm) {
  const at = new Date(y, m, d, hh, mm);
  if (at.getHours() !== hh || at.getMinutes() !== mm) {
    if (at.getDate() === d) return new Date(y, m, d, hh + 1, 0);
  }
  return at;
}

const onDay = (day, at) => {
  const [hh, mm] = at.split(":").map(Number);
  return localTime(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm);
};

/** Read `text` as of `now`. Returns { rule, words, next }, or throws a
 *  WhenError that says what it couldn't read and how to say it. */
export function parseWhen(text, now = new Date()) {
  const said = String(text ?? "").trim();
  if (!said) throw problem(said, "it's empty");
  let s = ` ${normalize(said)} `;
  const f = { every: null, n: 1, days: null, weekday: null, date: null, monthDay: null, rel: 0, time: null, vague: false, dayWord: null, until: null, times: null };
  const take = (re, fn) => {
    s = s.replace(re, (...m) => (fn(...m) === false ? m[0] : " "));
  };

  // -- limits, read first so their dates aren't taken for the start --------------
  take(new RegExp(` (?:for )?(${NUMBER}) times `), (_, n) => {
    f.times = numberOf(n);
  });
  take(new RegExp(` for (${NUMBER}) (${UNIT}) `), (_, n, u) => {
    const unit = UNIT_OF.get(u);
    if (!["day", "week", "month"].includes(unit)) return false;
    const days = { day: 1, week: 7 }[unit];
    const end = days ? addDays(now, numberOf(n) * days) : new Date(now.getFullYear(), now.getMonth() + numberOf(n), now.getDate());
    f.until = onDay(end, "23:59");
  });
  take(/ (?:until|till|til|through|ending) (.+?) $/, (_, rest) => {
    const end = endOf(rest, now);
    if (!end) return false;
    f.until = end;
  });

  // -- dates written out ----------------------------------------------------------
  take(/ (\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))? /, (_, y, m, d, hh, mm) => {
    f.date = { y: +y, m: +m, d: +d };
    if (hh) f.time = `${pad(+hh)}:${mm}`;
  });

  // -- "in 20 minutes", "in an hour and a half" -----------------------------------
  take(new RegExp(` in ((?:(?:${NUMBER}|half an?|half|\\d+\\.\\d+) ?${UNIT}(?: and(?: a)?)? ?)+)(and a half )?`), (_, inner, half) => {
    let ms = 0;
    for (const m of inner.matchAll(new RegExp(`(${NUMBER}|half an?|half|\\d+\\.\\d+) ?(${UNIT})\\b`, "g"))) {
      const unit = UNIT_OF.get(m[2]);
      if (!UNIT_MS[unit]) return false;
      const n = /^half/.test(m[1]) ? 0.5 : /\./.test(m[1]) ? Number(m[1]) : numberOf(m[1]);
      ms += n * UNIT_MS[unit];
    }
    if (half) ms *= 1.5;
    if (!ms) return false;
    f.rel = ms;
  });

  // -- repeating ------------------------------------------------------------------
  // Weekdays first, so "every week day" isn't read as "every week".
  take(/ (?:every |each |on )?(?:week ?day|work ?day)s? /, () => {
    f.days = [1, 2, 3, 4, 5];
  });
  take(/ (?:every |each |on )?weekends? /, () => {
    f.days = [0, 6];
  });
  take(/ (?:every|each) half (?:an )?hour /, () => {
    f.every = "minute";
    f.n = 30;
  });
  take(new RegExp(` (?:every|each) (?:(${NUMBER}) )?(${UNIT}) `), (_, n, u) => {
    f.every = UNIT_OF.get(u);
    f.n = n ? numberOf(n) : 1;
  });
  take(/ (hourly|daily|nightly|weekly|fortnightly|monthly|yearly|annually) /, (_, word) => {
    f.every = { hourly: "hour", daily: "day", nightly: "day", weekly: "week", fortnightly: "week", monthly: "month", yearly: "year", annually: "year" }[word];
    if (word === "fortnightly") f.n = 2;
    if (word === "nightly") f.time ||= PARTS_OF_DAY.night;
  });
  take(new RegExp(` (every |each |on |next |this |coming )?((?:${DAY_WORD})(?:(?: and| or|,)? (?:${DAY_WORD}))*) `), (_, lead, list) => {
    const words = list.split(/ (?:and |or )?|,/).filter(Boolean);
    const days = [...new Set(words.map(dayOf))].filter((d) => d >= 0);
    if (!days.length) return false;
    const repeating = /every|each/.test(lead || "") || words.some((w) => /s$/.test(w) && !/^(tues|thurs|weds)$/.test(w)) || days.length > 1;
    if (repeating) f.days = days.sort((a, b) => a - b);
    else f.weekday = days[0];
  });
  take(/ (?:every|each) (morning|afternoon|evening|night) /, (_, part) => {
    f.every = "day";
    f.time ||= PARTS_OF_DAY[part];
  });

  // -- dates with a month name, and "the 1st" ---------------------------------------
  take(new RegExp(` (?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)? (${MONTH_WORD})(?: (\\d{4}))? `), (_, d, m, y) => {
    f.date = { y: y ? +y : null, m: monthOf(m), d: +d };
  });
  take(new RegExp(` (${MONTH_WORD}) (?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))? `), (_, m, d, y) => {
    f.date = { y: y ? +y : null, m: monthOf(m), d: +d };
  });
  take(/ (?:on )?the (\d{1,2})(?:st|nd|rd|th)(?: of (?:every|each|the) month)? /, (all, d) => {
    f.monthDay = +d;
    if (/of (every|each) month/.test(all)) f.every ||= "month";
  });
  take(/ (?:on )?(\d{1,2})(st|nd|rd|th) /, (_, d) => {
    f.monthDay = +d;
  });
  take(/ of (?:every|each) month /, () => {
    f.every ||= "month";
  });

  // -- days said in words -----------------------------------------------------------
  take(/ (?:the )?day after tomorrow /, () => {
    f.dayWord = 2;
  });
  take(/ (today|tonight|tomorrow|tmrw|tmr) /, (_, word) => {
    f.dayWord = word === "today" || word === "tonight" ? 0 : 1;
    if (word === "tonight") f.time ||= "20:00";
  });

  // -- times --------------------------------------------------------------------------
  const setTime = (hh, mm = 0, ampm = null) => {
    let h = +hh;
    const m = +mm;
    if (m > 59 || h > 24 || (ampm && (h < 1 || h > 12))) return false;
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h === 24) h = 0;
    f.time = `${pad(h)}:${pad(m)}`;
    f.vague = !ampm && !mm && h >= 1 && h <= 11 && String(hh).length === 1;
  };
  take(/ (?:at |by |around )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm) /, (_, hh, mm, ampm) => setTime(hh, mm || 0, ampm));
  take(/ (?:at |by |around )?(\d{1,2})[:.h](\d{2})h? /, (_, hh, mm) => {
    if (setTime(hh, mm) === false) return false;
    f.vague = false;
  });
  take(/ (?:at |by |around )?(noon|midday|midnight) /, (_, word) => {
    f.time = PARTS_OF_DAY[word];
  });
  take(/ (?:in the )?(morning|afternoon|evening|night) /, (_, part) => {
    f.time ||= PARTS_OF_DAY[part];
  });
  take(/ (?:at |by |around )(\d{1,2}) /, (_, hh) => setTime(hh));
  // A number left on its own, once everything else is read, is the hour.
  if (!f.time) take(/ (\d{1,2}) /, (_, hh) => setTime(hh));

  // -- anything left must mean nothing ----------------------------------------------
  const left = s.split(" ").filter((w) => w && !FILLER.has(w));
  if (left.length) throw problem(said, `I couldn't read "${left.join(" ")}"`);

  const rule = ruleOf(f, now, said);
  const next = nextAfter(rule, now);
  if (!next) throw problem(said, "that time has already passed");
  return { rule, words: describe(rule, now), next };
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/\ba\.?m\.?(?=\s|$)/g, "am")
    .replace(/\bp\.?m\.?(?=\s|$)/g, "pm")
    .replace(/(\d)(am|pm)\b/g, "$1 $2")
    .replace(/(\d)\s*(?=(?:mins?|minutes?|hrs?|hours?)\b)/g, "$1 ")
    .replace(/(\d+)h(\d+)m?\b/g, "$1 hours $2 minutes")
    .replace(/\b(an?|one|\d+) (minute|hour|day|week)s? and a half\b/g, (_, n, unit) => `${/^\d/.test(n) ? n : 1}.5 ${unit}s`)
    .replace(/\b(\d+) and a half (minute|hour|day|week)s?\b/g, "$1.5 $2s")
    .replace(/o ?clock/g, "")
    .replace(/[,;!?()]+/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/@/g, " at ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function problem(said, why) {
  return new WhenError(`couldn't read "${said}" as a time: ${why}. Say it like: ${EXAMPLES.map((e) => `"${e}"`).join(", ")}.`);
}

// The end of an "until …": the day named, at its last minute unless a time
// was said too.
function endOf(text, now) {
  try {
    const { rule } = parseWhen(text, now);
    if (!rule.once) return null;
    const end = new Date(rule.once);
    return /\d|noon|midnight|morning|evening|night/.test(text) && !/^(?:on )?(?:the )?\d{1,2}(?:st|nd|rd|th)?\b/.test(text.trim()) && /:|am|pm|noon|midnight|at /.test(text)
      ? end
      : onDay(end, "23:59");
  } catch {
    return null;
  }
}

/* The fields read, as a rule -- or a WhenError when they don't make one. */
function ruleOf(f, now, said) {
  const limits = {
    ...(f.until ? { until: isoMinute(f.until) } : {}),
    ...(f.times ? { times: f.times } : {}),
  };
  // A bare hour from 1 to 11: in a repeating rule 1-6 is afternoon, 7-11
  // morning ("every day at 5" is 17:00); once, whichever comes first.
  const hourFixed = (at) => {
    if (!f.vague || !at) return at;
    const h = Number(at.slice(0, 2));
    return h <= 6 ? `${pad(h + 12)}${at.slice(2)}` : at;
  };
  const today = startOfDay(now);

  if (f.days && !f.every) f.every = "week";
  if (f.every) {
    if (f.rel) throw problem(said, `"in …" and "every …" can't be said together`);
    const at = hourFixed(f.time) || DEFAULT_AT;
    if (f.every === "minute" || f.every === "hour") {
      const minutes = f.every === "minute" ? f.n : f.n * 60;
      if (minutes < MIN_EVERY_MINUTES) throw problem(said, `the most often a task can run is every ${MIN_EVERY_MINUTES} minutes`);
      // From the time said, or one interval from now.
      let from = new Date(Math.ceil((now.getTime() + minutes * 60_000) / 60_000) * 60_000);
      if (f.time) {
        from = onDay(today, hourFixed(f.time));
        if (from <= now) from = onDay(addDays(today, 1), hourFixed(f.time));
      }
      return { every: f.every, n: f.n, from: isoMinute(from), ...limits };
    }
    if (f.every === "day") return { every: "day", n: f.n, at, from: isoDate(today), ...limits };
    if (f.every === "week") {
      const days = f.days || [f.weekday ?? now.getDay()];
      return { every: "week", n: f.n, days, at, from: isoDate(addDays(today, -today.getDay())), ...limits };
    }
    if (f.every === "month") {
      const day = f.monthDay || f.date?.d || now.getDate();
      if (day < 1 || day > 31) throw problem(said, `there is no day ${day} in a month`);
      return { every: "month", n: f.n, day, at, from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), ...limits };
    }
    if (f.every === "year") {
      const month = f.date?.m || now.getMonth() + 1;
      const day = f.date?.d || f.monthDay || now.getDate();
      return { every: "year", month, day, at, ...limits };
    }
  }

  // -- once -----------------------------------------------------------------------
  if (f.times && f.times > 1) throw problem(said, `"${f.times} times" needs an "every …" to repeat on`);
  if (f.rel) {
    if (f.time || f.date || f.weekday != null || f.dayWord != null) throw problem(said, `"in …" can't also have a day or time`);
    const at = new Date(Math.ceil((now.getTime() + f.rel) / 60_000) * 60_000);
    return { once: isoMinute(at), ...limits };
  }
  let day = null;
  if (f.date) {
    const y = f.date.y ?? now.getFullYear();
    if (f.date.m < 1 || f.date.m > 12 || f.date.d < 1 || f.date.d > daysInMonth(y, f.date.m - 1)) throw problem(said, "there is no such date");
    day = new Date(y, f.date.m - 1, f.date.d);
    // No year, and gone this year: next year's.
    if (f.date.y == null && onDay(day, f.time || "23:59") <= now) day = new Date(y + 1, f.date.m - 1, f.date.d);
  } else if (f.monthDay) {
    // "on the 14th": the next 14th there is.
    for (let i = 0; i < 13 && !day; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      if (f.monthDay > daysInMonth(m.getFullYear(), m.getMonth())) continue;
      const d = new Date(m.getFullYear(), m.getMonth(), f.monthDay);
      if (onDay(d, f.time || DEFAULT_AT) > now) day = d;
    }
  } else if (f.weekday != null) {
    // "on Friday": today if it is Friday and the time is still to come.
    for (let i = 0; i < 8; i++) {
      const d = addDays(today, i);
      if (d.getDay() === f.weekday && onDay(d, hourFixed(f.time) || DEFAULT_AT) > now && (i > 0 || f.time)) {
        day = d;
        break;
      }
    }
  } else if (f.dayWord != null) {
    day = addDays(today, f.dayWord);
  }

  if (!f.time && !day) throw problem(said, "it says neither a day nor a time");
  let at;
  if (f.vague && f.time) {
    // "at 3": 03:00 or 15:00, whichever is next on the day meant.
    const h = Number(f.time.slice(0, 2));
    const options = [h, h + 12].map((hh) => onDay(day || today, `${pad(hh)}${f.time.slice(2)}`)).filter((d) => d > now);
    at = options[0] || (day ? null : onDay(addDays(today, 1), f.time));
  } else {
    at = onDay(day || today, f.time || DEFAULT_AT);
    // A time alone, already gone today: tomorrow's.
    if (!day && at <= now) at = onDay(addDays(today, 1), f.time);
  }
  if (!at || at <= now) throw problem(said, "that time has already passed");
  return { once: isoMinute(at), ...limits };
}

/** The first time `rule` comes round after `after`, or null if it never
 *  will again (a past one-off, or past its `until`). `times` is counted by
 *  the caller. */
export function nextAfter(rule, after = new Date()) {
  const next = firstAfter(rule, after);
  if (!next) return null;
  if (rule.until && next > new Date(rule.until)) return null;
  return next;
}

function firstAfter(rule, after) {
  if (rule.once) {
    const at = new Date(rule.once);
    return at > after ? at : null;
  }
  const n = Math.max(1, rule.n || 1);
  if (rule.every === "minute" || rule.every === "hour") {
    const from = new Date(rule.from);
    if (from > after) return from;
    const step = n * UNIT_MS[rule.every];
    return new Date(from.getTime() + (Math.floor((after - from) / step) + 1) * step);
  }
  const day0 = startOfDay(after);
  if (rule.every === "day") {
    const from = new Date(`${rule.from}T00:00`);
    for (let i = 0; i <= n + 1; i++) {
      const d = addDays(day0, i);
      const since = daysBetween(from, d);
      if (since < 0 || since % n) continue;
      const at = onDay(d, rule.at);
      if (at > after) return at;
    }
    return null;
  }
  if (rule.every === "week") {
    const from = new Date(`${rule.from}T00:00`); // a Sunday
    for (let i = 0; i <= 7 * n + 7; i++) {
      const d = addDays(day0, i);
      if (!rule.days.includes(d.getDay())) continue;
      const weeks = Math.floor(daysBetween(from, d) / 7);
      if (weeks < 0 || weeks % n) continue;
      const at = onDay(d, rule.at);
      if (at > after) return at;
    }
    return null;
  }
  if (rule.every === "month") {
    const from = new Date(`${rule.from}T00:00`);
    for (let i = 0; i <= 12 * n + 1; i++) {
      const m = new Date(after.getFullYear(), after.getMonth() + i, 1);
      const months = (m.getFullYear() - from.getFullYear()) * 12 + m.getMonth() - from.getMonth();
      if (months < 0 || months % n) continue;
      const day = Math.min(rule.day, daysInMonth(m.getFullYear(), m.getMonth()));
      const at = onDay(new Date(m.getFullYear(), m.getMonth(), day), rule.at);
      if (at > after) return at;
    }
    return null;
  }
  if (rule.every === "year") {
    for (let i = 0; i <= 8; i++) {
      const y = after.getFullYear() + i;
      // 29 February: the 28th in other years.
      const day = Math.min(rule.day, daysInMonth(y, rule.month - 1));
      const at = onDay(new Date(y, rule.month - 1, day), rule.at);
      if (at > after) return at;
    }
    return null;
  }
  return null;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const listOf = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A date as the reader would say it from `now`: "today", "tomorrow",
 *  "Thu 9 Oct", or with the year when it isn't this one. */
export function dayWords(d, now = new Date()) {
  const ahead = daysBetween(now, d);
  if (ahead === 0) return "today";
  if (ahead === 1) return "tomorrow";
  if (ahead === -1) return "yesterday";
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}${year}`;
}

/** A moment as words: "today at 21:14", "Thu 9 Oct at 09:00". */
export const momentWords = (d, now = new Date()) => `${dayWords(d, now)} at ${timeOf(d)}`;

/** The rule in plain words, as the reader is shown it. */
export function describe(rule, now = new Date()) {
  let words;
  const n = rule.n || 1;
  if (rule.once) words = momentWords(new Date(rule.once), now);
  else if (rule.every === "minute" || rule.every === "hour") {
    const unit = rule.every === "minute" ? (n === 30 ? "half hour" : "minutes") : "hours";
    words = n === 1 ? `every ${rule.every}` : unit === "half hour" ? "every half hour" : `every ${n} ${unit}`;
    const from = new Date(rule.from);
    if (from > now) words += `, from ${momentWords(from, now)}`;
  } else if (rule.every === "day") words = `${n === 1 ? "every day" : n === 2 ? "every other day" : `every ${n} days`} at ${rule.at}`;
  else if (rule.every === "week") {
    const days = rule.days.join(",");
    const which =
      days === "1,2,3,4,5" ? "weekday" : days === "0,6" ? "weekend day" : listOf([...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1)));
    const every = n === 1 ? "every" : n === 2 ? "every other week on" : `every ${n} weeks on`;
    words = `${every} ${which} at ${rule.at}`;
  } else if (rule.every === "month") {
    const day = rule.day >= 31 ? "the last day" : `the ${ordinal(rule.day)}`;
    words = `${n === 1 ? "every month" : n === 2 ? "every other month" : `every ${n} months`} on ${day} at ${rule.at}`;
  } else if (rule.every === "year") words = `every year on ${rule.day} ${SHORT_MONTHS[rule.month - 1]} at ${rule.at}`;
  else words = "never";
  if (rule.until) words += `, until ${momentWords(new Date(rule.until), now)}`;
  if (rule.times) words += `, ${rule.times === 1 ? "once" : `${rule.times} times`}`;
  return words;
}
