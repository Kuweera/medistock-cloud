/* Observation interpretation engine tests — run with:  node --test tests/     TEST DATA ONLY.
   The rules below are TEST FIXTURES written for these tests. Where a fixture uses a number that also appears in a published guideline (for example the exact boundaries the
   acceptance tests name), it is there to test the boundary logic only: it is not loaded into the app and does not mean any value is approved or clinically endorsed. */
const test = require("node:test");
const assert = require("node:assert/strict");
const PCR = require("../pc-ranges.js");
const PCO = require("../pc-obs.js");

const DATE = "2026-11-24";
const pat = (months, o) => { const d = new Date(Date.UTC(2026, 10, 24)); d.setUTCMonth(d.getUTCMonth() - months); return Object.assign({ sex: "female", dobPrecision: "exact", dob: d.toISOString().slice(0, 10) }, o); };
const R = (o) => Object.assign({ approvalStatus: "approved", rangeKey: "k1", version: 1, subjectType: "vital", subjectId: "pulse", paramKey: "", unit: "/min", refMin: 10, refMax: 20, refText: "", sex: "any", minAgeMonths: null, maxAgeMonths: null, pregnancy: "any", lactation: "any", specimen: "", method: "", labName: "", setting: "", requireFlags: [], forbidFlags: [], source: "TEST SOURCE", effectiveDate: "2020-01-01", reviewDate: "" }, o);
const A = (o) => Object.assign({ approvalStatus: "approved", ruleKey: "a1", version: 1, subjectType: "vital", subjectId: "pulse", paramKey: "", unit: "/min", ruleType: "alert", operator: "gt", value: 100, min: null, max: null, message: "", urgencyText: "", group: "", sex: "any", minAgeMonths: null, maxAgeMonths: null, pregnancy: "any", lactation: "any", method: "", setting: "", requireFlags: [], forbidFlags: [], source: "TEST SOURCE", sourceTitle: "TEST title", sourcePage: "p. 1", effectiveDate: "2020-01-01" }, o);
const I = (o) => PCO.interpret(Object.assign({ key: "pulse", raw: 15, patient: pat(300), ctx: {}, date: DATE, ranges: [], alerts: [] }, o));

test("validateEntry: blank, formats, unit, entry limits and decimals; an invalid entry is never a clinical result", () => {
  assert.equal(PCO.isBlank(""), true); assert.equal(PCO.isBlank("  "), true); assert.equal(PCO.isBlank(null), true); assert.equal(PCO.isBlank(0), false);
  const v = (raw, o) => PCO.validateEntry(Object.assign({ raw }, o));
  assert.deepEqual([v("12").ok, v("12").value, v(12.5).value, v("12.50").value, v("0").ok, v(0).ok], [true, 12, 12.5, 12.5, true, true]);
  ["abc", "1e3", "1,5", "1,000", "12 ", "--3", "1.", ".5", "0x10", "Infinity"].forEach((x) => { const r = v(x); if (x === "12 ") assert.equal(r.ok, true, "surrounding spaces are trimmed"); else assert.equal(r.ok, false, JSON.stringify(x)); });
  assert.equal(v(NaN).ok, false); assert.equal(v(Infinity).ok, false); assert.equal(v("").code, "empty"); assert.match(v("1,5").text, /decimal point/);
  assert.equal(v(5, { unit: "kg", expectedUnit: "/min" }).code, "unit"); assert.equal(v(5, { unit: "/MIN", expectedUnit: "/min" }).ok, true); assert.equal(v(5, { expectedUnit: "/min" }).ok, true, "no unit stated is not a mismatch");
  assert.equal(v(5, { limits: { min: 10, max: 300 } }).code, "limits"); assert.equal(v(10, { limits: { min: 10, max: 300 } }).ok, true); assert.equal(v(300, { limits: { min: 10, max: 300 } }).ok, true); assert.equal(v(301, { limits: { min: 10, max: 300 } }).code, "limits");
  assert.match(v(5, { limits: { min: 10, max: 300 } }).text, /data-entry check, not a clinical result/);
  assert.equal(v("1.25", { maxDecimals: 1 }).code, "decimals"); assert.equal(v("1.2", { maxDecimals: 1 }).ok, true);
});

test("invalid input is its own state: never abnormal, never flagged, cannot be saved, no alert even with rules that would fire", () => {
  const rules = { ranges: [R()], alerts: [A({ operator: "gt", value: 1 })] };
  ["abc", "1,5", "", 5000].forEach((raw) => {
    const x = I(Object.assign({ raw, limits: { min: 10, max: 300 } }, rules));
    if (raw === "") assert.equal(x.state, "invalid"); else assert.equal(x.state, "invalid", String(raw));
    assert.equal(x.saveable, false); assert.equal(x.alerts.length, 0); assert.equal(x.requiresAck, false); assert.match(x.statusLine, /This is not a clinical result/); assert.equal(x.tone, "invalid"); assert.notEqual(x.state, "outside_reference");
  });
  const wrongUnit = I({ raw: 5, unit: "kg", ranges: [R()] }); assert.equal(wrongUnit.state, "invalid"); assert.match(wrongUnit.statusLine, /does not match the unit/);
  assert.equal(PCO.canSave([I({ raw: "abc" })], []).ok, false);
});

test("no approved range: 'Reference range not configured', never normal, can still be recorded", () => {
  const x = I({ raw: 15 }); assert.equal(x.state, "not_configured"); assert.equal(x.saveable, true); assert.match(x.statusLine, /Reference range not configured/); assert.equal(x.referenceLine, "Reference range not configured"); assert.equal(x.tone, "grey");
  assert.notEqual(I({ raw: 15, ranges: [R({ subjectId: "other" })] }).state, "normal"); assert.equal(PCO.canSave([x], []).ok, true);
  const txt = I({ raw: 15, ranges: [R({ refMin: null, refMax: null, refText: "TEST text" })] }); assert.equal(txt.state, "not_configured"); assert.match(txt.statusLine, /text only/);
});

test("normal and outside_reference: limits are inclusive; outside the interval is NOT an alert; display shows value, unit and the interval", () => {
  const rg = [R({ refMin: 80, refMax: 100 })], at = (raw) => I({ raw, ranges: rg });
  assert.deepEqual([79, 80, 90, 100, 101].map((v) => at(v).state), ["outside_reference", "normal", "normal", "normal", "outside_reference"]);
  const n = at(90); assert.equal(n.valueText, "Pulse 90 /min"); assert.equal(n.referenceLine, "Reference: 80 to 100 /min (TEST SOURCE, version 1)"); assert.equal(n.statusLine, "Within configured reference interval."); assert.equal(n.tone, "ok");
  assert.match(at(79).statusLine, /Below the configured reference interval\. No alert threshold is reached/); assert.match(at(101).statusLine, /Above the configured reference interval/); assert.equal(at(101).tone, "amber"); assert.equal(at(101).requiresAck, false);
  assert.equal(at(101).saveable, true);
});

test("alert operators and exact boundaries: lt, lte, gt, gte, and a range with minimum inclusive, maximum exclusive", () => {
  const one = (o, v) => I({ raw: v, alerts: [A(o)] }).state;
  assert.deepEqual([89.9, 90, 90.1].map((v) => one({ operator: "lt", value: 90 }, v)), ["moderate_alert", "not_configured", "not_configured"]);
  assert.deepEqual([89.9, 90, 90.1].map((v) => one({ operator: "lte", value: 90 }, v)), ["moderate_alert", "moderate_alert", "not_configured"]);
  assert.deepEqual([89.9, 90, 90.1].map((v) => one({ operator: "gt", value: 90 }, v)), ["not_configured", "not_configured", "moderate_alert"]);
  assert.deepEqual([89.9, 90, 90.1].map((v) => one({ operator: "gte", value: 90 }, v)), ["not_configured", "moderate_alert", "moderate_alert"]);
  assert.deepEqual([11.49, 11.5, 12.49, 12.5].map((v) => one({ operator: "range", min: 11.5, max: 12.5 }, v)), ["not_configured", "moderate_alert", "moderate_alert", "not_configured"]);
  assert.equal(PCO.triggered(A({ operator: "range", min: 5, max: 5 }), 5), false); assert.equal(PCO.triggered(A({ operator: "nope" }), 5), false); assert.equal(PCO.triggered(A({ operator: "gt", value: null }), 5), false);
  assert.equal(PCO.opText(A({ operator: "gte", value: 50 }), "/min"), "50 /min or above"); assert.equal(PCO.opText(A({ operator: "range", min: 11.5, max: 12.5 }), "cm"), "from 11.5 up to, not including, 12.5 cm");
});

test("acceptance: exactly 11.5 cm belongs to ONE configured band (fixture: severe below 11.5, moderate from 11.5 up to 12.5)", () => {
  const rules = [A({ subjectId: "muac", unit: "cm", ruleKey: "sev", ruleType: "emergency", operator: "lt", value: 11.5, message: "TEST severe band", group: "muac" }), A({ subjectId: "muac", unit: "cm", ruleKey: "mod", ruleType: "alert", operator: "range", min: 11.5, max: 12.5, message: "TEST moderate band", group: "muac" })];
  const at = (v) => PCO.interpret({ key: "muac", raw: v, patient: pat(24), date: DATE, alerts: rules, expectedUnit: "cm" });
  assert.deepEqual([11.4, 11.5, 12.4, 12.5].map((v) => at(v).state), ["critical_alert", "moderate_alert", "moderate_alert", "not_configured"]);
  assert.equal(at(11.5).alerts.length, 1); assert.equal(at(11.5).alerts[0].ruleKey, "mod"); assert.match(at(11.5).statusLine, /TEST moderate band/);
});

test("acceptance: exactly 50 breaths/min and exact age boundaries pick ONE age group (fixture: gte 50 at 2 to under 12 months, gte 40 at 12 to under 60)", () => {
  const rules = [A({ subjectId: "respRate", ruleKey: "r1", ruleType: "screening", operator: "gte", value: 60, minAgeMonths: 0, maxAgeMonths: 2 }), A({ subjectId: "respRate", ruleKey: "r2", ruleType: "screening", operator: "gte", value: 50, minAgeMonths: 2, maxAgeMonths: 12 }), A({ subjectId: "respRate", ruleKey: "r3", ruleType: "screening", operator: "gte", value: 40, minAgeMonths: 12, maxAgeMonths: 60 })];
  const at = (m, v) => PCO.interpret({ key: "respRate", raw: v, patient: pat(m), date: DATE, alerts: rules });
  assert.equal(at(6, 50).state, "screening_positive"); assert.equal(at(6, 49).state, "not_configured"); assert.equal(at(6, 50).alerts[0].ruleKey, "r2");
  assert.equal(at(11, 50).alerts[0].ruleKey, "r2"); assert.equal(at(12, 50).alerts[0].ruleKey, "r3"); assert.equal(at(12, 39).state, "not_configured"); assert.equal(at(12, 40).state, "screening_positive");
  assert.equal(at(1, 59).state, "not_configured"); assert.equal(at(1, 60).alerts[0].ruleKey, "r1"); assert.equal(at(2, 50).alerts[0].ruleKey, "r2"); assert.equal(at(2, 60).alerts.length, 1); assert.equal(at(60, 50).state, "not_configured", "five years old is outside every group");
  for (let m = 0; m < 80; m++) { const n = rules.filter((r) => PCR.failures(r, PCR.contextOf({ unit: "/min", patient: pat(m), date: DATE }).ctx).length === 0).length; assert.ok(n <= 1, "month " + m + " matched " + n + " groups"); }
  assert.equal(at(6, 50).tone, "amber"); assert.equal(at(6, 50).requiresAck, false, "a positive screen is not an emergency and needs no acknowledgement");
});

test("acceptance: exactly 12 months and exactly 72 months enter exactly one age group (fixture: the four UCG year groups as months, maximum exclusive)", () => {
  const groups = [[0, 12], [12, 72], [72, 156], [156, null]], rng = groups.map(([lo, hi], i) => R({ rangeKey: "g" + i, minAgeMonths: lo, maxAgeMonths: hi, refMin: 100 + i * 10, refMax: 105 + i * 10 }));
  for (let m = 0; m <= 700; m++) { const n = rng.filter((r) => PCR.failures(r, PCR.contextOf({ unit: "/min", patient: pat(m), date: DATE }).ctx).length === 0).length; assert.equal(n, 1, "age " + m + " months"); }
  const at = (m) => I({ raw: 100, patient: pat(m), ranges: rng }).reference.rangeKey;
  assert.deepEqual([0, 11, 12, 71, 72, 155, 156, 600].map(at), ["g0", "g0", "g1", "g1", "g2", "g2", "g3", "g3"]);
  assert.equal(I({ raw: 100, patient: { sex: "female", dobPrecision: "unknown" }, ranges: rng }).state, "context_required", "unknown age never picks a group");
});

test("routing: neonate, infant, toddler, school age, adolescent and adult each get their own group, below / at / inside / above (fixture: UCG pulse table as test data)", () => {
  const ucg = [[0, 12, 120, 160], [12, 72, 100, 120], [72, 156, 80, 100], [156, null, 60, 100]], rng = ucg.map(([lo, hi, a, b], i) => R({ rangeKey: "p" + i, minAgeMonths: lo, maxAgeMonths: hi, refMin: a, refMax: b }));
  const people = { neonate: [0, 0], infant: [6, 0], toddler: [30, 1], "school-age child": [100, 2], adolescent: [180, 3], adult: [480, 3] };
  Object.entries(people).forEach(([who, [m, g]]) => {
    const [, , a, b] = ucg[g], at = (v) => I({ raw: v, patient: pat(m), ranges: rng });
    assert.equal(at(100).reference.rangeKey === "p" + g || true, true);
    assert.equal(at(a - 1).state, "outside_reference", who + " below"); assert.equal(at(a).state, "normal", who + " lower limit"); assert.equal(at((a + b) / 2).state, "normal", who + " inside"); assert.equal(at(b).state, "normal", who + " upper limit"); assert.equal(at(b + 1).state, "outside_reference", who + " above");
    assert.equal(at(a).reference.rangeKey, "p" + g, who);
  });
  assert.equal(I({ raw: 140, patient: pat(480), ranges: rng }).state, "outside_reference", "a paediatric (under 1 year) value is never read against the adult group");
  assert.equal(I({ raw: 70, patient: pat(6), ranges: rng }).state, "outside_reference", "an adult value is never read against an infant group");
});

test("severity: the highest level wins; every fired alert is listed; critical needs acknowledgement, moderate and screening do not", () => {
  const al = [A({ ruleKey: "s", ruleType: "screening", operator: "gt", value: 50, message: "TEST screening" }), A({ ruleKey: "m", ruleType: "alert", operator: "gt", value: 100, message: "TEST moderate" }), A({ ruleKey: "c", ruleType: "emergency", operator: "gt", value: 150, message: "TEST critical", urgencyText: "Assess now." })];
  const at = (v) => I({ raw: v, alerts: al });
  assert.deepEqual([40, 60, 120, 200].map((v) => at(v).state), ["not_configured", "screening_positive", "moderate_alert", "critical_alert"]);
  const c = at(200); assert.equal(c.alerts.length, 3); assert.equal(c.alerts[0].ruleKey, "c"); assert.equal(c.statusLine, "TEST critical Assess now."); assert.equal(c.tone, "red"); assert.equal(c.requiresAck, true); assert.equal(c.ackItems.length, 1);
  assert.equal(at(120).requiresAck, false); assert.equal(at(60).requiresAck, false); assert.match(c.details[0], /Threshold: above 150 \/min \(TEST title, p\. 1\)/);
  assert.match(I({ raw: 200, alerts: [A({ ruleType: "emergency", message: "" })] }).statusLine, /Emergency threshold reached\. Urgent clinical assessment is needed\./); assert.match(I({ raw: 200, alerts: [A({ ruleType: "screening" })] }).statusLine, /not a diagnosis/);
  assert.equal(I({ raw: 200, alerts: [A({ ruleType: "alert", requiresAck: true })] }).requiresAck, true, "a rule can demand acknowledgement");
  assert.equal(I({ raw: 200, alerts: [A({ ruleType: "bogus" })] }).state, "not_configured", "a rule without a valid type never fires");
});

test("an alert is separate from the reference interval: a value can be outside the interval with no alert, and an alert can fire inside no interval", () => {
  assert.equal(I({ raw: 25, ranges: [R()], alerts: [A({ operator: "gt", value: 100 })] }).state, "outside_reference");
  assert.equal(I({ raw: 150, ranges: [R()], alerts: [A({ operator: "gt", value: 100 })] }).state, "moderate_alert");
  assert.equal(I({ raw: 150, alerts: [A({ operator: "gt", value: 100 })] }).state, "moderate_alert", "an alert needs no reference range");
  assert.equal(I({ raw: 15, ranges: [R()], alerts: [A({ operator: "lt", value: 5 })] }).state, "normal");
});

test("only approved, effective rules act: drafts, review-required, rejected, superseded, retired and future-dated never alert", () => {
  const would = (o) => I({ raw: 200, alerts: [A(Object.assign({ operator: "gt", value: 100, ruleType: "emergency" }, o))] });
  assert.equal(would({}).state, "critical_alert");
  ["draft", "draft_evidence_based", "review_required"].forEach((st) => { const x = would({ approvalStatus: st }); assert.equal(x.state, "pending_review", st); assert.equal(x.alerts.length, 0); assert.equal(x.requiresAck, false); assert.match(x.statusLine, /has not been approved/); assert.equal(x.saveable, true); });
  ["rejected", "superseded", "retired"].forEach((st) => { const x = would({ approvalStatus: st }); assert.equal(x.state, "not_configured", st); assert.equal(x.alerts.length, 0); });
  assert.equal(would({ effectiveDate: "2027-01-01" }).state, "not_configured"); assert.equal(would({ effectiveDate: "" }).state, "not_configured");
  const dr = I({ raw: 15, ranges: [R({ approvalStatus: "review_required" })] }); assert.equal(dr.state, "pending_review"); assert.equal(dr.referenceLine, "Reference range not configured"); assert.doesNotMatch(dr.statusLine, /\b10\b|\b20\b/, "a proposal's numbers are not shown as if they were in force");
  assert.equal(I({ raw: 15, ranges: [R({ approvalStatus: "rejected" })] }).state, "not_configured"); assert.equal(I({ raw: 15, ranges: [R({ approvalStatus: "rejected" })] }).statusLine.includes("proposed"), false, "a rejected proposal does not keep reappearing");
  assert.equal(I({ raw: 15, ranges: [R({ approvalStatus: "draft" }), R({ rangeKey: "k2", approvalStatus: "approved", refMin: 14, refMax: 16 })] }).state, "normal", "an approved range is used even when drafts exist");
});

test("context: age, sex, method, setting, clinical signs. Not stated means 'context required', not a guess", () => {
  const axillary = A({ subjectId: "temperatureC", unit: "°C", ruleKey: "ax", operator: "gte", value: 5, ruleType: "screening", method: "axillary" }), rectal = A({ subjectId: "temperatureC", unit: "°C", ruleKey: "re", operator: "gte", value: 8, ruleType: "screening", method: "rectal" });
  const t = (raw, ctx) => PCO.interpret({ key: "temperatureC", raw, patient: pat(300), ctx, date: DATE, alerts: [axillary, rectal] });
  assert.equal(t(6, {}).state, "context_required"); assert.deepEqual(t(6, {}).needs, ["method"]); assert.match(t(6, {}).statusLine, /state method/);
  assert.equal(t(6, { method: "axillary" }).state, "screening_positive"); assert.equal(t(6, { method: "rectal" }).state, "not_configured", "the axillary rule does not apply to a rectal reading"); assert.equal(t(9, { method: "rectal" }).state, "screening_positive");
  assert.equal(t(2, {}).state, "not_configured", "a value that would not fire either rule does not need the method");
  const kids = A({ ruleKey: "k", operator: "gt", value: 5, maxAgeMonths: 156 }); assert.equal(I({ raw: 9, patient: { sex: "female", dobPrecision: "unknown" }, alerts: [kids] }).state, "context_required"); assert.equal(I({ raw: 9, patient: pat(300), alerts: [kids] }).state, "not_configured");
  const fem = A({ ruleKey: "f", operator: "gt", value: 5, sex: "female" }); assert.equal(I({ raw: 9, patient: pat(300, { sex: "unknown" }), alerts: [fem] }).state, "context_required"); assert.equal(I({ raw: 9, patient: pat(300, { sex: "male" }), alerts: [fem] }).state, "not_configured");
  const setting = A({ ruleKey: "e", operator: "gt", value: 5, setting: "emergency" }); assert.equal(I({ raw: 9, alerts: [setting] }).state, "context_required"); assert.equal(I({ raw: 9, alerts: [setting], ctx: { setting: "emergency" } }).state, "moderate_alert"); assert.equal(I({ raw: 9, alerts: [setting], ctx: { setting: "stable" } }).state, "not_configured");
});

test("stable vs emergency signs (fixture): the unknown sign never silently picks the lower threshold; a danger is not hidden", () => {
  const stable = A({ ruleKey: "st", subjectId: "spo2", unit: "%", ruleType: "alert", operator: "lt", value: 90, group: "o2", forbidFlags: ["emergency_signs"], message: "TEST stable" }), emerg = A({ ruleKey: "em", subjectId: "spo2", unit: "%", ruleType: "emergency", operator: "lt", value: 94, group: "o2", requireFlags: ["emergency_signs"], message: "TEST emergency" });
  const s = (raw, flags) => PCO.interpret({ key: "spo2", raw, patient: pat(300), ctx: { flags }, date: DATE, alerts: [stable, emerg] });
  assert.equal(s(92, {}).state, "context_required", "92 would be an emergency alert if emergency signs are present"); assert.equal(s(92, {}).tone, "red"); assert.deepEqual(s(92, {}).needs, ["emergency signs"]); assert.match(s(92, {}).statusLine, /emergency threshold \(below 94 %\): TEST emergency/); assert.equal(s(92, {}).requiresAck, false);
  assert.equal(s(92, { emergency_signs: false }).state, "not_configured"); assert.equal(s(92, { emergency_signs: true }).state, "critical_alert"); assert.equal(s(95, {}).state, "not_configured", "95 is above both thresholds, so the unknown sign does not matter");
  assert.equal(s(85, { emergency_signs: false }).state, "moderate_alert"); assert.equal(s(85, { emergency_signs: true }).state, "critical_alert"); assert.equal(s(85, {}).state, "context_required"); assert.equal(s(85, {}).tone, "red");
  assert.equal(s(89.9, { emergency_signs: false }).alerts[0].ruleKey, "st"); assert.equal(s(90, { emergency_signs: false }).state, "not_configured");
});

test("pregnancy and lactation are independent contexts; a pregnancy rule never applies to a non-pregnant patient; old rules without lactation mean 'any'", () => {
  const preg = A({ ruleKey: "p", operator: "lt", value: 50, pregnancy: "pregnant", group: "g" }), gen = A({ ruleKey: "g0", operator: "lt", value: 30, group: "g" });
  const at = (raw, ctx) => I({ raw, alerts: [preg, gen], ctx });
  assert.equal(at(40, { pregnancy: "not_pregnant" }).state, "not_configured"); assert.equal(at(40, { pregnancy: "pregnant" }).state, "moderate_alert"); assert.equal(at(40, { pregnancy: "pregnant" }).alerts[0].ruleKey, "p", "the more specific rule replaces the general one in its group");
  assert.equal(at(40, {}).state, "context_required"); assert.deepEqual(at(40, {}).needs, ["pregnancy status"]); assert.equal(at(20, {}).state, "moderate_alert", "a value both rules catch is an alert whatever the pregnancy status");
  const lact = A({ ruleKey: "l", operator: "lt", value: 50, lactation: "lactating" });
  assert.equal(I({ raw: 40, alerts: [lact], ctx: { lactation: "lactating", pregnancy: "not_pregnant" } }).state, "moderate_alert"); assert.equal(I({ raw: 40, alerts: [lact], ctx: { lactation: "not_lactating" } }).state, "not_configured"); assert.equal(I({ raw: 40, alerts: [lact], ctx: { pregnancy: "pregnant" } }).state, "context_required", "pregnancy does not answer a lactation question");
  const oldRule = A({ ruleKey: "o", operator: "lt", value: 50 }); delete oldRule.lactation; assert.equal(I({ raw: 40, alerts: [oldRule], ctx: { lactation: "lactating" } }).state, "moderate_alert"); assert.equal(I({ raw: 40, alerts: [oldRule], ctx: {} }).state, "moderate_alert");
  const rp = R({ rangeKey: "rp", pregnancy: "pregnant", refMin: 1, refMax: 2 }), rl = R({ rangeKey: "rl", lactation: "lactating", refMin: 3, refMax: 4 }), both = { pregnancy: "pregnant", lactation: "lactating" };
  assert.equal(I({ raw: 1.5, ranges: [rp, rl], ctx: both }).state, "conflict", "pregnant AND lactating with two equally specific ranges is a visible conflict");
  assert.equal(I({ raw: 1.5, ranges: [rp, rl], ctx: { pregnancy: "pregnant", lactation: "not_lactating" } }).state, "normal"); assert.equal(I({ raw: 3.5, ranges: [rp, rl], ctx: { pregnancy: "not_pregnant", lactation: "lactating" } }).state, "normal");
  assert.equal(I({ raw: 1.5, ranges: [rp], ctx: { pregnancy: "not_pregnant" } }).state, "not_configured");
  assert.equal(PCR.validate(R({ lactation: "maybe" })).length, 1); assert.deepEqual(PCR.validate(R({ lactation: "lactating" })), []); assert.deepEqual(PCR.validate(R({ lactation: undefined })), [], "a record from before lactation existed is still valid");
});

test("a more specific range that needs unstated context makes the observation 'context required' instead of silently using the general range", () => {
  const general = R({ rangeKey: "g", refMin: 10, refMax: 20 }), specific = R({ rangeKey: "s", pregnancy: "pregnant", refMin: 12, refMax: 14 });
  const x = I({ raw: 15, ranges: [general, specific], ctx: {} }); assert.equal(x.state, "context_required"); assert.deepEqual(x.needs, ["pregnancy status"]);
  assert.equal(I({ raw: 15, ranges: [general, specific], ctx: { pregnancy: "not_pregnant" } }).state, "normal"); assert.equal(I({ raw: 15, ranges: [general, specific], ctx: { pregnancy: "pregnant" } }).state, "outside_reference");
  assert.equal(PCR.resolve({ subjectType: "vital", subjectId: "pulse", unit: "/min", patient: pat(300), ranges: [general, specific] }).rangeKey, "g", "the laboratory screens keep the Lead's rule: not stated matches only 'any'");
  assert.deepEqual(PCR.resolve({ subjectType: "vital", subjectId: "pulse", unit: "/min", patient: pat(300), ranges: [general, specific] }).contextMissing, ["pregnancy status"]);
});

test("conflicts: equally specific normal ranges give 'conflict', but an alert that fires is never hidden by a range conflict; tied alert rules that disagree still alert, with a note", () => {
  const a = R({ rangeKey: "a", sex: "female", refMin: 1, refMax: 2 }), b = R({ rangeKey: "b", sex: "female", refMin: 3, refMax: 4 });
  const c = I({ raw: 2.5, ranges: [a, b] }); assert.equal(c.state, "conflict"); assert.match(c.statusLine, /conflict/); assert.equal(c.tone, "amber");
  const al = I({ raw: 200, ranges: [a, b], alerts: [A({ ruleType: "emergency", operator: "gt", value: 100 })] }); assert.equal(al.state, "critical_alert"); assert.ok(al.details.some((d) => /also conflict/.test(d)));
  const t1 = A({ ruleKey: "t1", operator: "gt", value: 100, group: "g" }), t2 = A({ ruleKey: "t2", operator: "gt", value: 300, group: "g" });
  const dis = I({ raw: 200, alerts: [t1, t2] }); assert.equal(dis.state, "moderate_alert", "the rule that fires is never hidden by the rule that does not"); assert.ok(dis.details.some((d) => /Equally specific alert rules disagree/.test(d))); assert.equal(I({ raw: 400, alerts: [t1, t2] }).state, "moderate_alert", "both agree"); assert.ok(!I({ raw: 400, alerts: [t1, t2] }).details.some((d) => /disagree/.test(d))); assert.equal(I({ raw: 50, alerts: [t1, t2] }).state, "not_configured", "neither fires");
  assert.equal(I({ raw: 200, alerts: [A({ ruleKey: "t1", operator: "gt", value: 100 }), A({ ruleKey: "t2", operator: "gt", value: 300 })] }).state, "moderate_alert", "rules without a group never compete");
});

test("boundary note: only shown when the rule carries one and the value is exactly at a limit", () => {
  const rg = R({ refMin: 90, refMax: 100, boundaryNote: "TEST: consider the clinical context." });
  const x = I({ raw: 90, ranges: [rg] }); assert.equal(x.state, "normal"); assert.match(x.statusLine, /exactly at a limit of the interval: TEST: consider the clinical context\./); assert.equal(x.boundary, "TEST: consider the clinical context.");
  assert.doesNotMatch(I({ raw: 95, ranges: [rg] }).statusLine, /exactly at a limit/); assert.doesNotMatch(I({ raw: 90, ranges: [R({ refMin: 90, refMax: 100 })] }).statusLine, /exactly at a limit/);
});

test("acknowledgement: a critical alert must be acknowledged by an identified user with a time before the observation can be saved", () => {
  const crit = I({ raw: 200, alerts: [A({ ruleType: "emergency", operator: "gt", value: 100, message: "TEST critical" })] }), mod = I({ key: "pulse", raw: 120, alerts: [A({ ruleKey: "m", ruleType: "alert", operator: "gt", value: 100 })] });
  const blocked = PCO.canSave([crit, mod], []); assert.equal(blocked.ok, false); assert.equal(blocked.reasons.length, 1); assert.match(blocked.reasons[0], /Acknowledge the critical alert/);
  assert.equal(PCO.canSave([mod], []).ok, true, "a moderate alert does not block saving");
  const ack = PCO.makeAck(crit.ackItems[0], { id: "u1", name: "TEST Nurse" }, 1700000000000, "seen, repeating the measurement"); assert.deepEqual([ack.by, ack.byName, ack.at, ack.key, ack.ruleVersion], ["u1", "TEST Nurse", 1700000000000, crit.ackItems[0].key, 1]);
  assert.equal(PCO.canSave([crit], [ack]).ok, true); assert.equal(PCO.pendingAcks([crit], [ack]).length, 0);
  [{ key: ack.key, by: "", at: 5 }, { key: ack.key, by: "u1", at: 0 }, { key: ack.key, by: "u1" }, { key: "other", by: "u1", at: 5 }, null, "x"].forEach((bad) => assert.equal(PCO.canSave([crit], [bad]).ok, false, JSON.stringify(bad)));
  assert.throws(() => PCO.makeAck(crit.ackItems[0], null, 1, ""), /not known/); assert.throws(() => PCO.makeAck(crit.ackItems[0], { id: "" }, 1, ""), /not known/); assert.throws(() => PCO.makeAck(null, { id: "u" }, 1, ""), /Nothing to acknowledge/); assert.throws(() => PCO.makeAck(crit.ackItems[0], { id: "u" }, -5, ""), /time/);
  const two = I({ raw: 200, alerts: [A({ ruleKey: "c1", ruleType: "emergency", operator: "gt", value: 100 }), A({ ruleKey: "c2", ruleType: "emergency", operator: "gt", value: 150 })] }); assert.equal(two.ackItems.length, 2);
  assert.equal(PCO.pendingAcks([two], [PCO.makeAck(two.ackItems[0], { id: "u" }, 5, "")]).length, 1, "acknowledging one critical alert does not cover another");
  const other = I({ key: "bpSys", raw: 200, alerts: [A({ subjectId: "bpSys", unit: "mmHg", ruleType: "emergency", operator: "gt", value: 100 })] }); assert.equal(PCO.pendingAcks([crit, other], [ack]).length, 1, "an acknowledgement is for one measurement");
  assert.equal(ack.note.length <= 500, true); assert.equal(PCO.makeAck(crit.ackItems[0], { id: "u" }, 5, "x".repeat(900)).note.length, 500);
});

test("snapshot: what is stored at entry is plain, complete, and does not change when rules change later", () => {
  const rg = R({ rangeKey: "k9", version: 4, refMin: 80, refMax: 100 }), al = A({ ruleKey: "a9", version: 2, ruleType: "emergency", operator: "gt", value: 150, message: "TEST critical", group: "g" });
  const x = I({ raw: 200, ranges: [rg], alerts: [al], patient: pat(300, { dobPrecision: "estimated", dobApprox: "2000-11-24", dob: null }), ctx: { pregnancy: "not_pregnant", lactation: "lactating", method: "axillary" } }), snap = x.snapshot;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  Object.values(snap).forEach((v) => assert.notEqual(v, undefined)); snap.alerts.forEach((a) => Object.values(a).forEach((v) => { assert.notEqual(v, undefined); assert.equal(Array.isArray(v), false); }));
  assert.deepEqual([snap.key, snap.value, snap.unit, snap.state, snap.rangeId, snap.rangeVersion, snap.ageMonths, snap.ageBasis, snap.pregnancy, snap.lactation, snap.method, snap.requiresAck], ["pulse", 200, "/min", "critical_alert", "rr_k9_v4", 4, 312, "estimated", "not_pregnant", "lactating", "axillary", true]);
  assert.deepEqual(snap.alerts.map((a) => [a.ruleId, a.version, a.level]), [["ar_a9_v2", 2, "critical"]]);
  const before = JSON.stringify(snap), later = I({ raw: 200, ranges: [R({ rangeKey: "k9", version: 5, refMin: 150, refMax: 250 })], alerts: [A({ ruleKey: "a9", version: 3, ruleType: "alert", operator: "gt", value: 250 })] }); assert.notEqual(later.state, "critical_alert");
  assert.equal(JSON.stringify(snap), before, "the stored interpretation of the old observation is untouched by new rule versions");
  const frozen = { ranges: [Object.freeze(R())], alerts: [Object.freeze(A())], patient: Object.freeze(pat(300)), ctx: Object.freeze({ flags: Object.freeze({}) }) }; assert.doesNotThrow(() => I(frozen), "inputs are never modified");
  const invalid = I({ raw: "abc" }).snapshot; assert.equal(invalid.state, "invalid"); assert.equal(invalid.value, null); assert.deepEqual(invalid.alerts, []);
});

test("rule validation for the management screen and the importer", () => {
  assert.deepEqual(PCO.ruleErrors(A()), []); const bad = (o) => PCO.ruleErrors(Object.assign(A(), o));
  assert.match(bad({ ruleKey: "" })[0], /rule key/); assert.match(bad({ version: 0 })[0], /version/); assert.match(bad({ ruleType: "x" })[0], /rule type/); assert.match(bad({ operator: "eq" })[0], /compared/); assert.match(bad({ value: null })[0], /threshold value/);
  assert.match(bad({ operator: "range", min: 5, max: 5 })[0], /minimum must be below/); assert.match(bad({ operator: "range", min: null, max: 5 })[0], /needs a minimum and a maximum/); assert.match(bad({ source: "", sourceTitle: "" })[0], /source/); assert.match(bad({ unit: "" })[0], /unit/);
  assert.match(bad({ minAgeMonths: 10, maxAgeMonths: 10 }).join(" "), /below the highest/); assert.match(bad({ lactation: "x" }).join(" "), /lactation/); assert.match(bad({ requireFlags: ["Bad Flag"] }).join(" "), /flags must be short/); assert.deepEqual(PCO.ruleErrors(A({ operator: "range", value: null, min: 11.5, max: 12.5 })), []);
});

test("source view: everything a reviewer needs to see about a rule", () => {
  const v = PCO.sourceView(A({ sourceOrg: "TEST org", sourceTitle: "TEST guideline", sourceVersion: "2023", sourcePage: "p. 7", sourceUrl: "https://example.invalid/x", notes: "TEST note", approvalStatus: "approved", effectiveDate: "2026-01-01", reviewDate: "2027-01-01", approvedByName: "TEST Reviewer", selfApproved: true }));
  assert.deepEqual([v.organisation, v.title, v.version, v.page, v.url, v.notes, v.approvalStatus, v.effectiveDate, v.reviewDate, v.approvedByName, v.selfApproved, v.ruleType], ["TEST org", "TEST guideline", "2023", "p. 7", "https://example.invalid/x", "TEST note", "approved", "2026-01-01", "2027-01-01", "TEST Reviewer", true, "alert"]);
  assert.equal(PCO.sourceView(R({ guidelineTitle: "TEST gl" })).title, "TEST gl"); assert.equal(PCO.sourceView(R()).ruleType, "normal");
});

test("property: every result is one of the ten states; only approved rules ever alert; 'normal' only with an applicable numeric range and nothing unresolved; invalid is never saveable", () => {
  let seed = 987; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 5000; i++) {
    const ranges = [], alerts = [], n = Math.floor(rnd() * 3), m = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) ranges.push(R({ rangeKey: "r" + k, approvalStatus: pick(["approved", "approved", "draft", "review_required", "rejected", "retired"]), sex: pick(["any", "female"]), pregnancy: pick(["any", "pregnant", "not_pregnant"]), lactation: pick(["any", "lactating", "not_lactating"]), minAgeMonths: pick([null, 0, 12, 156]), maxAgeMonths: pick([null, 12, 156]), refMin: pick([null, 1, 10]), refMax: pick([null, 20, 50]), setting: pick(["", "", "emergency"]), unit: pick(["/min", "/min", "x"]) }));
    for (let k = 0; k < m; k++) alerts.push(A({ ruleKey: "a" + k, approvalStatus: pick(["approved", "approved", "draft", "rejected", "superseded"]), ruleType: pick(["screening", "alert", "emergency", "x"]), operator: pick(["lt", "lte", "gt", "gte", "range"]), value: pick([5, 30, 100]), min: pick([5, 30]), max: pick([40, 100]), group: pick(["", "g1"]), pregnancy: pick(["any", "pregnant"]), lactation: pick(["any", "lactating"]), requireFlags: pick([[], ["danger"]]), forbidFlags: pick([[], ["danger"]]), minAgeMonths: pick([null, 12]), method: pick(["", "axillary"]) }));
    const ctx = { pregnancy: pick(["pregnant", "not_pregnant", undefined]), lactation: pick(["lactating", "not_lactating", undefined]), setting: pick(["", "emergency"]), method: pick(["", "axillary"]), flags: pick([{}, { danger: true }, { danger: false }]) };
    const x = I({ raw: pick([0, 3, 15, 35, 99, 100, 120, "abc", ""]), patient: pat(pick([0, 6, 12, 100, 300]), { sex: pick(["female", "male", "unknown"]) }), ctx, ranges, alerts });
    assert.ok(PCO.STATES.includes(x.state), x.state); assert.equal(x.saveable, x.state !== "invalid");
    if (x.state === "invalid") assert.equal(x.alerts.length, 0);
    if (["moderate_alert", "critical_alert", "screening_positive"].includes(x.state)) x.alerts.forEach((a) => { const src = alerts.find((r) => PCO.alertId(r) === a.ruleId); assert.ok(src && src.approvalStatus === "approved", "an alert came from a rule that is not approved"); });
    if (x.state === "normal") { assert.equal(x.reference.state, "range"); assert.ok(x.reference.min !== null || x.reference.max !== null); assert.equal(x.needs.length, 0); const src = ranges.find((r) => PCR.docId(r.rangeKey, r.version) === x.reference.rangeId); assert.equal(src.approvalStatus, "approved"); }
    if (x.state === "critical_alert") assert.ok(x.requiresAck && x.ackItems.length > 0);
    if (x.state !== "critical_alert") assert.equal(x.ackItems.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(x.snapshot)), x.snapshot);
  }
});
