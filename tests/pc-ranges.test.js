/* Reference range selection tests — run with:  node --test tests/     TEST DATA ONLY.
   Every number, unit and source below is invented for testing ("tu" = test unit). They are not clinical values and are not used anywhere in the app. */
const test = require("node:test");
const assert = require("node:assert/strict");
const PCR = require("../pc-ranges.js");

const R = (o) => Object.assign({ approvalStatus: "approved", rangeKey: "k1", version: 1, subjectType: "lab_test", subjectId: "t1", paramKey: "", unit: "tu", refMin: 10, refMax: 20, refText: "", sex: "any", minAgeMonths: null, maxAgeMonths: null, pregnancy: "any", specimen: "", method: "", labName: "", source: "TEST SOURCE", effectiveDate: "2020-01-01", reviewDate: "" }, o);
const P = (o) => Object.assign({ sex: "female", dobPrecision: "exact", dob: "1990-06-15" }, o);
const IN = (o) => Object.assign({ subjectType: "lab_test", subjectId: "t1", paramKey: "", unit: "tu", patient: P(), pregnancy: "unknown", specimen: "", method: "", labName: "", date: "2026-11-24", ranges: [], legacy: null }, o);
const res = (ranges, o) => PCR.resolve(IN(Object.assign({ ranges }, o || {})));

test("ageOf: exact and estimated dates of birth, whole months, birthdays, unknown and impossible dates", () => {
  assert.deepEqual(PCR.ageOf({ dobPrecision: "exact", dob: "2026-05-24" }, "2026-11-24"), { months: 6, basis: "exact" });
  assert.equal(PCR.ageOf({ dobPrecision: "exact", dob: "2026-05-25" }, "2026-11-24").months, 5, "the day before the 6-month birthday is still 5 months");
  assert.equal(PCR.ageOf({ dobPrecision: "exact", dob: "2025-11-24" }, "2026-11-24").months, 12);
  assert.deepEqual(PCR.ageOf({ dobPrecision: "estimated", dobApprox: "2020-01-01" }, "2026-11-24"), { months: 82, basis: "estimated" });
  assert.deepEqual(PCR.ageOf({ dobPrecision: "unknown" }, "2026-11-24"), { months: null, basis: "unknown" });
  assert.deepEqual(PCR.ageOf({ dobPrecision: "exact" }, "2026-11-24"), { months: null, basis: "unknown" });
  assert.equal(PCR.ageOf({ dobPrecision: "exact", dob: "2027-01-01" }, "2026-11-24").months, null, "a date of birth in the future is not an age");
  assert.equal(PCR.ageOf({ dobPrecision: "exact", dob: "2026-02-30" }, "2026-11-24").months, null, "an impossible date is not an age");
  assert.equal(PCR.ageOf(null, "2026-11-24").months, null);
});

test("nothing configured: unavailable, 'Reference range not configured', no flag, never normal", () => {
  const r = res([]); assert.equal(r.state, "unavailable"); assert.equal(r.basis, "unavailable"); assert.equal(r.reason, "no_range"); assert.equal(PCR.describe(r), "Reference range not configured");
  [5, 15, 25, "15", "positive", null].forEach((v) => assert.equal(PCR.flag(v, r), "none", String(v)));
  assert.equal(PCR.describe(null), "Reference range not configured");
});

test("one approved range for everyone: used, flags low/normal/high with inclusive limits, display shows unit, source and version", () => {
  const r = res([R()]); assert.equal(r.state, "range"); assert.equal(r.basis, "context_range"); assert.equal(r.rangeId, "rr_k1_v1"); assert.deepEqual([r.min, r.max, r.unit, r.source], [10, 20, "tu", "TEST SOURCE"]);
  assert.deepEqual([9.99, 10, 15, 20, 20.01].map((v) => PCR.flag(v, r)), ["low", "normal", "normal", "normal", "high"]);
  assert.deepEqual(["12", 12].map((v) => PCR.flag(v, r)), ["normal", "normal"]); assert.equal(PCR.flag("positive", r), "none"); assert.equal(PCR.flag("", r), "none");
  assert.equal(PCR.describe(r), "Reference: 10 to 20 tu (TEST SOURCE, version 1)");
});

test("one-sided and text-only ranges", () => {
  const lo = res([R({ refMax: null })]); assert.equal(PCR.describe(lo), "Reference: at least 10 tu (TEST SOURCE, version 1)"); assert.deepEqual([5, 50].map((v) => PCR.flag(v, lo)), ["low", "normal"]);
  const hi = res([R({ refMin: null })]); assert.equal(PCR.describe(hi), "Reference: up to 20 tu (TEST SOURCE, version 1)"); assert.deepEqual([5, 50].map((v) => PCR.flag(v, hi)), ["normal", "high"]);
  const tx = res([R({ refMin: null, refMax: null, refText: "TEST text interval" })]); assert.equal(tx.state, "range"); assert.equal(tx.flagAllowed, false); assert.equal(PCR.flag(15, tx), "none"); assert.match(PCR.describe(tx), /TEST text interval tu/);
});

test("only approved, effective ranges count: draft, superseded, retired and future-dated are ignored", () => {
  ["draft", "superseded", "retired"].forEach((st) => { const r = res([R({ approvalStatus: st })]); assert.equal(r.state, "unavailable", st); assert.equal(r.reason, "no_range", st); assert.equal(r.contextRangesExist, false, st); });
  const f = res([R({ effectiveDate: "2027-01-01" })]); assert.equal(f.state, "unavailable"); assert.equal(f.reason, "not_yet_effective"); assert.equal(res([R({ effectiveDate: "2026-11-24" })]).state, "range", "in effect on its effective date");
  assert.equal(res([R({ effectiveDate: "" })]).state, "unavailable", "no effective date, not used");
});

test("units must match; no conversion; unit spelling variants of the same unit match", () => {
  const r = res([R({ unit: "other" })]); assert.equal(r.state, "unavailable"); assert.equal(r.reason, "unit_differs"); assert.match(PCR.describe(r), /different unit[\s\S]*No conversion/);
  assert.equal(res([R({ unit: "umol/L" })], { unit: "µmol/L" }).state, "range"); assert.equal(res([R({ unit: "mg/dL" })], { unit: "mg / dL" }).state, "range"); assert.equal(res([R({ unit: "mg/dL" })], { unit: "mmol/L" }).state, "unavailable");
});

test("sex: a sex-specific range needs a recorded, matching sex", () => {
  const rng = [R({ sex: "female" })];
  assert.equal(res(rng, { patient: P({ sex: "female" }) }).state, "range");
  assert.equal(res(rng, { patient: P({ sex: "male" }) }).reason, "sex_outside");
  ["unknown", "other", "", undefined].forEach((s) => assert.equal(res(rng, { patient: P({ sex: s }) }).reason, "sex_unknown", String(s)));
  assert.equal(res([R()], { patient: P({ sex: "other" }) }).state, "range", "a range for any sex still applies");
});

test("age: minimum inclusive, maximum exclusive; unknown age cannot match an age-limited range; estimated age is used and said", () => {
  const rng = [R({ minAgeMonths: 144, maxAgeMonths: 216 })], at = (m) => ({ patient: P({ dobPrecision: "exact", dob: iso(m) }) });
  const iso = (months) => { const d = new Date(Date.UTC(2026, 10, 24)); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };
  assert.equal(res(rng, at(143)).reason, "age_outside"); assert.equal(res(rng, at(144)).state, "range"); assert.equal(res(rng, at(215)).state, "range"); assert.equal(res(rng, at(216)).reason, "age_outside");
  assert.equal(res(rng, { patient: P({ dobPrecision: "unknown", dob: null }) }).reason, "age_unknown");
  const est = res(rng, { patient: P({ dobPrecision: "estimated", dobApprox: iso(150), dob: null }) }); assert.equal(est.state, "range"); assert.equal(est.ageBasis, "estimated"); assert.match(PCR.describe(est), /age estimated/);
  assert.equal(res([R({ minAgeMonths: 12 })], at(11)).reason, "age_outside"); assert.equal(res([R({ maxAgeMonths: 12 })], at(12)).reason, "age_outside"); assert.equal(res([R({ maxAgeMonths: 12 })], at(11)).state, "range");
  assert.equal(res([R({ minAgeMonths: 0, maxAgeMonths: 1 })], { patient: P({ dobPrecision: "exact", dob: "2026-11-24" }) }).state, "range", "a newborn is 0 months");
});

test("pregnancy: only the status stated at result entry counts; 'not stated' never matches a pregnancy range", () => {
  const rng = [R({ pregnancy: "pregnant" })];
  assert.equal(res(rng, { pregnancy: "pregnant" }).state, "range"); assert.equal(res(rng, { pregnancy: "not_pregnant" }).reason, "pregnancy_outside");
  ["unknown", undefined, "", "maybe"].forEach((p) => assert.equal(res(rng, { pregnancy: p }).reason, "pregnancy_not_stated", String(p)));
  assert.equal(res([R()], { pregnancy: "unknown" }).state, "range"); assert.equal(res([R({ pregnancy: "not_pregnant" })], { pregnancy: "not_pregnant" }).state, "range");
});

test("specimen, method and laboratory: when a range sets them, the order must state the same (case-insensitive)", () => {
  const rng = [R({ specimen: "Serum", method: "TEST method", labName: "TEST Lab" })];
  assert.equal(res(rng, { specimen: "serum", method: "test METHOD", labName: " test lab " }).state, "range");
  assert.equal(res(rng, { specimen: "serum", method: "test method" }).reason, "order_context_missing", "not stated is different from not matching"); assert.equal(res(rng, { specimen: "plasma", method: "test method", labName: "test lab" }).reason, "order_context"); assert.equal(res(rng, {}).reason, "order_context_missing");
  assert.equal(res([R()], {}).state, "range");
});

test("the most specific range wins; a more general one still serves everyone else", () => {
  const general = R({ rangeKey: "g", refMin: 1, refMax: 2 }), female = R({ rangeKey: "f", sex: "female", refMin: 3, refMax: 4 }), fAge = R({ rangeKey: "fa", sex: "female", minAgeMonths: 0, maxAgeMonths: 600, refMin: 5, refMax: 6 });
  assert.deepEqual([res([general, female]).min, res([general, female], { patient: P({ sex: "male" }) }).min], [3, 1]);
  const r = res([general, female, fAge]); assert.equal(r.rangeKey, "fa"); assert.equal(r.min, 5);
  assert.equal(res([general, female, fAge], { patient: P({ sex: "female", dobPrecision: "unknown", dob: null }) }).rangeKey, "f", "unknown age drops the age-limited range, the female one remains");
});

test("two equally specific ranges are a conflict: no range chosen, no flag, a clear message", () => {
  const a = R({ rangeKey: "a", sex: "female", refMin: 1, refMax: 2 }), b = R({ rangeKey: "b", sex: "female", refMin: 3, refMax: 4 });
  const r = res([a, b]); assert.equal(r.state, "conflict"); assert.equal(r.reason, "conflict"); assert.equal(r.rangeId, null); assert.equal(r.min, null); assert.equal(PCR.flag(2.5, r), "none"); assert.match(PCR.describe(r), /conflict[\s\S]*No flag/);
  assert.equal(res([a, b], { patient: P({ sex: "male" }) }).state, "unavailable", "the conflict only exists where both apply");
  assert.equal(res([a, R({ rangeKey: "c", refMin: 7, refMax: 8 })]).rangeKey, "a", "different specificity is not a conflict");
});

test("legacy facility range: used only when no context range applies, labelled, with its source; context ranges that fail for missing context are reported", () => {
  const lg = { refMin: 10, refMax: 20, refText: "", refSource: "TEST facility source" };
  const l = res([], { legacy: lg }); assert.equal(l.basis, "legacy_catalogue"); assert.equal(l.state, "legacy"); assert.equal(l.source, "TEST facility source"); assert.equal(PCR.flag(25, l), "high"); assert.match(PCR.describe(l), /Reference: 10 to 20 tu \(facility setting, TEST facility source\)/); assert.match(l.reasonText, /not specific to this patient/);
  const c = res([R({ refMin: 1, refMax: 2 })], { legacy: lg }); assert.equal(c.basis, "context_range"); assert.equal(c.max, 2, "a context range beats the legacy one");
  const m = res([R({ sex: "female" })], { legacy: lg, patient: P({ sex: "unknown" }) }); assert.equal(m.basis, "legacy_catalogue"); assert.equal(m.contextRangesExist, true);
  assert.equal(res([], { legacy: { refMin: null, refMax: null, refText: "", refSource: "x" } }).state, "unavailable"); assert.equal(res([], { legacy: { refText: "TEST text" } }).flagAllowed, false);
});

test("critical limits are never read: only the range fields are used", () => {
  const r = res([], { legacy: { refMin: 10, refMax: 20, critical: { low: 1, high: 99 }, refSource: "s" } }); assert.deepEqual([r.min, r.max], [10, 20]); assert.equal(PCR.flag(95, r), "high");
});

test("review date: a range past its review date is still used and marked 'review overdue'", () => {
  const r = res([R({ reviewDate: "2026-11-23" })]); assert.equal(r.state, "range"); assert.equal(r.reviewOverdue, true); assert.match(PCR.describe(r), /review overdue/); assert.equal(PCR.flag(15, r), "normal");
  assert.equal(res([R({ reviewDate: "2026-11-24" })]).reviewOverdue, false); assert.equal(res([R({ reviewDate: "" })]).reviewOverdue, false);
});

test("subjects are kept apart: another test, another parameter, another subject type", () => {
  assert.equal(res([R({ subjectId: "other" })]).reason, "no_range"); assert.equal(res([R({ subjectType: "vital" })]).reason, "no_range");
  assert.equal(res([R({ subjectType: "lab_param", paramKey: "p1" })], { subjectType: "lab_param", paramKey: "p2" }).reason, "no_range"); assert.equal(res([R({ subjectType: "lab_param", paramKey: "p1" })], { subjectType: "lab_param", paramKey: "p1" }).state, "range");
});

test("vitals use their own fixed units; a range in another unit is not used", () => {
  assert.deepEqual(Object.keys(PCR.VITALS), ["temperatureC", "bpSys", "bpDia", "pulse", "respRate", "spo2"]);
  const v = R({ subjectType: "vital", subjectId: "pulse", unit: "/min", refMin: 10, refMax: 20 });
  assert.equal(res([v], { subjectType: "vital", subjectId: "pulse", unit: PCR.VITALS.pulse.unit }).state, "range"); assert.equal(res([R({ subjectType: "vital", subjectId: "pulse", unit: "bpm" })], { subjectType: "vital", subjectId: "pulse", unit: "/min" }).reason, "unit_differs");
});

test("refAppliedOf: plain values only, no undefined, no nested arrays, survives a JSON round trip", () => {
  [res([R()]), res([]), res([R({ sex: "female" })], { patient: P({ sex: "male" }) }), res([R({ rangeKey: "a" }), R({ rangeKey: "b" })]), res([], { legacy: { refMin: 1, refMax: 2, refSource: "s" } })].forEach((x) => {
    const e = PCR.refAppliedOf("T1", x); assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
    Object.values(e).forEach((v) => { assert.notEqual(v, undefined); assert.equal(Array.isArray(v), false); assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v)); });
    assert.ok(["context_range", "legacy_catalogue", "unavailable"].includes(e.basis));
  });
  const e = PCR.refAppliedOf("T1", res([R({ version: 3 })])); assert.deepEqual([e.rangeId, e.rangeVersion, e.basis, e.state, e.min, e.max, e.unit, e.source], ["rr_k1_v3", 3, "context_range", "range", 10, 20, "tu", "TEST SOURCE"]);
});

test("staleNotice: shown only when a different range exists now; never changes anything", () => {
  const stored = PCR.refAppliedOf("T1", res([R({ version: 1 })])), nowSame = res([R({ version: 1 })]), nowNew = res([R({ version: 2 })]);
  assert.equal(PCR.staleNotice(stored, nowSame), ""); assert.match(PCR.staleNotice(stored, nowNew), /newer or different reference range/);
  const none = PCR.refAppliedOf("T1", res([])); assert.match(PCR.staleNotice(none, nowSame), /now recorded for this test/); assert.equal(PCR.staleNotice(none, res([])), ""); assert.equal(PCR.staleNotice(null, nowNew), "");
});

test("validate mirrors the rules and explains each refusal", () => {
  const ok = R(); assert.deepEqual(PCR.validate(ok), []);
  const bad = (o) => PCR.validate(Object.assign({}, ok, o));
  assert.match(bad({ unit: "" })[0], /unit/i); assert.match(bad({ source: "ab" })[0], /source/i); assert.match(bad({ refMin: null, refMax: null, refText: "" })[0], /lower limit|upper limit|text/);
  assert.deepEqual(bad({ refMin: null, refMax: null, refText: "TEST text" }), []); assert.match(bad({ refMin: 30 })[0], /above the upper/); assert.match(bad({ refMin: "x" })[0], /numbers/);
  assert.match(bad({ minAgeMonths: -1 })[0], /negative/); assert.match(bad({ minAgeMonths: 10, maxAgeMonths: 10 })[0], /below the highest/); assert.match(bad({ minAgeMonths: 11, maxAgeMonths: 10 })[0], /below the highest/);
  assert.match(bad({ sex: "other" })[0], /sex/); assert.match(bad({ pregnancy: "maybe" })[0], /pregnancy/); assert.match(bad({ subjectType: "x" })[0], /what the range is for/); assert.match(bad({ subjectId: "" })[0], /test or vital/);
  assert.match(bad({ subjectType: "lab_param", paramKey: "" })[0], /parameter/); assert.match(bad({ effectiveDate: "2026-02-30" })[0], /not a valid date/); assert.match(bad({ reviewDate: "2019-01-01" })[0], /before the effective/);
  assert.match(bad({ subjectType: "vital", subjectId: "pulse", unit: "bpm" })[0], /recorded in \/min/); assert.match(bad({ subjectType: "vital", subjectId: "nope", unit: "x" })[0], /Unknown vital/); assert.deepEqual(bad({ subjectType: "vital", subjectId: "pulse", unit: "/min", allAges: true }), []);
  assert.deepEqual(PCR.approvalErrors(R()), []); assert.match(PCR.approvalErrors(R({ effectiveDate: "" }))[0], /effective date/);
  assert.deepEqual(bad({ refMin: 0, refMax: 0 }), [], "zero is a real limit, not 'missing'");
});

test("conflictRisk: overlapping contexts with equal specificity warn; disjoint ages, different kinds of context, same range key do not", () => {
  const a = R({ rangeKey: "a", sex: "female", minAgeMonths: 0, maxAgeMonths: 100 });
  assert.equal(PCR.conflictRisk(a, R({ rangeKey: "b", sex: "female", minAgeMonths: 50, maxAgeMonths: 200 })), true);
  assert.equal(PCR.conflictRisk(a, R({ rangeKey: "b", sex: "female", minAgeMonths: 100, maxAgeMonths: 200 })), false, "touching, not overlapping (maximum is exclusive)");
  assert.equal(PCR.conflictRisk(a, R({ rangeKey: "b", sex: "male", minAgeMonths: 0, maxAgeMonths: 100 })), false);
  assert.equal(PCR.conflictRisk(a, R({ rangeKey: "b", sex: "female" })), false, "different specificity: the more specific one wins, no conflict");
  assert.equal(PCR.conflictRisk(a, R({ rangeKey: "a", version: 2, sex: "female", minAgeMonths: 0, maxAgeMonths: 100 })), false, "versions of one range are not rivals");
  assert.equal(PCR.conflictRisk(R({ rangeKey: "a" }), R({ rangeKey: "b", subjectId: "other" })), false); assert.equal(PCR.conflictRisk(R({ rangeKey: "a" }), R({ rangeKey: "b", unit: "other" })), false);
  assert.equal(PCR.conflictRisk(R({ rangeKey: "a", specimen: "serum" }), R({ rangeKey: "b", specimen: "plasma" })), false); assert.equal(PCR.conflictRisk(R({ rangeKey: "a", specimen: "serum" }), R({ rangeKey: "b", specimen: "Serum" })), true);
});

test("contextText, ageText and docId", () => {
  assert.equal(PCR.contextText(R({ sex: "female", minAgeMonths: 144, maxAgeMonths: 216, pregnancy: "not_pregnant", specimen: "serum" })), "female, age 12 years up to 18 years, not pregnant, specimen serum");
  assert.equal(PCR.contextText(R()), ""); assert.equal(PCR.contextText(R({ minAgeMonths: 6 })), "age 6 months and over"); assert.equal(PCR.contextText(R({ maxAgeMonths: 1 })), "age under 1 month");
  assert.equal(PCR.docId("rk1", 2), "rr_rk1_v2"); assert.match(PCR.newRangeKey(), /^rk[0-9a-z]+$/);
});

test("property: with no numeric range that applies, a flag is NEVER given (no false 'normal', no invented abnormality)", () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 4000; i++) {
    const ranges = []; const n = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) ranges.push(R({ rangeKey: "k" + k, approvalStatus: pick(["approved", "approved", "draft", "retired", "superseded"]), sex: pick(["any", "male", "female"]), pregnancy: pick(["any", "pregnant", "not_pregnant"]), minAgeMonths: pick([null, 0, 12, 144]), maxAgeMonths: pick([null, 12, 216, 600]), refMin: pick([null, 1, 10]), refMax: pick([null, 5, 20]), refText: pick(["", "TEST"]), unit: pick(["tu", "tu", "other"]), specimen: pick(["", "serum"]), effectiveDate: pick(["2020-01-01", "2027-01-01", ""]) }));
    const legacy = pick([null, { refMin: 1, refMax: 9, refSource: "s" }, { refMin: null, refMax: null, refText: "", refSource: "s" }]);
    const patient = P({ sex: pick(["male", "female", "other", "unknown"]), dobPrecision: pick(["exact", "estimated", "unknown"]), dob: pick(["1990-01-01", "2026-01-01", null]), dobApprox: pick(["1990-01-01", null]) });
    const x = res(ranges, { patient, legacy, pregnancy: pick(["pregnant", "not_pregnant", "unknown"]), specimen: pick(["", "serum"]) }), v = pick([0, 3, 15, 50, "abc", ""]), f = PCR.flag(v, x);
    if (x.state === "unavailable" || x.state === "conflict") assert.equal(f, "none", "no range, no flag");
    if (f !== "none") { assert.ok(x.flagAllowed && (x.min !== null || x.max !== null) && ["range", "legacy"].includes(x.state) && typeof v !== "string" || (typeof v === "string" && v !== "" && isFinite(Number(v)))); }
    assert.ok(["context_range", "legacy_catalogue", "unavailable"].includes(x.basis)); if (x.state === "range") assert.ok(x.rangeId && x.source);
    JSON.stringify(PCR.refAppliedOf("T", x));
  }
});

test("v28 rules: lactation, flag lists, notes, allAges, approval stamp and clean writes", () => {
  const ok = R(), bad = (o) => PCR.validate(Object.assign({}, ok, o)).join(" | "), vit = { subjectType: "vital", subjectId: "pulse", unit: "/min" };
  assert.match(bad({ lactation: null }), /lactation/); assert.match(bad({ lactation: "maybe" }), /lactation/); assert.deepEqual(bad({ lactation: "not_lactating" }), "");
  assert.match(bad({ reproductive: "pregnant" }), /reproductive/); assert.deepEqual(bad({ reproductive: "any" }), "");
  assert.match(bad({ requireFlags: new Array(11).fill("flag_a") }), /at most 10/); assert.match(bad({ forbidFlags: new Array(11).fill("flag_a") }), /at most 10/); assert.deepEqual(bad({ requireFlags: new Array(10).fill("flag_a") }), "");
  assert.match(bad({ boundaryNote: "x".repeat(501) }), /boundary note/); assert.match(bad({ decisionReason: 7 }), /decision reason/); assert.deepEqual(bad({ boundaryNote: "x".repeat(500), decisionReason: "TEST" }), "");
  assert.match(bad(vit), /age limit/); assert.match(bad(Object.assign({ allAges: false }, vit)), /age limit/); assert.deepEqual(bad(Object.assign({ allAges: true }, vit)), ""); assert.deepEqual(bad(Object.assign({ maxAgeMonths: 24 }, vit)), ""); assert.deepEqual(bad({ allAges: undefined }), "", "labs need no age limit");
  assert.equal(PCR.approvalStampErrors({ reviewerCredential: "RN" }).length, 0); assert.equal(PCR.approvalStampErrors({ reviewerCredential: "x" }).length, 1); assert.equal(PCR.approvalStampErrors({ reviewerCredential: "" }).length, 1); assert.equal(PCR.approvalStampErrors({ reviewerCredential: "x".repeat(101) }).length, 1); assert.equal(PCR.approvalStampErrors({ reviewerCredential: "MD", approvalNote: "x".repeat(501) }).length, 1);
  const c = PCR.cleanForWrite({ boundaryNote: "", decisionReason: null, requireFlags: [], forbidFlags: ["flag_a"], lactation: null, reproductive: "any", refMin: 1 });
  assert.deepEqual(Object.keys(c).sort(), ["forbidFlags", "refMin"]); assert.equal(Object.values(c).includes(null), false);
  const d = PCR.cleanForWrite({ boundaryNote: " TEST ", lactation: "lactating" }); assert.equal(d.boundaryNote, "TEST"); assert.equal(d.lactation, "lactating"); const src = { boundaryNote: "", x: 1 }; PCR.cleanForWrite(src); assert.equal(src.boundaryNote, "", "the input is not changed");
});
