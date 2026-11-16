/* Developer 2, phase 5b: guideline matching, regimens, dismissals, abbreviations, exact-hour schedules. TEST TEXT ONLY (no real clinical content). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const PCG = require("../pc-guidelines.js"), PCAB = require("../pc-abbrev.js"), PCS = require("../pc-sched.js");

const base = (o) => Object.assign(PCG.buildDoc({ title: "Alpha illness", category: "respiratory", symptoms: "cough, chest pain", wDanger: "TEST danger", aQuestions: "TEST question", investigations: "Test X", treatment: "TEST tx", precautions: "TEST precaution", followUp: "TEST follow", sourceTitle: "G", sourceOrg: "O", sourceEdition: "1", sourceRef: "p1", jurisdiction: "U", effectiveDate: "2026-01-01", reviewDate: "2027-12-31", publicationDate: "2023" }, { key: "a", version: 1 }), { approvalStatus: "approved", id: "gl_a_v1" }, o || {});
const ctx = (o) => Object.assign({ ageMonths: 100, sex: "female", weightKg: 20, complaints: [], findings: [], vitals: {}, diagnoses: [], tests: [], medicines: [] }, o || {});

test("abbreviations show their meaning; BD/TDS/QID/PRN/STAT/q12h/q8h as in the plan", () => {
  const want = { OD: "once daily", BD: "twice daily", TDS: "three times daily", QID: "four times daily", PRN: "when required", STAT: "immediately", q12h: "every 12 hours", q8h: "every 8 hours" };
  Object.keys(want).forEach(k => assert.match(PCAB.label(k.toLowerCase()), new RegExp(want[k], "i"), k));
  assert.equal(PCAB.label("zzz"), "zzz");
});
test("an abbreviation fills a PATTERN only; it never carries a dose", () => {
  assert.deepEqual(PCAB.scheduleFor("BD"), { scheduleType: "daily", timesPerDay: 2 }); assert.deepEqual(PCAB.scheduleFor("q8h"), { scheduleType: "interval", everyHours: 8 });
  PCAB.all().forEach(a => { const p = PCAB.scheduleFor(a.abbr); if (p) assert.ok(!("doseValue" in p) && !("dose" in p)); });
});
test("unsafe abbreviations are refused as shortcuts and flagged; OD carries an ambiguity warning", () => {
  ["QD", "QOD", "HS", "U", "IU"].forEach(a => { assert.equal(PCAB.scheduleFor(a), null); assert.equal(PCAB.explain(a).ok, false); assert.match(PCAB.explain(a).text, /UNSAFE|Write/); });
  assert.match(PCAB.explain("OD").text, /right eye/); assert.equal(PCAB.explain("nonsense").ok, false);
});
test("abbreviations inside free text are found and expanded; ordinary words and units are left alone", () => {
  assert.deepEqual(PCAB.find("1 tab TDS PO after meals").map(f => f.entry.a).sort(), ["PO", "TDS", "tab"].sort());
  assert.equal(PCAB.find("take the mane of horse im po").filter(f => f.entry.a === "IM").length, 0, "lower-case short words are not abbreviations");
  assert.equal(PCAB.expandText("Give BD PO"), "Give BD (twice daily) PO (by mouth)");
  assert.equal(PCAB.find("2 mg").length, 0);
});
test("exact elapsed-time schedule: 0, 12 and 24 hours give exactly three events at those times", () => {
  const start = Date.UTC(2026, 10, 16, 7, 0), o = { scheduleType: "elapsed", startAt: start, tz: "Africa/Kampala", sched: { hours: PCS.parseHours("0, 12 and 24").hours } };
  assert.ok(!PCS.validate(o)); const ev = PCS.generate(o);
  assert.deepEqual(ev.map(e => e.plannedAt - start), [0, 12 * 3600e3, 24 * 3600e3]); assert.deepEqual(ev.map(e => e.plannedLocal), ["2026-11-16 10:00", "2026-11-16 22:00", "2026-11-17 10:00"]);
  assert.equal(new Set(ev.map(e => e.idKey)).size, 3, "event ids are unique");
});
test("elapsed schedule supports uneven gaps, fractions and per-time doses, and keeps each dose with its hour", () => {
  const start = Date.UTC(2026, 10, 16, 7, 0), ev = PCS.generate({ scheduleType: "elapsed", startAt: start, tz: "Africa/Kampala", sched: { hours: [6, 0, 30.5], doses: [2, 1, 3] } });
  assert.deepEqual(ev.map(e => [(e.plannedAt - start) / 3600e3, e.doseValue]), [[0, 1], [6, 2], [30.5, 3]]);
});
test("elapsed schedule rejects bad input instead of silently dropping it", () => {
  const o = (h) => ({ scheduleType: "elapsed", startAt: Date.now(), tz: "Africa/Kampala", sched: { hours: h } });
  assert.match(PCS.validate(o([])), /hours after the start/); assert.match(PCS.validate(o([0, 0])), /different/); assert.match(PCS.validate(o([0, NaN])), /different/); assert.match(PCS.validate(o([-1, 5])), /different/); assert.ok(PCS.validate(o([721])), "out of range is refused");
  assert.deepEqual(PCS.parseHours("0, x, 6").bad, ["x"]);
  assert.match(PCS.describe(o([0, 12, 24])), /hour 0, 12, 24/);
});
test("existing schedule types are unchanged (regression): 12-hourly x3 equals 0,12,24 elapsed", () => {
  const start = Date.UTC(2026, 10, 16, 7, 0), a = PCS.generate({ scheduleType: "interval", startAt: start, tz: "Africa/Kampala", sched: { everyHours: 12, count: 3 } }).map(e => e.plannedAt), b = PCS.generate({ scheduleType: "elapsed", startAt: start, tz: "Africa/Kampala", sched: { hours: [0, 12, 24] } }).map(e => e.plannedAt);
  assert.deepEqual(a, b);
});
test("the Firestore rules accept the new schedule type", () => { assert.match(fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"), /scheduleType in \[[^\]]*'elapsed'/); });

test("trigger lines are parsed; unreadable lines are reported in plain words", () => {
  assert.deepEqual(PCG.parseTrigger("vital: spo2 < 94"), { kind: "vital", field: "spo2", op: "<", value: 94, text: "spo2 < 94" });
  assert.equal(PCG.parseTrigger("test: malaria rdt = positive").result, "positive"); assert.equal(PCG.parseTrigger("symptom: cough").kind, "symptom");
  assert.equal(PCG.parseTrigger("vital: mood < 3"), null); assert.equal(PCG.parseTrigger("nonsense"), null);
  assert.match(PCG.triggerProblems(["vital: mood < 3"])[0], /could not be read/);
});
test("match: a recorded complaint finds approved guidance, with the REASON and the source, at the right stages", () => {
  const g = base(), r = PCG.match([g], ctx({ complaints: ["Persistent cough"] }), { stage: "consult" });
  assert.equal(r.length, 1); assert.match(r[0].reasons[0].text, /Complaint recorded: “Persistent cough”/); assert.ok(r[0].g.source);
  assert.deepEqual(r[0].sections.map(s => s.key), ["danger", "questions"]);
  assert.deepEqual(PCG.match([g], ctx({ complaints: ["cough"] }), { stage: "tests" })[0].sections.map(s => s.key), ["tests"]);
  assert.deepEqual(PCG.match([g], ctx({ complaints: ["cough"] }), { stage: "followup" })[0].sections.map(s => s.key), ["followUp"]);
  assert.equal(PCG.match([g], ctx({ complaints: ["headache"] }), { stage: "consult" }).length, 0, "nothing recorded that matches -> nothing shown");
  assert.equal(PCG.match([g], ctx(), { stage: "consult" }).length, 0, "an empty visit shows nothing");
});
test("match: warnings are kept apart from recommendations", () => {
  const s = PCG.match([base()], ctx({ complaints: ["cough"] }), { stage: "treat" })[0].sections;
  assert.equal(s.find(x => x.key === "precautions").kind, "warning"); assert.equal(s.find(x => x.key === "treatment").kind, "recommend"); assert.equal(s.find(x => x.key === "danger").kind, "warning");
});
test("match: only APPROVED, CURRENT, IN-FORCE guidance is ever shown", () => {
  const list = [base({ approvalStatus: "draft", id: "d1", guidelineKey: "d", version: 1 }), base({ approvalStatus: "superseded", id: "s1", guidelineKey: "s" }), base({ approvalStatus: "retired", id: "r1", guidelineKey: "r" }), base({ id: "f1", guidelineKey: "f", effectiveDate: "2999-01-01" })];
  assert.equal(PCG.match(list, ctx({ complaints: ["cough"] }), { stage: "consult" }).length, 0);
  const old = base({ id: "gl_a_v1", version: 1, approvalStatus: "superseded" }), cur = base({ id: "gl_a_v2", version: 2, title: "Alpha v2" });
  assert.deepEqual(PCG.match([old, cur], ctx({ complaints: ["cough"] }), { stage: "consult" }).map(x => x.g.id), ["gl_a_v2"]);
});
test("match: age, weight, sex and pregnancy limits hide guidance that does not fit, and say so when the fact is unknown", () => {
  const g = base({ applicability: { minAgeMonths: 60, maxAgeMonths: 180, sex: "any", pregnancy: "any", minWeightKg: 15, maxWeightKg: null } }), c = { complaints: ["cough"] };
  assert.equal(PCG.match([g], ctx({ ...c, ageMonths: 24 }), { stage: "consult" }).length, 0); assert.equal(PCG.match([g], ctx({ ...c, ageMonths: 200 }), { stage: "consult" }).length, 0);
  assert.equal(PCG.match([g], ctx({ ...c, weightKg: 10 }), { stage: "consult" }).length, 0); assert.equal(PCG.match([g], ctx(c), { stage: "consult" }).length, 1);
  const unk = PCG.match([g], ctx({ ...c, ageMonths: null, weightKg: null }), { stage: "consult" })[0]; assert.equal(unk.notes.length, 2); assert.match(unk.notes.join(" "), /Age is not recorded[\s\S]*Weight is not recorded/);
  const preg = base({ applicability: { pregnancy: "pregnant", sex: "any" } });
  assert.equal(PCG.match([preg], ctx({ ...c, sex: "male" }), { stage: "consult" }).length, 0); assert.equal(PCG.match([preg], ctx({ ...c, pregnancy: false }), { stage: "consult" }).length, 0);
  assert.equal(PCG.match([preg], ctx({ ...c, pregnancy: true }), { stage: "consult" }).length, 1); assert.match(PCG.match([preg], ctx({ ...c, pregnancy: null }), { stage: "consult" })[0].notes[0], /Pregnancy is not recorded/);
});
test("match: vital-sign, test-result, diagnosis and medicine triggers come ONLY from numbers typed from the source", () => {
  const g = base({ symptoms: [], triggers: ["vital: spo2 < 94", "test: malaria rdt = positive", "diagnosis: other topic", "medicine: testmed"] });
  const m = (c) => PCG.match([g], ctx(c), { stage: "consult" });
  assert.equal(m({ vitals: { spo2: 97 } }).length, 0); assert.match(m({ vitals: { spo2: 91 } })[0].reasons[0].text, /Oxygen saturation recorded as 91/);
  assert.equal(m({ tests: [{ name: "Malaria RDT", result: "Negative" }] }).length, 0); assert.equal(m({ tests: [{ name: "Malaria RDT", result: "Positive" }] }).length, 1);
  assert.equal(m({ tests: ["Malaria RDT"] }).length, 0, "requested but no result yet");
  assert.equal(m({ medicines: ["TestMed 500"] }).length, 1); assert.equal(m({ diagnoses: ["Other topic"] }).length, 1);
});
test("dismissal: stays hidden until a NEW reason appears or a newer version is approved", () => {
  const g = base(), it = PCG.match([g], ctx({ complaints: ["cough"] }), { stage: "consult" })[0], d = PCG.dismissRecord(it);
  assert.equal(PCG.shouldShow(undefined, it), true); assert.equal(PCG.shouldShow(d, it), false);
  assert.equal(PCG.shouldShow(d, PCG.match([g], ctx({ complaints: ["cough"], findings: [] }), { stage: "consult" })[0]), false, "same reasons: still hidden");
  assert.equal(PCG.shouldShow(d, PCG.match([g], ctx({ complaints: ["cough", "chest pain"] }), { stage: "consult" })[0]), true, "a new complaint matches: show again");
  assert.equal(PCG.shouldShow(d, PCG.match([Object.assign({}, g, { version: 2 })], ctx({ complaints: ["cough"] }), { stage: "consult" })[0]), true, "new version: show again");
});
test("regimens: shown only when they fit the patient; they pre-fill an order but never complete it", () => {
  const g = base({ regimens: [PCG.cleanRegimen({ label: "R-small", medicine: "TESTmed", doseValue: 1, doseUnit: "tablet", route: "by mouth", frequency: { type: "daily", timesPerDay: 2, days: 3 }, maxWeightKg: 10 }),
    PCG.cleanRegimen({ label: "R-big", medicine: "TESTmed", doseValue: 2, doseUnit: "tablet", route: "by mouth", frequency: { type: "elapsed", hours: [0, 12, 24] }, minWeightKg: 10 })] });
  assert.equal(PCG.regimenProblems(g.regimens).length, 0);
  const t = PCG.match([g], ctx({ complaints: ["cough"], weightKg: 20 }), { stage: "treat" })[0]; assert.deepEqual(t.regimens.map(x => x.r.label), ["R-big"]); assert.equal(t.regimensHidden, 1);
  assert.equal(PCG.match([g], ctx({ complaints: ["cough"], weightKg: 20 }), { stage: "consult" })[0].regimens.length, 0, "regimens appear only when prescribing");
  assert.match(PCG.match([g], ctx({ complaints: ["cough"], weightKg: null }), { stage: "treat" })[0].regimens[0].notes[0], /Weight is not recorded/);
  const pre = PCG.regimenPrefill(t.regimens[0].r); assert.deepEqual(pre.sched, { hours: [0, 12, 24] }); assert.equal(pre.scheduleType, "elapsed"); assert.equal(pre.doseValue, 2);
  const daily = PCG.regimenPrefill(g.regimens[0], { 2: "08:00, 20:00" }); assert.deepEqual(daily.sched.times, ["08:00", "20:00"]); assert.equal(daily.sched.days, 3);
  assert.ok(!PCS.validate(Object.assign({ startAt: Date.now(), tz: "Africa/Kampala" }, { scheduleType: pre.scheduleType, sched: pre.sched })), "a regimen schedule is a valid order schedule");
});
test("regimens missing required details cannot be approved", () => {
  const bad = base({ regimens: [PCG.cleanRegimen({ label: "x", medicine: "m", frequency: { type: "daily" } })] });
  const p = PCG.approvalProblems(bad); assert.ok(p.some(x => /dose/.test(x)) && p.some(x => /unit/.test(x)) && p.some(x => /route/.test(x)) && p.some(x => /times a day/.test(x)));
});
test("a guideline is not approvable without a publication date; applicability and triggers survive a save/edit round trip", () => {
  assert.ok(PCG.approvalProblems(base({ publicationDate: "" })).some(x => /published/.test(x)));
  const f = { title: "T", category: "wound", ageMin: "5", ageMinUnit: "years", ageMax: "12", ageMaxUnit: "years", wMin: "15", sex: "female", pregnancy: "any", triggers: "symptom: x\nvital: pulse > 100", regimens: [{ medicine: "m", doseValue: "1", doseUnit: "u", route: "r", frequency: { type: "once" } }] };
  const d1 = PCG.buildDoc(f, { key: "k", version: 1 }), d2 = PCG.buildDoc(PCG.toForm(d1), { key: "k", version: 1 });
  assert.deepEqual(d2, d1); assert.equal(d1.applicability.minAgeMonths, 60); assert.equal(d1.applicability.maxAgeMonths, 144);
  assert.ok(PCG.draftProblems(PCG.buildDoc({ title: "T", category: "wound", triggers: "vital: mood < 3" })).length, "bad trigger blocks saving");
});
test("the library code still contains no clinical content", () => {
  ["pc-guidelines.js", "pc-abbrev.js", "pc-guidance-ui.js"].forEach(f => assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), /\b\d+\s?(mg|mcg|ml|mmHg)\b/i, f));
});
