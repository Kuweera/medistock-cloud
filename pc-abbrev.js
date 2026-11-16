/* MediStock Cloud — medical abbreviation dictionary (Developer 2).
   Pure functions, no database access. Used by the visit workspace (treatment orders) and anywhere else an abbreviation is shown.

   RULES THIS FILE FOLLOWS
   - An abbreviation is only a SHORTCUT for a schedule pattern. It never supplies, changes or implies a dose.
   - The meaning is always shown next to the abbreviation (PCAB.label).
   - Abbreviations that are easy to misread are flagged (OD can mean "right eye"; QD / QOD / HS / U are on the do-not-use lists of
     safety bodies). Unsafe ones are NOT accepted as shortcuts; the screen tells the clinician what to write instead.
   - Nothing here is clinical knowledge about a medicine: it is a language dictionary.

   PCAB.lookup("bd")              -> entry or null
   PCAB.label("BD")               -> "BD (twice daily)"
   PCAB.find("1 tab TDS PO")      -> [{ abbr:"TDS", entry }, { abbr:"PO", entry }]   (what to explain under free text)
   PCAB.scheduleFor("q8h")        -> { scheduleType:"interval", everyHours:8 }       (a pattern to pre-fill; the clinician still completes and confirms it)
   PCAB.expandText("give BD")     -> "give BD (twice daily)" */
(function (root) {
  // kind: frequency | route | timing | form | unsafe
  var E = [
    // ---- how often
    { a: "OD", m: "once daily", k: "frequency", s: { scheduleType: "daily", timesPerDay: 1 }, note: "OD can also mean “right eye” (eye medicines). Check the route before relying on it." },
    { a: "BD", m: "twice daily", k: "frequency", s: { scheduleType: "daily", timesPerDay: 2 }, alt: ["BID", "B.D."] },
    { a: "TDS", m: "three times daily", k: "frequency", s: { scheduleType: "daily", timesPerDay: 3 }, alt: ["TID", "T.D.S."] },
    { a: "QID", m: "four times daily", k: "frequency", s: { scheduleType: "daily", timesPerDay: 4 }, alt: ["QDS", "Q.I.D."], note: "QID looks like QD (see the warning on QD). Check it says four times." },
    { a: "q4h", m: "every 4 hours", k: "frequency", s: { scheduleType: "interval", everyHours: 4 } },
    { a: "q6h", m: "every 6 hours", k: "frequency", s: { scheduleType: "interval", everyHours: 6 } },
    { a: "q8h", m: "every 8 hours", k: "frequency", s: { scheduleType: "interval", everyHours: 8 } },
    { a: "q12h", m: "every 12 hours", k: "frequency", s: { scheduleType: "interval", everyHours: 12 } },
    { a: "q24h", m: "every 24 hours", k: "frequency", s: { scheduleType: "interval", everyHours: 24 } },
    { a: "PRN", m: "when required (as needed)", k: "frequency", s: { scheduleType: "prn" }, alt: ["p.r.n."] },
    { a: "STAT", m: "immediately, once", k: "frequency", s: { scheduleType: "once" } },
    { a: "SOS", m: "if needed", k: "frequency", s: { scheduleType: "prn" }, note: "SOS is not used everywhere. Prefer PRN or “when required”." },
    { a: "Nocte", m: "at night", k: "timing", s: { scheduleType: "daily", timesPerDay: 1 }, alt: ["noct"] },
    { a: "Mane", m: "in the morning", k: "timing", s: { scheduleType: "daily", timesPerDay: 1 } },
    { a: "AC", m: "before meals", k: "timing", alt: ["a.c."] },
    { a: "PC", m: "after meals", k: "timing", alt: ["p.c."] },
    // ---- how it is given
    { a: "PO", m: "by mouth", k: "route", alt: ["per os", "p.o."] },
    { a: "IM", m: "injection into a muscle", k: "route" },
    { a: "IV", m: "into a vein", k: "route" },
    { a: "SC", m: "injection under the skin (subcutaneous)", k: "route", alt: ["SQ", "s.c.", "subcut"] },
    { a: "SL", m: "under the tongue", k: "route" },
    { a: "PR", m: "by the rectum", k: "route" },
    { a: "PV", m: "by the vagina", k: "route" },
    { a: "INH", m: "inhaled", k: "route" },
    { a: "NEB", m: "by nebuliser", k: "route" },
    { a: "TOP", m: "applied to the skin (topical)", k: "route" },
    { a: "NG", m: "through a nasogastric tube", k: "route" },
    // ---- forms and units
    { a: "tab", m: "tablet", k: "form" }, { a: "cap", m: "capsule", k: "form" }, { a: "inj", m: "injection", k: "form" }, { a: "syr", m: "syrup", k: "form" },
    { a: "susp", m: "suspension", k: "form" }, { a: "supp", m: "suppository", k: "form" }, { a: "amp", m: "ampoule", k: "form" }, { a: "gtt", m: "drops", k: "form" },
    { a: "mg", m: "milligram", k: "form" }, { a: "mcg", m: "microgram", k: "form" }, { a: "g", m: "gram", k: "form" }, { a: "ml", m: "millilitre", k: "form" }, { a: "kg", m: "kilogram", k: "form" },
    // ---- do not use (shown with a warning, never accepted as a shortcut)
    { a: "QD", m: "UNSAFE: could be mistaken for QID", k: "unsafe", say: "Write “OD” or “once daily”." },
    { a: "QOD", m: "UNSAFE: could be mistaken for QD or QID", k: "unsafe", say: "Write “every other day”." },
    { a: "HS", m: "UNSAFE: could mean “at bedtime” or “half strength”", k: "unsafe", say: "Write “at night”." },
    { a: "U", m: "UNSAFE: can be read as 0 or 4", k: "unsafe", say: "Write “units”." },
    { a: "IU", m: "UNSAFE: can be read as IV or 10", k: "unsafe", say: "Write “international units”." }
  ];
  var IDX = {};
  function norm(t) { return String(t == null ? "" : t).toLowerCase().replace(/[.\s]+/g, "").replace(/[^a-z0-9]/g, ""); }
  E.forEach(function (e) { e.n = norm(e.a); IDX[e.n] = e; (e.alt || []).forEach(function (x) { if (!IDX[norm(x)]) IDX[norm(x)] = e; }); });

  function lookup(t) { var n = norm(t); return n ? (IDX[n] || null) : null; }
  function label(t) { var e = lookup(t); return e ? e.a + " (" + e.m + ")" : String(t); }
  function isUnsafe(t) { var e = lookup(t); return !!(e && e.k === "unsafe"); }

  // words in a free-text instruction that are abbreviations (explained beneath the text on screen)
  function find(text) {
    var out = [], seen = {}, re = /[A-Za-z][A-Za-z0-9.]*/g, m;
    var s = String(text == null ? "" : text);
    while ((m = re.exec(s))) {
      var e = lookup(m[0]);
      // single letters and units are only explained when they are clearly an abbreviation (upper case), to avoid explaining ordinary words
      if (!e || e.hidden) continue;
      if ((e.k === "form") && e.a.length <= 2) continue;       // g, mg, ml... are units, not worth explaining under a sentence
      if (e.k !== "form" && e.a.length <= 3 && m[0] !== e.a && m[0] !== m[0].toUpperCase()) continue;   // short codes count only when written as a code (BD, PO), not as ordinary words
      if (seen[e.n]) continue; seen[e.n] = 1; out.push({ abbr: m[0], entry: e });
    }
    return out;
  }
  function expandText(text) {
    var s = String(text == null ? "" : text), found = find(s);
    found.forEach(function (f) { if (f.entry.k === "unsafe") return; s = s.replace(new RegExp("\\b" + f.abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), f.abbr + " (" + f.entry.m + ")"); });
    return s;
  }
  // the schedule pattern an abbreviation points at. It carries NO dose. Unsafe or unknown codes return null.
  function scheduleFor(t) {
    var e = lookup(t); if (!e || e.k === "unsafe" || !e.s) return null;
    return JSON.parse(JSON.stringify(e.s));
  }
  // for the screen: what to tell the clinician about what they typed
  function explain(t) {
    var e = lookup(t), s = String(t || "").trim();
    if (!s) return { ok: false, text: "" };
    if (!e) return { ok: false, text: "“" + s + "” is not in the list of known abbreviations. Choose a pattern below or write it in full." };
    if (e.k === "unsafe") return { ok: false, unsafe: true, text: e.a + ": " + e.m + ". " + (e.say || "") };
    var p = scheduleFor(t);
    if (!p) return { ok: false, text: e.a + " means " + e.m + ", but it does not set a schedule pattern." };
    return { ok: true, text: e.a + " means " + e.m + "." + (e.note ? " " + e.note : "") + " It only fills in the pattern below. You still enter the dose and confirm the whole regimen.", entry: e, pattern: p };
  }
  function all() { return E.filter(function (e) { return !e.hidden; }).map(function (e) { return { abbr: e.a, meaning: e.m, kind: e.k, note: e.note || e.say || "" }; }); }

  var api = { lookup: lookup, label: label, isUnsafe: isUnsafe, find: find, expandText: expandText, scheduleFor: scheduleFor, explain: explain, all: all };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCAB = api;
})(typeof window !== "undefined" ? window : this);
