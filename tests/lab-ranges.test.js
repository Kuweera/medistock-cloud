/* Developer 4, Stage 3c: reference ranges at laboratory result entry (pc-lab.js applyRanges / rangeViews / contextControls / staleFor). In memory, no Firebase. Every number, unit and source is invented test data. */
const test = require("node:test"), assert = require("node:assert/strict");
const PCL = require("../pc-lab.js"), PCR = require("../pc-ranges.js");
const RR = (o) => Object.assign({ approvalStatus: "approved", rangeKey: "k1", version: 1, subjectType: "lab_test", subjectId: "c1", paramKey: "", unit: "tu", refMin: 10, refMax: 20, sex: "any", pregnancy: "any", lactation: "any", source: "TEST source", effectiveDate: "2026-01-01", reviewDate: "2099-01-01" }, o);
const ORD = (o) => Object.assign({ investigationId: "c1", name: "TEST number", resultType: "number", units: "tu", specimen: "Serum", refMin: null, refMax: null, refText: "", refSource: "", profile: { type: "number", method: "", equipment: "" } }, o);
const FEMALE = { dob: "1990-01-01", dobPrecision: "exact", sex: "female" }, MALE = { dob: "1990-01-01", dobPrecision: "exact", sex: "male" };
const C = (o) => Object.assign({ ranges: [RR()], patient: FEMALE, pregnancy: "unknown", lactation: "unknown", labName: "TEST lab", date: "2026-06-01" }, o);
const num = (o, v) => PCL.buildResult(o, { value: String(v) });
const plainOk = (x) => { const bad = []; (function w(v, p, inArr) { if (v === undefined) bad.push(p + " undefined"); else if (Array.isArray(v)) { if (inArr) bad.push(p + " nested array"); v.forEach((e, i) => w(e, p + "[" + i + "]", true)); } else if (v && typeof v === "object") Object.keys(v).forEach(k => w(v[k], p + "." + k, false)); })(x, "", false); return bad; };

test("a single number: the applied range gives the flag, and refApplied records exactly what was applied", () => {
  const o = ORD(), ex = [[25, "high"], [5, "low"], [15, "normal"], [10, "normal"], [20, "normal"]];
  ex.forEach(([v, f]) => { const r = PCL.applyRanges(o, num(o, v), C()); assert.equal(r.built.flag, f, "value " + v); });
  const r = PCL.applyRanges(o, num(o, 25), C()), el = r.refApplied[0];
  assert.equal(r.refApplied.length, 1); assert.equal(el.basis, "context_range"); assert.equal(el.state, "range"); assert.equal(el.rangeId, "rr_k1_v1"); assert.equal(el.rangeVersion, 1); assert.equal(el.min, 10); assert.equal(el.max, 20); assert.equal(el.unit, "tu"); assert.equal(el.source, "TEST source");
  assert.equal(el.sex, "female"); assert.equal(el.ageBasis, "exact"); assert.equal(el.ageMonths, 437); assert.equal(el.pregnancy, "unknown"); assert.equal(el.resolvedAt, "2026-06-01"); assert.deepEqual(plainOk(r.refApplied), []); assert.deepEqual(JSON.parse(JSON.stringify(r.refApplied)), r.refApplied);
  assert.deepEqual(r.applied, { refMin: 10, refMax: 20, refText: "", refSource: "TEST source" });
});
test("no range at all: no flag, however extreme the value; the screen text is 'Reference range not configured'; nothing is called normal", () => {
  const o = ORD(); [0, 5, 15, 999999].forEach(v => { const r = PCL.applyRanges(o, num(o, v), C({ ranges: [] })); assert.equal(r.built.flag, "none"); assert.equal(r.refApplied[0].state, "unavailable"); assert.equal(r.refApplied[0].reason, "no_range"); assert.equal(r.views[0].line, "Reference range not configured"); assert.deepEqual(r.applied, { refMin: null, refMax: null, refText: "", refSource: "" }); });
  const r = PCL.applyRanges(o, num(o, 5), C({ ranges: [RR({ approvalStatus: "draft" })] })); assert.equal(r.built.flag, "none", "a draft is not in use"); assert.equal(r.views[0].res.pendingExists, true);
  assert.equal(PCL.applyRanges(o, num(o, 5), C({ ranges: [RR({ approvalStatus: "rejected" }), RR({ rangeKey: "k2", approvalStatus: "retired" }), RR({ rangeKey: "k3", approvalStatus: "superseded" })] })).built.flag, "none");
  assert.equal(PCL.applyRanges(o, num(o, 5), C({ ranges: [RR({ effectiveDate: "2026-12-01" })] })).built.flag, "none", "not yet in effect");
});
test("the facility's own catalogue range is the labelled fallback; an approved range that fits takes its place", () => {
  const o = ORD({ refMin: 1, refMax: 1000, refSource: "TEST catalogue" });
  let r = PCL.applyRanges(o, num(o, 25), C({ ranges: [] })); assert.equal(r.built.flag, "normal"); assert.equal(r.refApplied[0].basis, "legacy_catalogue"); assert.match(r.views[0].line, /facility setting, TEST catalogue/); assert.deepEqual(r.applied, { refMin: 1, refMax: 1000, refText: "", refSource: "TEST catalogue" });
  r = PCL.applyRanges(o, num(o, 25), C()); assert.equal(r.built.flag, "high"); assert.equal(r.refApplied[0].basis, "context_range"); assert.equal(r.applied.refMax, 20);
  assert.equal(PCL.applyRanges(o, num(o, 0.5), C({ ranges: [] })).built.flag, "low", "legacy behaviour is unchanged");
});
test("two equally specific approved ranges conflict: no flag, no range shown, even when the catalogue has one", () => {
  const o = ORD({ refMin: 1, refMax: 1000 }), r = PCL.applyRanges(o, num(o, 25), C({ ranges: [RR(), RR({ rangeKey: "k2", refMin: 12, refMax: 18 })] }));
  assert.equal(r.built.flag, "none"); assert.equal(r.refApplied[0].state, "conflict"); assert.equal(r.refApplied[0].rangeId, null); assert.deepEqual(r.applied, { refMin: null, refMax: null, refText: "", refSource: "" }); assert.match(r.views[0].line, /conflict|more than one|two/i);
  const more = PCL.applyRanges(o, num(o, 25), C({ ranges: [RR(), RR({ rangeKey: "k2", refMin: 12, refMax: 18 }), RR({ rangeKey: "k3", sex: "female", refMin: 11, refMax: 19 })] })); assert.equal(more.refApplied[0].rangeId, "rr_k3_v1", "a more specific range is not a conflict");
});
test("a range in another unit is never used and nothing is converted", () => {
  const o = ORD(), r = PCL.applyRanges(o, num(o, 25), C({ ranges: [RR({ unit: "other" })] })); assert.equal(r.built.flag, "none"); assert.equal(r.refApplied[0].reason, "unit_differs"); assert.match(r.views[0].line, /^Reference range not configured\. A reference range exists, but in a different unit/);
});
test("pregnancy and lactation: stated at entry and stored only with the result; 'not stated' never matches a range that depends on it", () => {
  const o = ORD(), rs = [RR({ rangeKey: "p", pregnancy: "pregnant", refMin: 100, refMax: 200 }), RR({ rangeKey: "n", pregnancy: "not_pregnant", refMin: 10, refMax: 20 })];
  let r = PCL.applyRanges(o, num(o, 15), C({ ranges: rs })); assert.equal(r.built.flag, "none"); assert.equal(r.refApplied[0].reason, "pregnancy_not_stated"); assert.equal(r.refApplied[0].pregnancy, "unknown");
  r = PCL.applyRanges(o, num(o, 15), C({ ranges: rs, pregnancy: "pregnant" })); assert.equal(r.built.flag, "low"); assert.equal(r.refApplied[0].rangeId, "rr_p_v1"); assert.equal(r.refApplied[0].pregnancy, "pregnant");
  r = PCL.applyRanges(o, num(o, 15), C({ ranges: rs, pregnancy: "not_pregnant" })); assert.equal(r.built.flag, "normal"); assert.equal(r.refApplied[0].pregnancy, "not_pregnant");
  const lr = [RR({ rangeKey: "l", lactation: "lactating", refMin: 1, refMax: 2 })]; assert.equal(PCL.applyRanges(o, num(o, 1.5), C({ ranges: lr })).built.flag, "none"); assert.equal(PCL.applyRanges(o, num(o, 1.5), C({ ranges: lr, lactation: "lactating" })).built.flag, "normal");
  assert.deepEqual(PCL.contextControls(o, C({ ranges: rs })), { pregnancy: true, lactation: false }); assert.deepEqual(PCL.contextControls(o, C({ ranges: lr })), { pregnancy: false, lactation: true });
  assert.deepEqual(PCL.contextControls(o, C({ ranges: rs, patient: MALE })), { pregnancy: false, lactation: false }, "never asked of a male patient"); assert.deepEqual(PCL.contextControls(o, C()), { pregnancy: false, lactation: false }, "only asked when a range depends on it");
  assert.deepEqual(PCL.contextControls(o, C({ ranges: rs, patient: null })), { pregnancy: true, lactation: false }, "sex unknown: asked");
  assert.deepEqual(PCL.contextControls(ORD({ investigationId: "zz" }), C({ ranges: rs })), { pregnancy: false, lactation: false }, "another test's ranges do not count");
});
test("age and sex: unknown never matches a range that depends on it; an estimated date of birth is used and recorded", () => {
  const o = ORD(), kids = [RR({ rangeKey: "a", minAgeMonths: 216, refMin: 10, refMax: 20 })];
  assert.equal(PCL.applyRanges(o, num(o, 15), C({ ranges: kids, patient: null })).built.flag, "none"); assert.equal(PCL.applyRanges(o, num(o, 15), C({ ranges: kids, patient: null })).refApplied[0].reason, "age_unknown");
  assert.equal(PCL.applyRanges(o, num(o, 15), C({ ranges: kids, patient: { dobPrecision: "estimated" } })).refApplied[0].reason, "age_unknown");
  const est = PCL.applyRanges(o, num(o, 15), C({ ranges: kids, patient: { dobApprox: "1990-01-01", dobPrecision: "estimated", sex: "female" } })); assert.equal(est.built.flag, "normal"); assert.equal(est.refApplied[0].ageBasis, "estimated"); assert.match(est.views[0].line, /age estimated/);
  assert.equal(PCL.applyRanges(o, num(o, 15), C({ ranges: [RR({ sex: "female" })], patient: { dob: "1990-01-01", dobPrecision: "exact", sex: "unknown" } })).refApplied[0].reason, "sex_unknown");
  assert.equal(PCL.applyRanges(o, num(o, 15), C({ ranges: [RR({ sex: "female", maxAgeMonths: 216 })] })).refApplied[0].reason !== "", true, "the adult patient is outside the child range: nothing is applied");
  assert.equal(PCL.applyRanges(o, num(o, 15), C({ ranges: [RR({ maxAgeMonths: 216 })] })).built.flag, "none");
});
test("a text-only range is shown but never gives a flag", () => {
  const o = ORD(), r = PCL.applyRanges(o, num(o, 15), C({ ranges: [RR({ refMin: null, refMax: null, refText: "TEST text interval" })] })); assert.equal(r.built.flag, "none"); assert.equal(r.refApplied[0].state, "range"); assert.equal(r.refApplied[0].text, "TEST text interval"); assert.match(r.views[0].line, /TEST text interval/); assert.equal(r.applied.refText, "TEST text interval");
});
test("PROPERTY: a flag is never given without an applicable numeric range (4,000 random situations)", () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = a => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 4000; i++) {
    const n = Math.floor(rnd() * 4), ranges = [];
    for (let k = 0; k < n; k++) ranges.push(RR({ rangeKey: "r" + k, approvalStatus: pick(["approved", "approved", "draft", "rejected"]), unit: pick(["tu", "tu", "other"]), sex: pick(["any", "male", "female"]), pregnancy: pick(["any", "pregnant", "not_pregnant"]), lactation: pick(["any", "lactating"]),
      minAgeMonths: pick([null, 0, 216]), maxAgeMonths: pick([null, 216, 900]), refMin: pick([null, 1, 10]), refMax: pick([null, 20, 99]), refText: pick(["", "TEST text"]), effectiveDate: pick(["2026-01-01", "2027-01-01"]) }));
    const o = ORD(pick([{}, { refMin: 1, refMax: 5 }, { refText: "TEST" }])), v = Math.round(rnd() * 1000) / 10, ctx = C({ ranges, patient: pick([null, FEMALE, MALE, { dobPrecision: "estimated", dobApprox: "2020-01-01", sex: "male" }]), pregnancy: pick(["unknown", "pregnant", "not_pregnant"]), lactation: pick(["unknown", "lactating", "not_lactating"]) });
    const r = PCL.applyRanges(o, num(o, v), ctx), view = r.views[0], f = r.built.flag, res = view.res;
    if (f !== "none") { assert.ok(res.flagAllowed && (res.state === "range" || res.state === "legacy") && (res.min !== null || res.max !== null), "flag without a numeric range, iteration " + i); assert.equal(f, v < (res.min === null ? -Infinity : res.min) ? "low" : v > (res.max === null ? Infinity : res.max) ? "high" : "normal"); }
    if (res.state === "unavailable" || res.state === "conflict") { assert.equal(f, "none"); assert.deepEqual(r.applied, { refMin: null, refMax: null, refText: "", refSource: "" }); }
    assert.deepEqual(plainOk(r.refApplied), [], "iteration " + i);
  }
});
test("a multi-part test: each numeric part has its own range, flag and refApplied element; parts without a value or a range are not guessed", () => {
  const o = { investigationId: "c2", name: "TEST panel", resultType: "multi", units: "", specimen: "Blood", profile: { type: "multi", params: [{ key: "a", label: "Part A", type: "number", unit: "tu", refMin: null, refMax: null, refText: "", refSource: "" }, { key: "b", label: "Part B", type: "number", unit: "tv", refMin: 1, refMax: 2, refText: "", refSource: "TEST catalogue" }, { key: "c", label: "Part C", type: "number", unit: "tw" }, { key: "d", label: "Part D", type: "qualitative", choices: ["Yes", "No"] }] } };
  const rs = [RR({ subjectType: "lab_param", subjectId: "c2", paramKey: "a", refMin: 10, refMax: 20 })], built = PCL.buildResult(o, { params: { a: "25", b: "1.5", c: "7", d: "Yes" } }), before = JSON.stringify(built);
  const r = PCL.applyRanges(o, built, C({ ranges: rs })); assert.equal(JSON.stringify(built), before, "the input is not changed");
  assert.equal(r.built.values.a.flag, "high"); assert.equal(r.built.values.b.flag, "normal"); assert.equal(r.built.values.c.flag, "none"); assert.equal(r.built.values.d.flag, "none"); assert.equal(r.built.flag, "abnormal");
  assert.equal(r.refApplied.length, 3); assert.deepEqual(r.refApplied.map(e => e.param), ["a", "b", "c"]); assert.equal(r.refApplied[0].basis, "context_range"); assert.equal(r.refApplied[1].basis, "legacy_catalogue"); assert.equal(r.refApplied[2].state, "unavailable");
  assert.equal(r.built.values.a.refMax, 20); assert.equal(r.built.values.a.refSource, "TEST source"); assert.equal(r.built.values.c.refMin, null); assert.equal("refSource" in r.built.values.c, false); assert.deepEqual(plainOk(r.refApplied), []);
  const part = PCL.applyRanges(o, PCL.buildResult(o, { params: { a: "25" } }), C({ ranges: rs })); assert.deepEqual(part.refApplied.map(e => e.param), ["a"], "a part with no value has no element");
  assert.equal(PCL.rangeViews(o, {}, C({ ranges: rs })).length, 3, "the entry screen shows the reference for every numeric part, before any value is typed"); assert.ok(PCL.rangeViews(o, {}, C({ ranges: rs })).every(v => v.flag === "none"));
});
test("tests with no numeric result are untouched: no refApplied, no flag from ranges", () => {
  const o = { investigationId: "c3", name: "TEST text", resultType: "text", units: "", profile: { type: "text" } }, b = PCL.buildResult(o, { value: "TEST report" }), r = PCL.applyRanges(o, b, C({ ranges: [RR({ subjectId: "c3" })] }));
  assert.equal(r.refApplied, null); assert.equal(r.applied, null); assert.deepEqual(r.views, []); assert.deepEqual(r.built, b);
  const q = { investigationId: "c4", name: "TEST qual", resultType: "qualitative", choices: ["Pos", "Neg"], profile: { type: "qualitative", choices: ["Pos", "Neg"] } }; assert.equal(PCL.applyRanges(q, PCL.buildResult(q, { value: "Pos" }), C()).refApplied, null);
  assert.equal(PCL.applyRanges(ORD(), { ok: false, error: "x" }, C()).refApplied, null);
});
test("verify screen: a stored range is shown as stored; a notice appears if the situation has since changed; nothing is rewritten", () => {
  const o = ORD(), r = PCL.applyRanges(o, num(o, 25), C()), res = { refApplied: r.refApplied };
  assert.equal(PCL.staleFor(o, res, C()), ""); assert.match(PCL.staleFor(o, res, C({ ranges: [RR({ approvalStatus: "superseded" }), RR({ version: 2, refMax: 30 })] })), /newer or different reference range/); assert.equal(PCL.staleFor(o, { refApplied: null }, C()), ""); assert.equal(PCL.staleFor(o, {}, C()), "");
  const none = PCL.applyRanges(o, num(o, 25), C({ ranges: [] })); assert.match(PCL.staleFor(o, { refApplied: none.refApplied }, C()), /entered without one/);
  assert.match(PCR.describe(none.refApplied[0]), /^Reference range not configured$/); assert.match(PCR.describe(PCL.applyRanges(o, num(o, 25), C({ ranges: [RR({ unit: "x" })] })).refApplied[0]), /different unit/);
  assert.match(PCR.describe(PCL.applyRanges(o, num(o, 25), C({ ranges: [RR(), RR({ rangeKey: "k2" })] })).refApplied[0]), /./); assert.equal(PCR.describe(r.refApplied[0]), "Reference: 10 to 20 tu (TEST source, version 1)");
});
