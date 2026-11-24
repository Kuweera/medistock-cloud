/* MediStock Cloud — reference range selection (Developer 4, Stage 3).
   Pure functions: no database, no page. Used by laboratory.html, investigations.html, lab-reports.html and (through Developer 3) encounter.html.

   THIS FILE CONTAINS NO CLINICAL VALUES. Every range comes from a document in pc_reference_ranges that a laboratory entered with a named source and a different
   role approved. Nothing here supplies, guesses or converts a range, and nothing here decides what is "normal" without one.

   Rules, as agreed with the Lead:
   - A reference interval is separate from a critical limit or a warning threshold. Those are never read from here.
   - If no range applies, the answer is "No reference range recorded" (or the reason). It is never normal and never abnormal.
   - Context counts: sex, age, pregnancy status stated at result entry, unit, specimen, method, laboratory. A range that sets a context only applies when that context is known and matches.
   - The most specific range wins. Two equally specific ranges are a conflict: no range is chosen and no flag is produced.
   - A range past its review date is still used and is marked "review overdue".
   - An estimated date of birth is used and the result says the age was estimated. */
(function (root) {
  "use strict";

  /* Vital signs measured in the visit screen. The unit is the one that screen records; a range in another unit is not used (no conversion is attempted). */
  var VITALS = {
    temperatureC: { label: "Temperature", unit: "°C" }, bpSys: { label: "Systolic BP", unit: "mmHg" }, bpDia: { label: "Diastolic BP", unit: "mmHg" },
    pulse: { label: "Pulse", unit: "/min" }, respRate: { label: "Breathing rate", unit: "/min" }, spo2: { label: "Oxygen saturation", unit: "%" }
  };
  var SEXES = ["any", "male", "female"], PREGS = ["any", "pregnant", "not_pregnant"], TYPES = ["lab_test", "lab_param", "vital"], STATUSES = ["draft", "approved", "superseded", "retired"];

  // ---------------------------------------------------------------- small helpers
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function iso(d) { if (typeof d === "string") return d.slice(0, 10); var x = d instanceof Date ? d : new Date(d); return isNaN(x) ? "" : x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2) + "-" + ("0" + x.getDate()).slice(-2); }
  function isIso(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false; var d = new Date(s + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
  function normUnit(u) { return str(u).toLowerCase().replace(/\s+/g, "").replace(/[µμ]/g, "u"); }
  function sameText(a, b) { return str(a).toLowerCase() === str(b).toLowerCase(); }
  function docId(rangeKey, version) { return "rr_" + rangeKey + "_v" + version; }
  function newRangeKey() { return "rk" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }

  // ---------------------------------------------------------------- patient context
  /* ageOf(patient, onDate) -> { months, basis }   basis: "exact" (date of birth), "estimated" (approximate date of birth), "unknown". Whole months, never negative. */
  function ageOf(p, onDate) {
    p = p || {}; var base = "", basis = "unknown";
    if (p.dobPrecision === "exact" && isIso(str(p.dob))) { base = p.dob; basis = "exact"; }
    else if (p.dobPrecision === "estimated" && isIso(str(p.dobApprox))) { base = p.dobApprox; basis = "estimated"; }
    var on = iso(onDate || new Date()); if (!base || !isIso(on)) return { months: null, basis: "unknown" };
    var b = base.split("-").map(Number), o = on.split("-").map(Number), m = (o[0] - b[0]) * 12 + (o[1] - b[1]) - (o[2] < b[2] ? 1 : 0);
    return m < 0 ? { months: null, basis: "unknown" } : { months: m, basis: basis };
  }
  function sexOf(p) { var s = str(p && p.sex).toLowerCase(); return s === "male" || s === "female" ? s : "unknown"; }
  function pregOf(v) { return v === "pregnant" || v === "not_pregnant" ? v : "unknown"; }

  // ---------------------------------------------------------------- one range against one situation
  /* ctx: { unit, sex, ageMonths, pregnancy, specimen, method, labName, date }
     check(range, ctx) -> { ok, fail }   fail is the first context that did not fit: "unit", "age_unknown", "age_outside", "sex_unknown", "sex_outside", "pregnancy_not_stated", "pregnancy_outside", "order_context", "not_yet_effective" */
  function check(r, c) {
    if (r.approvalStatus !== "approved") return { ok: false, fail: "not_approved" };
    if (!isIso(str(r.effectiveDate)) || str(r.effectiveDate) > c.date) return { ok: false, fail: "not_yet_effective" };
    if (normUnit(r.unit) !== normUnit(c.unit)) return { ok: false, fail: "unit" };
    if (r.sex === "male" || r.sex === "female") { if (c.sex === "unknown") return { ok: false, fail: "sex_unknown" }; if (c.sex !== r.sex) return { ok: false, fail: "sex_outside" }; }
    var lo = isNum(r.minAgeMonths) ? r.minAgeMonths : null, hi = isNum(r.maxAgeMonths) ? r.maxAgeMonths : null;
    if (lo !== null || hi !== null) { if (!isNum(c.ageMonths)) return { ok: false, fail: "age_unknown" }; if ((lo !== null && c.ageMonths < lo) || (hi !== null && c.ageMonths >= hi)) return { ok: false, fail: "age_outside" }; }   // min inclusive, max exclusive
    if (r.pregnancy === "pregnant" || r.pregnancy === "not_pregnant") { if (c.pregnancy === "unknown") return { ok: false, fail: "pregnancy_not_stated" }; if (c.pregnancy !== r.pregnancy) return { ok: false, fail: "pregnancy_outside" }; }
    var ords = [["specimen", r.specimen], ["method", r.method], ["labName", r.labName]];
    for (var i = 0; i < ords.length; i++) if (str(ords[i][1]) && !sameText(ords[i][1], c[ords[i][0]])) return { ok: false, fail: "order_context" };
    return { ok: true, fail: "" };
  }
  /* specificity(range): how many context conditions the range sets (age bounds count once) */
  function specificity(r) { return (r.sex === "male" || r.sex === "female" ? 1 : 0) + (isNum(r.minAgeMonths) || isNum(r.maxAgeMonths) ? 1 : 0) + (r.pregnancy === "pregnant" || r.pregnancy === "not_pregnant" ? 1 : 0) + (str(r.specimen) ? 1 : 0) + (str(r.method) ? 1 : 0) + (str(r.labName) ? 1 : 0); }

  var WHY = {
    no_range: "No reference range recorded.",
    unit_differs: "A reference range exists, but in a different unit from this result. No conversion is attempted.",
    age_unknown: "Reference ranges for this test depend on age, and the patient's age is not recorded.",
    age_outside: "No reference range covers this patient's age.",
    sex_unknown: "Reference ranges for this test depend on sex, and the patient's sex is not recorded.",
    sex_outside: "No reference range covers this patient's sex.",
    pregnancy_not_stated: "Reference ranges for this test depend on pregnancy, and pregnancy status was not stated for this result.",
    pregnancy_outside: "No reference range covers this pregnancy status.",
    order_context: "Reference ranges exist for a specific specimen, method or laboratory, and this order does not state a matching one.",
    not_yet_effective: "The reference range recorded for this test is not in effect yet.",
    conflict: "Reference ranges conflict: more than one equally specific range applies. Ask the laboratory lead to fix them. No flag is given."
  };
  var FAIL_ORDER = ["age_unknown", "sex_unknown", "pregnancy_not_stated", "order_context", "age_outside", "sex_outside", "pregnancy_outside", "unit", "not_yet_effective"];

  /* resolve(input) -> result
     input:  { subjectType, subjectId, paramKey, unit, patient, pregnancy, specimen, method, labName, date, ranges: [pc_reference_ranges docs],
               legacy: { refMin, refMax, refText, refSource } | null }
     result: { basis: "context_range" | "legacy_catalogue" | "unavailable", state: "range" | "legacy" | "unavailable" | "conflict", reason, reasonText,
               rangeId, rangeKey, rangeVersion, min, max, text, unit, source, reviewOverdue, contextRangesExist,
               ageMonths, ageBasis, sex, pregnancy, resolvedAt, flagAllowed } */
  function resolve(inp) {
    inp = inp || {}; var date = iso(inp.date || new Date()), age = ageOf(inp.patient, date);
    var ctx = { unit: str(inp.unit), sex: sexOf(inp.patient), ageMonths: age.months, pregnancy: pregOf(inp.pregnancy), specimen: str(inp.specimen), method: str(inp.method), labName: str(inp.labName), date: date };
    var out = { basis: "unavailable", state: "unavailable", reason: "no_range", reasonText: WHY.no_range, rangeId: null, rangeKey: null, rangeVersion: null, min: null, max: null, text: "", unit: ctx.unit, source: "", reviewOverdue: false, contextRangesExist: false,
      ageMonths: age.months, ageBasis: age.basis, sex: ctx.sex, pregnancy: ctx.pregnancy, resolvedAt: date, flagAllowed: false };
    var mine = (inp.ranges || []).filter(function (r) { return r && r.subjectType === inp.subjectType && r.subjectId === inp.subjectId && str(r.paramKey) === str(inp.paramKey) && r.approvalStatus === "approved"; });
    out.contextRangesExist = mine.length > 0;
    var fits = [], fails = {};
    mine.forEach(function (r) { var c = check(r, ctx); if (c.ok) fits.push(r); else fails[c.fail] = true; });
    if (fits.length) {
      var top = Math.max.apply(null, fits.map(specificity)), best = fits.filter(function (r) { return specificity(r) === top; });
      if (best.length > 1) { out.state = "conflict"; out.reason = "conflict"; out.reasonText = WHY.conflict; return out; }
      var r = best[0]; out.basis = "context_range"; out.state = "range"; out.reason = ""; out.reasonText = ""; out.rangeId = docId(r.rangeKey, r.version); out.rangeKey = r.rangeKey; out.rangeVersion = r.version;
      out.min = isNum(r.refMin) ? r.refMin : null; out.max = isNum(r.refMax) ? r.refMax : null; out.text = str(r.refText); out.unit = str(r.unit); out.source = str(r.source);
      out.reviewOverdue = isIso(str(r.reviewDate)) && str(r.reviewDate) < date; out.flagAllowed = out.min !== null || out.max !== null; return out;
    }
    var lg = inp.legacy;   // the facility's own single range on the catalogue test (it always had a source); used when no context range applies
    if (lg && (isNum(lg.refMin) || isNum(lg.refMax) || str(lg.refText))) {
      out.basis = "legacy_catalogue"; out.state = "legacy"; out.reason = ""; out.reasonText = "Facility setting, not specific to this patient" + (str(lg.refSource) ? " (source: " + str(lg.refSource) + ")" : "") + ".";
      out.min = isNum(lg.refMin) ? lg.refMin : null; out.max = isNum(lg.refMax) ? lg.refMax : null; out.text = str(lg.refText); out.source = str(lg.refSource); out.flagAllowed = out.min !== null || out.max !== null; return out;
    }
    if (mine.length) { for (var i = 0; i < FAIL_ORDER.length; i++) if (fails[FAIL_ORDER[i]]) { out.reason = FAIL_ORDER[i] === "unit" ? "unit_differs" : FAIL_ORDER[i]; break; } if (!out.reason || out.reason === "no_range") out.reason = "age_outside"; out.reasonText = WHY[out.reason] || WHY.no_range; }
    return out;
  }

  // ---------------------------------------------------------------- flags and display
  /* flag(value, resolved) -> "low" | "normal" | "high" | "none"   "none" whenever there is no numeric range: unavailable, conflict, text-only, or a non-numeric value. Inclusive limits. */
  function flag(value, res) {
    if (!res || !res.flagAllowed || res.state === "conflict" || res.state === "unavailable") return "none";
    var n = typeof value === "number" ? value : (str(value) !== "" && isFinite(Number(value)) ? Number(value) : NaN); if (!isFinite(n)) return "none";
    if (res.min !== null && n < res.min) return "low"; if (res.max !== null && n > res.max) return "high"; return "normal";
  }
  function fmt(n) { return String(Math.round(n * 1e6) / 1e6); }
  function ageText(months) { if (!isNum(months)) return ""; if (months < 24) return fmt(months) + " month" + (months === 1 ? "" : "s"); var y = months / 12; return fmt(Math.round(y * 100) / 100) + " years"; }
  /* contextText(range) -> e.g. "female, from 144 months up to 216 months, not pregnant, specimen serum" (only what the range sets) */
  function contextText(r) {
    var p = []; if (r.sex === "male" || r.sex === "female") p.push(r.sex);
    var lo = isNum(r.minAgeMonths) ? r.minAgeMonths : null, hi = isNum(r.maxAgeMonths) ? r.maxAgeMonths : null;
    if (lo !== null && hi !== null) p.push("age " + ageText(lo) + " up to " + ageText(hi)); else if (lo !== null) p.push("age " + ageText(lo) + " and over"); else if (hi !== null) p.push("age under " + ageText(hi));
    if (r.pregnancy === "pregnant") p.push("pregnant"); else if (r.pregnancy === "not_pregnant") p.push("not pregnant");
    if (str(r.specimen)) p.push("specimen " + str(r.specimen)); if (str(r.method)) p.push("method " + str(r.method)); if (str(r.labName)) p.push("laboratory " + str(r.labName));
    return p.join(", ");
  }
  /* describe(resolved) -> the line shown beside a result or a vital: the range with unit and source, or why there is none */
  function describe(res) {
    if (!res) return "No reference range recorded";
    if (res.state === "unavailable") return res.reasonText && res.reason !== "no_range" ? "No reference range available. " + res.reasonText : "No reference range recorded";
    if (res.state === "conflict") return res.reasonText;
    var v = res.min !== null && res.max !== null ? fmt(res.min) + " to " + fmt(res.max) : res.min !== null ? "at least " + fmt(res.min) : res.max !== null ? "up to " + fmt(res.max) : res.text;
    if ((res.min !== null || res.max !== null) && res.text) v += " (" + res.text + ")";
    var tail = res.basis === "context_range" ? [res.source, "version " + res.rangeVersion].filter(Boolean).join(", ") : "facility setting" + (res.source ? ", " + res.source : "");
    return "Reference: " + v + (res.unit ? " " + res.unit : "") + " (" + tail + ")" + (res.reviewOverdue ? " — review overdue" : "") + (res.basis === "context_range" && res.ageBasis === "estimated" && res.ageMonths !== null ? " — age estimated" : "");
  }

  /* refApplied element for pc_inv_results (written once at result entry; never rewritten). Plain values only: no undefined, no nested arrays. */
  function refAppliedOf(param, res) {
    return { param: str(param), basis: res.basis, state: res.state, reason: res.reason || "", rangeId: res.rangeId || null, rangeVersion: res.rangeVersion == null ? null : res.rangeVersion, min: res.min, max: res.max, text: res.text || "", unit: res.unit || "", source: res.source || "",
      ageMonths: res.ageMonths, ageBasis: res.ageBasis, sex: res.sex, pregnancy: res.pregnancy, reviewOverdue: !!res.reviewOverdue, resolvedAt: res.resolvedAt };
  }
  /* staleNotice(stored, nowResolved) -> "" or a short notice for the verify screen. Display only: a stored flag is never changed. */
  function staleNotice(stored, now) {
    if (!stored || !now) return "";
    if ((stored.rangeId || null) !== (now.rangeId || null) && now.basis === "context_range") return stored.basis === "context_range" ? "A newer or different reference range now exists for this test. The range stored with this result is still the one shown." : "A reference range is now recorded for this test. This result was entered without one.";
    return "";
  }

  // ---------------------------------------------------------------- management screen: validation and overlap
  /* validate(doc) -> [error text]   mirrors the rules (so the screen explains what the rules would refuse). Empty list = acceptable. */
  function validate(d) {
    var e = []; d = d || {};
    if (TYPES.indexOf(d.subjectType) < 0) e.push("Choose what the range is for.");
    if (!str(d.subjectId)) e.push("Choose the test or vital.");
    if (d.subjectType === "lab_param" && !str(d.paramKey)) e.push("Choose the parameter.");
    if (!str(d.unit)) e.push("Enter the unit."); else if (str(d.unit).length > 30) e.push("The unit is too long.");
    if (d.subjectType === "vital") { var v = VITALS[d.subjectId]; if (!v) e.push("Unknown vital sign."); else if (str(d.unit) && normUnit(d.unit) !== normUnit(v.unit)) e.push("This vital is recorded in " + v.unit + ". A range in another unit would not be used."); }
    var hasMin = d.refMin !== null && d.refMin !== undefined, hasMax = d.refMax !== null && d.refMax !== undefined;
    if ((hasMin && !isNum(d.refMin)) || (hasMax && !isNum(d.refMax))) e.push("The limits must be numbers.");
    else if (!hasMin && !hasMax && !str(d.refText)) e.push("Enter a lower limit, an upper limit, or the interval as text.");
    else if (hasMin && hasMax && d.refMin > d.refMax) e.push("The lower limit is above the upper limit.");
    var lo = d.minAgeMonths, hi = d.maxAgeMonths, hasLo = lo !== null && lo !== undefined, hasHi = hi !== null && hi !== undefined;
    if ((hasLo && !isNum(lo)) || (hasHi && !isNum(hi))) e.push("The age limits must be numbers (months).");
    else { if (hasLo && lo < 0) e.push("The lowest age cannot be negative."); if (hasLo && hasHi && lo >= hi) e.push("The lowest age must be below the highest age."); }
    if (SEXES.indexOf(d.sex) < 0) e.push("Choose the sex the range applies to."); if (PREGS.indexOf(d.pregnancy) < 0) e.push("Choose the pregnancy condition.");
    if (str(d.source).length < 3) e.push("Name the source of this range (a reference, a kit insert, or the laboratory's own validated interval).");
    if (str(d.effectiveDate) && !isIso(str(d.effectiveDate))) e.push("The effective date is not a valid date.");
    if (str(d.reviewDate) && !isIso(str(d.reviewDate))) e.push("The review date is not a valid date."); else if (str(d.reviewDate) && str(d.effectiveDate) && str(d.reviewDate) < str(d.effectiveDate)) e.push("The review date is before the effective date.");
    return e;
  }
  /* approvalErrors(doc) -> extra things needed to approve (the rules also require these) */
  function approvalErrors(d) { var e = validate(d); if (!isIso(str(d && d.effectiveDate))) e.push("An effective date is needed to approve."); return e; }
  function ageSpan(r) { return [isNum(r.minAgeMonths) ? r.minAgeMonths : 0, isNum(r.maxAgeMonths) ? r.maxAgeMonths : Infinity]; }
  /* conflictRisk(a, b) -> true when two approved ranges could both apply to the same patient with the same specificity (so the screen can warn before approving) */
  function conflictRisk(a, b) {
    if (!a || !b || a.rangeKey === b.rangeKey) return false;
    if (a.subjectType !== b.subjectType || a.subjectId !== b.subjectId || str(a.paramKey) !== str(b.paramKey) || normUnit(a.unit) !== normUnit(b.unit)) return false;
    if (specificity(a) !== specificity(b)) return false;
    var sx = (a.sex === "male" || a.sex === "female") && (b.sex === "male" || b.sex === "female") ? a.sex === b.sex : true;
    var pg = (a.pregnancy === "pregnant" || a.pregnancy === "not_pregnant") && (b.pregnancy === "pregnant" || b.pregnancy === "not_pregnant") ? a.pregnancy === b.pregnancy : true;
    var A = ageSpan(a), B = ageSpan(b), ag = Math.max(A[0], B[0]) < Math.min(A[1], B[1]);
    var ct = ["specimen", "method", "labName"].every(function (k) { return !str(a[k]) || !str(b[k]) || sameText(a[k], b[k]); });
    var sameKinds = ["sex", "pregnancy"].every(function (k) { return ((a[k] === "any") === (b[k] === "any")); }) && ["specimen", "method", "labName"].every(function (k) { return !!str(a[k]) === !!str(b[k]); }) && ((isNum(a.minAgeMonths) || isNum(a.maxAgeMonths)) === (isNum(b.minAgeMonths) || isNum(b.maxAgeMonths)));
    return sx && pg && ag && ct && sameKinds;
  }

  var api = { VITALS: VITALS, SEXES: SEXES, PREGS: PREGS, TYPES: TYPES, STATUSES: STATUSES, ageOf: ageOf, sexOf: sexOf, check: check, specificity: specificity, resolve: resolve, flag: flag, describe: describe, contextText: contextText, ageText: ageText,
    refAppliedOf: refAppliedOf, staleNotice: staleNotice, validate: validate, approvalErrors: approvalErrors, conflictRisk: conflictRisk, docId: docId, newRangeKey: newRangeKey, normUnit: normUnit, isIso: isIso, WHY: WHY };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCR = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this));
