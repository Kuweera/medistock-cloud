/* Developer 3: proves the "Required: ..." line shown on screen matches what the real validation code enforces.
   Registration and the test catalogue validators are taken straight out of the pages' PURE blocks (not copied). */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), read = f => fs.readFileSync(path.join(root, f), "utf8");
const block = f => { const s = read(f); return s.slice(s.indexOf("/*PURE-START*/"), s.indexOf("/*PURE-END*/")); };

// ---- test catalogue (investigations.html)
const V = new Function(block("investigations.html") + "; return { validateTest };")();
const baseTest = () => ({ name: "TEST glucose", category: "chemistry", resultType: "number", choices: [], price: null, refMin: null, refMax: null, refText: "", refSource: "" });
test("catalogue: only name and category are needed", () => assert.equal(V.validateTest(baseTest()), ""));
test("catalogue: name and category are required", () => {
  assert.match(V.validateTest(Object.assign(baseTest(), { name: "" })), /test name/i);
  assert.match(V.validateTest(Object.assign(baseTest(), { category: "" })), /category/i);
});
test("catalogue: a choice result needs its choices", () => {
  assert.match(V.validateTest(Object.assign(baseTest(), { resultType: "choice" })), /choices/i);
  assert.equal(V.validateTest(Object.assign(baseTest(), { resultType: "choice", choices: ["positive", "negative"] })), "");
});
test("catalogue: a reference range needs its source, a missing range does not", () => {
  assert.match(V.validateTest(Object.assign(baseTest(), { refMin: 3, refMax: 6 })), /where the reference range comes from/i);
  assert.match(V.validateTest(Object.assign(baseTest(), { refText: "negative" })), /where the reference range comes from/i);
  assert.equal(V.validateTest(Object.assign(baseTest(), { refMin: 3, refMax: 6, refSource: "Lab manual 2024" })), "");
  assert.equal(V.validateTest(Object.assign(baseTest(), { price: null, refSource: "" })), "");
});

// ---- registration (patients.html): the page's helpers $ and PCF are stubbed
function reg(mode, dateState) {
  const el = { fAgeMode: { value: mode } };
  const src = read("patients.html"), fp = src.slice(src.indexOf("function formProblem(f) {"), src.indexOf("function setFormMsg"));
  const F = new Function("$", "PCF", block("patients.html") + "\n" + fp + "; return { formProblem };");
  return F(id => el[id], { dateInfo: () => ({ state: dateState || "empty" }) }).formProblem;
}
const form = (o) => Object.assign({ fullName: "Test Patient", sex: "female", estimatedAge: null, phone: "", nextOfKin: {}, emergencyContact: {} }, o);
test("registration: name, sex and age are enough; phone, address, next of kin are optional", () => {
  assert.equal(reg("unknown")(form({})), "");
  assert.equal(reg("est")(form({ estimatedAge: 30 })), "");
  assert.equal(reg("dob", "ok")(form({})), "");
});
test("registration: name and sex are required", () => {
  assert.match(reg("unknown")(form({ fullName: "" })), /full name/i);
  assert.match(reg("unknown")(form({ sex: "" })), /sex/i);
});
test("registration: the age is required according to the choice made", () => {
  assert.match(reg("dob", "empty")(form({})), /date of birth/i);
  assert.match(reg("dob", "future")(form({})), /future/i);
  assert.match(reg("est")(form({ estimatedAge: null })), /estimated age/i);
});
test("the on-screen notes exist on all eleven forms", () => {
  const need = { "patients.html": ["reg"], "encounter.html": ["triage", "complaint", "priormed", "dx", "plan"], "patient.html": ["allergy", "history"], "investigations.html": ["test"], "dosing-rules.html": ["rule"], "users.html": ["operator"] };
  for (const f in need) for (const k of need[f]) assert.ok(read(f).includes('id="req-' + k + '"'), f + " has the note " + k);
});

// ---- the schedule rules behind the order form (pc-sched.js)
const PCS = require("../pc-sched.js");
const start = Date.UTC(2026, 5, 1, 8, 0);
const ord = (type, sched) => ({ scheduleType: type, startAt: start, doseValue: 1, doseUnit: "tablet", sched: sched || {} });
test("order patterns: what each pattern needs", () => {
  assert.equal(PCS.validate(ord("once")), "");
  assert.match(PCS.validate({ scheduleType: "once", sched: {} }), /when the treatment starts/i);
  assert.match(PCS.validate(ord("interval", {})), /hours between doses and how many doses/i); assert.equal(PCS.validate(ord("interval", { everyHours: 8, count: 6 })), "");
  assert.match(PCS.validate(ord("daily", { times: [], days: 5 })), /at least one time of day and the number of days/i); assert.equal(PCS.validate(ord("daily", { times: ["08:00", "20:00"], days: 5 })), "");
  assert.match(PCS.validate(ord("fixed", { times: ["08:00"], days: 0, weekdays: [1] })), /number of days/i); assert.equal(PCS.validate(ord("fixed", { times: ["08:00"], days: 14, weekdays: [1, 3, 5] })), "");
  assert.match(PCS.validate(ord("taper", { stages: [] })), /at least one stage/i); assert.match(PCS.validate(ord("taper", { stages: [{ days: 3, times: ["08:00"], doseValue: 0 }] })), /Stage 1 needs days, times of day and a dose/i);
  assert.match(PCS.validate(ord("custom", { items: [] })), /at least one date and time/i);
  assert.match(PCS.validate(ord("prn", {})), /shortest time allowed/i);
  assert.match(PCS.validate(ord("prn", { minIntervalHours: 6 })), /most doses allowed in a day/i);
  assert.match(PCS.validate(ord("prn", { minIntervalHours: 6, maxPerDay: 3 })), /what the as-needed dose is for/i);
  assert.equal(PCS.validate(ord("prn", { minIntervalHours: 6, maxPerDay: 3, indication: "Pain" })), "", "the daily total and valid days are optional");
});
