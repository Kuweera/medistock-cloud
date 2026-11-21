/* Developer 2, Stage 3: journey logic taken straight out of encounters.html (PURE block), not copied.
   The hint (pc_encounters.journey) is only a cache: records win, nothing is forced. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "encounters.html"), "utf8");
const J = new Function(src.slice(src.indexOf("/*PURE-START*/"), src.indexOf("/*PURE-END*/")) + "; return { journeyView, journeyHint, J_NEXT_LABEL, J_WAIT_LABEL };")();
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
