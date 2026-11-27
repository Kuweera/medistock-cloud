/* Developer 2, Stage 3: journey logic taken straight out of encounters.html (PURE block), not copied.
   The hint (pc_encounters.journey) is only a cache: records win, nothing is forced. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "encounters.html"), "utf8");
const J = new Function(src.slice(src.indexOf("/*PURE-START*/"), src.indexOf("/*PURE-END*/")) + "; return { journeyView, journeyHint, J_NEXT_LABEL, J_WAIT_LABEL, stepAction, STEP_OPEN, LINK };")();
const enc = (stage, journey) => ({ stage, journey, status: "open" });
const lab = s => ({ status: s });

test("no hint: stage decides (works for visits created before v20)", () => {
  assert.equal(J.journeyView(enc("registered")).next, "triage"); assert.deepEqual(J.journeyView(enc("registered")).depts, ["triage"]);
  assert.equal(J.journeyView(enc("triaged")).next, "consultation"); assert.deepEqual(J.journeyView(enc("triaged")).depts, ["consultation"]);
  assert.equal(J.journeyView(enc("in_consultation")).next, "none"); assert.deepEqual(J.journeyView(enc("in_consultation")).depts, ["consultation"]);
});
test("a consultation-and-prescription patient is never placed in the laboratory", () => {
  const v = J.journeyView(enc("in_consultation", { v: 1, next: "pharmacy", waiting: [], note: "" }), [], [{ kind: "medicine" }]);
  assert.equal(v.next, "pharmacy"); assert.ok(v.depts.indexOf("laboratory") < 0); assert.deepEqual(v.depts, ["pharmacy"]); assert.equal(v.meds, 1);
});
test("registration straight to consultation skips triage (nothing is forced)", () => {
  const v = J.journeyView(enc("registered", { v: 1, next: "consultation", waiting: [], note: "" }));
  assert.deepEqual(v.depts, ["consultation"]); assert.equal(v.next, "consultation");
});
test("laboratory comes only from real tests; parallel work is supported", () => {
  const v = J.journeyView(enc("in_consultation", { v: 1, next: "investigation", waiting: ["laboratory", "pharmacy"], note: "fasting" }), [lab("requested"), lab("processing"), lab("reviewed")]);
  assert.equal(v.labOpen, 2); assert.deepEqual(v.depts.slice().sort(), ["consultation", "laboratory", "pharmacy"]); assert.equal(v.next, "investigation");
});
test("verified results send the patient back to the clinician queue", () => {
  const v = J.journeyView(enc("in_consultation"), [lab("verified")]);
  assert.equal(v.next, "results_review"); assert.equal(v.toReview, 1); assert.ok(v.depts.indexOf("consultation") >= 0);
});
test("a stale hint is ignored: investigation hint with no tests falls back to the records", () => {
  const v = J.journeyView(enc("in_consultation", { v: 1, next: "investigation", waiting: ["laboratory"], note: "" }), []);
  assert.equal(v.stale, true); assert.equal(v.next, "none"); assert.ok(v.depts.indexOf("laboratory") < 0); assert.deepEqual(v.waiting, []);
  const t = J.journeyView(enc("in_consultation", { v: 1, next: "triage", waiting: [], note: "" }));
  assert.equal(t.stale, true); assert.ok(t.depts.indexOf("triage") < 0);
});
test("a malformed or unknown hint is ignored, never throws", () => {
  for (const bad of [null, "x", {}, { v: 2, next: "pharmacy" }, { v: 1, next: "radiology" }, { v: 1, next: "pharmacy", waiting: "no" }]) {
    const v = J.journeyView(enc("triaged", bad)); assert.equal(v.next === "pharmacy" && !(bad && bad.v === 1 && bad.next === "pharmacy"), false); assert.ok(v.depts.length >= 1);
  }
  assert.deepEqual(J.journeyHint({ journey: { v: 1, next: "pharmacy", waiting: ["laboratory", "bogus", "pharmacy", "treatment", "clinician", "patient"], note: "x".repeat(300) } }).waiting.length, 4);
  assert.equal(J.journeyHint({ journey: { v: 1, next: "pharmacy", note: "x".repeat(300) } }).note.length, 140);
});
test("sent on to pharmacy or treatment leaves the clinician queue unless the clinician is still needed", () => {
  assert.deepEqual(J.journeyView(enc("in_consultation", { v: 1, next: "treatment", waiting: [], note: "" })).depts, ["treatment"]);
  assert.deepEqual(J.journeyView(enc("in_consultation", { v: 1, next: "treatment", waiting: ["clinician"], note: "" })).depts.slice().sort(), ["consultation", "treatment"]);
  assert.deepEqual(J.journeyView(enc("in_consultation", { v: 1, next: "discharge", waiting: [], note: "" })).depts, ["closing"]);
});
test("the choices match the rules v20 enum exactly", () => {
  const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  const nxt = rules.match(/j\.get\('next', ''\) in \[([^\]]*)\]/)[1].match(/'([a-z_]+)'/g).map(x => x.replace(/'/g, ""));
  const wt = rules.match(/hasOnly\(\['laboratory'[^\]]*\]/)[0].match(/'([a-z]+)'/g).map(x => x.replace(/'/g, ""));
  assert.deepEqual(Object.keys(J.J_NEXT_LABEL).sort(), nxt.slice().sort()); assert.deepEqual(Object.keys(J.J_WAIT_LABEL).sort(), wt.slice().sort());
});

// ---- Lead 2026-11-27: prescription-based pharmacy step, "Open [step]" actions, one place for links ----
const rx = s => ({ status: s });
test("a pending prescription puts the patient in the pharmacy queue with no hint (was 'No further step')", () => {
  const v = J.journeyView(enc("in_consultation"), [], [{ kind: "medicine" }], [rx("pending")]);
  assert.equal(v.next, "pharmacy"); assert.equal(v.rxOpen, 1); assert.deepEqual(v.depts.slice().sort(), ["consultation", "pharmacy"]);
  assert.equal(J.journeyView(enc("in_consultation"), [], [], [rx("partially_dispensed")]).next, "pharmacy");
});
test("dispensed, cancelled or superseded prescriptions never put anyone in the pharmacy; a medicine order alone does not either", () => {
  for (const st of ["completed", "cancelled", "superseded", "held"]) assert.equal(J.journeyView(enc("in_consultation"), [], [], [rx(st)]).next, "none");
  assert.equal(J.journeyView(enc("in_consultation"), [], [{ kind: "medicine" }], []).next, "none");
  assert.equal(J.journeyView(enc("registered"), [], [], [rx("pending")]).next, "triage"); // the earlier real step still comes first
});
test("tests still come before the pharmacy; a saved hint still wins when it is not stale", () => {
  assert.equal(J.journeyView(enc("in_consultation"), [lab("requested")], [], [rx("pending")]).next, "investigation");
  assert.equal(J.journeyView(enc("in_consultation"), [lab("verified")], [], [rx("pending")]).next, "results_review");
  assert.equal(J.journeyView(enc("in_consultation", { v: 1, next: "discharge", waiting: [], note: "" }), [], [], [rx("pending")]).next, "discharge");
});
const may = (...keys) => k => keys.indexOf(k) >= 0;
const E = { id: "e 1", patientId: "p1", patientName: "Ann Mary" };
test("link formats are built in ONE place and match what Developer 3 reported", () => {
  assert.equal(J.LINK.visitTab(E, "triage"), "encounter.html?id=e%201&tab=triage");
  assert.equal(J.LINK.pharmacy(E), "pharmacy.html?patient=p1");
  assert.equal(J.LINK.pharmacy({ patientName: "Ann Mary" }), "pharmacy.html?patient=Ann%20Mary");
  const body = src.slice(src.indexOf("/*PURE-START*/"), src.indexOf("/*PURE-END*/")).split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  assert.equal((body.match(/encounter\.html\?id=/g) || []).length, 1); assert.equal((body.match(/pharmacy\.html\?patient=/g) || []).length, 1);
  const rest = src.slice(src.indexOf("/*PURE-END*/")); assert.equal((rest.match(/pharmacy\.html\?patient=/g) || []).length, 0, "no pharmacy address outside LINK");
});
test("every visit-tab link uses a tab Developer 3 accepts, with the same permissions as that tab", () => {
  const enc3 = fs.readFileSync(path.join(__dirname, "..", "encounter.html"), "utf8");
  const tabs = {}; enc3.match(/LINK_TABS = \{[\s\S]*?\};/)[0].replace(/(\w+): \["\w+", "[^"]*", \[([^\]]*)\]\]/g, (m, k, p) => { tabs[k] = p.match(/[a-z.]+/g); });
  assert.deepEqual(Object.keys(tabs).sort(), ["close", "consultation", "diagnosis", "notes", "tests", "treatment", "triage"]);
  Object.keys(J.STEP_OPEN).forEach(step => J.STEP_OPEN[step].forEach(o => {
    const m = /tab=(\w+)/.exec(o.url({ id: "x" })); if (!m) return;
    assert.ok(tabs[m[1]], step + " -> unknown tab " + m[1]);
    tabs[m[1]].forEach(k => assert.ok(o.perms.indexOf(k) >= 0, step + ": " + m[1] + " tab accepts " + k + " but the action does not"));
    o.perms.forEach(k => assert.ok(tabs[m[1]].indexOf(k) >= 0, step + ": action allows " + k + " but the tab does not"));
  }));
});
test("an action is offered only with the permission the target needs", () => {
  const A = (n, ...k) => J.stepAction(n, E, may(...k));
  assert.equal(A("triage", "consult.record"), null); assert.equal(A("triage", "triage.record").url, "encounter.html?id=e%201&tab=triage");
  assert.equal(A("consultation", "consult.record").label, "Open Consultation");
  assert.equal(A("results_review", "investigation.review").url, "encounter.html?id=e%201&tab=tests"); assert.equal(A("results_review", "lab.result"), null);
  assert.equal(A("investigation", "lab.process").url, "laboratory.html"); assert.equal(A("investigation", "investigation.request").label, "Open Tests");
  assert.equal(A("pharmacy", "treatment.prescribe"), null); assert.equal(A("pharmacy", "dispense.view").url, "pharmacy.html?patient=p1");
  assert.equal(A("treatment", "treatment.prescribe").url, "encounter.html?id=e%201&tab=treatment");
  assert.equal(A("discharge", "encounter.close").label, "Open Close visit"); assert.equal(A("follow_up", "encounter.close").url, "encounter.html?id=e%201&tab=close");
  assert.equal(A("none", "encounter.close", "triage.record"), null); assert.equal(J.stepAction("bogus", E, () => true), null);
  assert.equal(J.stepAction("triage", E, () => false), null);
});
