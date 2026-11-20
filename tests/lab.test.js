/* Laboratory profiles, results, workflow, bills and reports (Developer 4). Run: node --test "tests/*.test.js" */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../pc-lab.js");
const mk = c => Object.assign({ id: "o1", name: "T", category: "other" }, L.orderFields(c));
const T = (o) => Object.assign({ name: "Test X", category: "other" }, o);

test("No template supplies a range, unit, price, critical limit or scale meaning", () => {
  L.TEMPLATES.forEach(t => {
    ["units", "refMin", "refMax", "refText", "refSource", "price", "critical"].forEach(k => assert.equal(t[k], undefined, t.name + " must not carry " + k));
    (t.params || []).forEach(p => ["unit", "refMin", "refMax", "refText", "refSource"].forEach(k => assert.equal(p[k], undefined, t.name + "/" + p.label)));
  });
  assert.ok(L.validateTest(L.TEMPLATES.find(t => t.id === "t_urine")), "urinalysis template is incomplete until the facility types its own scale");
});
test("Numeric: required, numeric, flag only from the facility's range", () => {
  const o = mk(T({ resultType: "number", units: "g/dL", refMin: 5, refMax: 10, refSource: "Our analyser manual" }));
  assert.equal(L.buildResult(o, { value: "" }).ok, false); assert.equal(L.buildResult(o, { value: "abc" }).ok, false);
  assert.equal(L.buildResult(o, { value: "12" }).flag, "high"); assert.equal(L.buildResult(o, { value: "7" }).flag, "normal");
  assert.equal(L.buildResult(mk(T({ resultType: "number" })), { value: "7" }).flag, "none", "no range -> no flag");
});
test("A range without a source is refused when the test is saved", () => {
  assert.match(L.validateTest(T({ resultType: "number", refMin: 1, refMax: 2 })), /where the reference range comes from/);
  assert.equal(L.validateTest(T({ resultType: "number", refMin: 1, refMax: 2, refSource: "Manual 2025" })), "");
});
test("Qualitative and categorical: only configured words; blood group needs no number", () => {
  const q = mk(T({ resultType: "qualitative", choices: "Positive, Negative, Invalid" }));
  assert.equal(L.buildResult(q, { value: "Positive" }).ok, true); assert.equal(L.buildResult(q, { value: "Maybe" }).ok, false); assert.equal(L.buildResult(q, {}).ok, false);
  const c = mk(T({ resultType: "categorical", choices: ["A", "B", "AB", "O"] })); assert.equal(L.buildResult(c, { value: "AB" }).value, "AB");
  assert.match(L.validateTest(T({ resultType: "qualitative", choices: "" })), /allowed results/);
});
test("Semi-quantitative: local terms are exactly what the facility typed and nothing is assumed", () => {
  assert.match(L.validateTest(T({ resultType: "semiquant", scale: [] })), /Nothing is filled in/);
  const s = mk(T({ resultType: "semiquant", scale: [{ term: "Tr", meaning: "as per local SOP" }, { term: "Trr" }, { term: "Trrk" }, "1+"] }));
  assert.equal(L.buildResult(s, { value: "Trr" }).ok, true); assert.equal(L.buildResult(s, { value: "Trace" }).ok, false, "'Trace' is not configured here so is refused");
  assert.deepEqual(s.profile.scale.map(x => x.term), ["Tr", "Trr", "Trrk", "1+"]);
});
test("Multi-parameter: separate fields, per-parameter flags, partial entry allowed, summary text for older screens", () => {
  const t = T({ resultType: "multi", params: [
    { label: "Haemoglobin", type: "number", unit: "g/dL", refMin: 10, refMax: 16, refSource: "Manual" }, { label: "Malaria", type: "qualitative", choices: ["Positive", "Negative"] }, { label: "Protein", type: "semiquant", scale: ["Tr", "1+"] }] });
  assert.equal(L.validateTest(t), "");
  const o = mk(t), keys = o.profile.params.map(p => p.key);
  assert.deepEqual(keys, ["haemoglobin", "malaria", "protein"]);
  const r = L.buildResult(o, { params: { haemoglobin: "8", malaria: "Negative", protein: "Tr" } });
  assert.equal(r.ok, true); assert.equal(r.values.haemoglobin.flag, "low"); assert.equal(r.flag, "abnormal"); assert.match(r.value, /Haemoglobin 8 g\/dL; Malaria Negative; Protein Tr/);
  assert.equal(L.buildResult(o, { params: { malaria: "Positive" } }).ok, true, "a panel may be reported in part");
  assert.equal(L.buildResult(o, { params: {} }).ok, false); assert.equal(L.buildResult(o, { params: { malaria: "Maybe" } }).ok, false); assert.equal(L.buildResult(o, { params: { haemoglobin: "x" } }).ok, false);
  assert.match(L.validateTest(T({ resultType: "multi", params: [{ label: "A", type: "number" }, { label: "a", type: "number" }] })), /same name/);
});
test("Titer: numeric dilution or category per the test's method", () => {
  const n = mk(T({ resultType: "titer", titerMode: "numeric" })); assert.equal(L.buildResult(n, { value: "1:80" }).value, "1:80"); assert.equal(L.buildResult(n, { value: "1/160" }).value, "1:160"); assert.equal(L.buildResult(n, { value: "high" }).ok, false);
  const c = mk(T({ resultType: "titer", titerMode: "categorical", choices: "Reactive, Non-reactive" })); assert.equal(L.buildResult(c, { value: "Reactive" }).ok, true); assert.equal(L.buildResult(c, { value: "1:80" }).ok, false);
});
test("Organism and susceptibility: only configured codes; no growth; several organisms", () => {
  const t = T({ resultType: "organism", resultCodes: "S, R", antibiotics: "Amikacin, Ciprofloxacin" }); assert.equal(L.validateTest(t), "");
  assert.match(L.validateTest(T({ resultType: "organism", resultCodes: "" })), /result codes/);
  const o = mk(t);
  assert.equal(L.buildResult(o, { noGrowth: true }).value, "No growth");
  const r = L.buildResult(o, { organisms: [{ name: "E. coli", quantity: "heavy", susceptibility: { Amikacin: "S", Ciprofloxacin: "R" } }, { name: "Klebsiella", susceptibility: { Amikacin: "S" } }] });
  assert.equal(r.ok, true); assert.match(r.value, /E\. coli \(Amikacin S, Ciprofloxacin R\); Klebsiella/); assert.equal(r.values.organisms.length, 2);
  assert.equal(L.buildResult(o, { organisms: [{ name: "E. coli", susceptibility: { Amikacin: "Z" } }] }).ok, false);
  assert.equal(L.buildResult(o, { organisms: [] }).ok, false);
});
test("Free text", () => { const o = mk(T({ resultType: "text" })); assert.equal(L.buildResult(o, { value: " Few pus cells " }).value, "Few pus cells"); assert.equal(L.buildResult(o, { value: " " }).ok, false); });
test("Critical results only when the facility configured limits and a source", () => {
  assert.match(L.validateTest(T({ resultType: "number", critical: { low: 3 } })), /critical/);
  const o = mk(T({ resultType: "number", critical: { low: 3, high: 20, source: "Lab SOP 4.2" } }));
  assert.equal(L.buildResult(o, { value: "2" }).critical, true); assert.equal(L.buildResult(o, { value: "10" }).critical, false); assert.equal(L.buildResult(o, { value: "25" }).critical, true);
  assert.equal(L.buildResult(mk(T({ resultType: "number" })), { value: "1" }).critical, false, "no limits -> never critical");
  const q = mk(T({ resultType: "qualitative", choices: ["Positive", "Negative"], critical: { values: ["Positive"], source: "Lab SOP" } })); assert.equal(L.buildResult(q, { value: "Positive" }).critical, true); assert.equal(L.buildResult(q, { value: "Negative" }).critical, false);
  assert.match(L.validateTest(T({ resultType: "qualitative", choices: ["A"], critical: { low: 1, source: "x y z" } })), /Numeric critical/);
});
test("Older orders (number/choice/text, no profile) still work", () => {
  const old = { id: "x", resultType: "choice", choices: ["Positive", "Negative"] }; assert.equal(L.buildResult(old, { value: "Positive" }).ok, true);
  assert.equal(L.buildResult({ resultType: "number", refMin: 1, refMax: 2 }, { value: "5" }).flag, "high");
  assert.equal(L.buildResult({ resultType: "text" }, { value: "ok" }).ok, true);
});
test("Specimen workflow: order of steps; rejected and cancelled are final; corrections allowed after result", () => {
  assert.equal(L.canMove("requested", "collected"), true); assert.equal(L.canMove("requested", "processing"), false); assert.equal(L.canMove("collected", "received"), true);
  assert.equal(L.canMove("received", "accepted"), true); assert.equal(L.canMove("received", "rejected"), true); assert.equal(L.canMove("accepted", "processing"), true);
  assert.equal(L.canMove("rejected", "processing"), false); assert.equal(L.canMove("cancelled", "collected"), false); assert.equal(L.canMove("verified", "resulted"), true);
  assert.equal(L.canMove("verified", "requested"), false);
});
test("Bills: paid / part / credit / waived / no price", () => {
  assert.deepEqual([L.bill({ price: 5000, amountPaid: 5000 }).status, L.bill({ price: 5000, amountPaid: 2000 }).status, L.bill({ price: 5000, amountPaid: 0 }).status, L.bill({ price: 5000, waived: true }).status, L.bill({ price: 0 }).status], ["paid", "part_paid", "credit", "waived", "no_charge"]);
  assert.equal(L.bill({ price: 5000, amountPaid: 9999 }).outstanding, 0); assert.equal(L.bill({ price: 5000, amountPaid: 2000 }).outstanding, 3000);
});
test("Reports: a request is NOT revenue; only billed tests count; collected vs credit vs waived", () => {
  const d = "2026-11-17", at = new Date(2026, 10, 17, 9).getTime();
  const orders = [{ id: "a", name: "Malaria", status: "verified", price: 5000, requestedDay: d, requestedAt: at, verifiedAt: at + 3600000 }, { id: "b", name: "Malaria", status: "requested", price: 5000, requestedDay: d, requestedAt: at },
    { id: "c", name: "FBC", status: "rejected", price: 8000, requestedDay: d, requestedAt: at }, { id: "d", name: "FBC", status: "resulted", price: 8000, requestedDay: d, requestedAt: at }];
  const bills = [{ orderId: "a", price: 5000, amountPaid: 2000, amountOutstanding: 3000, amountWaived: 0, status: "part_paid" }];
  const r = L.report(orders, [{ id: "r1", orderId: "a" }, { id: "r2", orderId: "a", amends: "r1" }], bills, { from: d, to: d });
  assert.deepEqual([r.revenue.billed, r.revenue.collected, r.revenue.outstanding, r.revenue.billedCount, r.revenue.notBilled, r.revenue.notBilledValue], [5000, 2000, 3000, 1, 2, 13000], "rejected is excluded; unbilled is shown separately, never as revenue");
  assert.equal(r.rejected.length, 1); assert.equal(r.awaitingVerification.length, 1); assert.equal(r.correctedResults.length, 1); assert.equal(r.volume[0].name, "Malaria"); assert.equal(r.averageTurnaroundMinutes, 60);
  assert.equal(L.report(orders, [], bills, { from: "2026-01-01", to: "2026-01-02" }).total, 0);
});

test("Ledger (v19): paid and credit parts become sales rows with fixed ids, no stock effect; waived writes nothing", () => {
  const ctx = { businessId: "b", shopId: "s", uid: "u", userName: "N", customerId: "dspca_p1" }, o = { id: "o1", name: "Malaria test", investigationId: "t1" };
  const part = L.ledgerRows(o, L.bill({ price: 5000, amountPaid: 2000 }), ctx);
  assert.deepEqual(part.map(r => [r.id, r.data.total, r.data.paymentStatus]), [["labsl_o1_p", 2000, "PAID"], ["labsl_o1_c", 3000, "CREDIT"]]);
  part.forEach(r => { assert.equal(r.data.baseQtyDeducted, 0); assert.equal(r.data.costOfGoods, 0); assert.equal(r.data.drugClass, "Laboratory"); assert.equal(r.data.drugId, "lab_t1"); assert.equal(r.data.receiptId, null); });
  assert.equal(part[1].data.customerId, "dspca_p1"); assert.equal(part[0].data.customerId, null);
  assert.equal(L.ledgerRows(o, L.bill({ price: 5000, waived: true }), ctx).length, 0);
  assert.equal(L.ledgerRows(o, L.bill({ price: 0 }), ctx).length, 0);
});
test("Ledger (v19): cash drawer reconciles: cash rows in = cash rows out after a reversal; credit part reverses on credit", () => {
  const ctx = { businessId: "b", shopId: "s", uid: "u", userName: "N", customerId: "dspca_p1" }, o = { id: "o2", name: "FBC" };
  const bl = L.bill({ price: 8000, amountPaid: 3000 });
  const made = L.ledgerRows(o, bl, ctx);
  const rev = L.reversalRows(o, { amountPaid: bl.paid, amountOutstanding: bl.outstanding, customerId: "dspca_p1" }, ctx, "wrong patient");
  const cash = rows => rows.filter(r => r.data.paymentStatus !== "CREDIT").reduce((a, r) => a + r.data.total, 0);
  assert.equal(cash(made) + cash(rev.rows), 0); assert.equal(rev.cashToReturn, 3000);
  assert.deepEqual(rev.rows.map(r => r.id), ["labrvsl_o2_p", "labrvsl_o2_c"]);
  assert.equal(made.concat(rev.rows).reduce((a, r) => a + r.data.total, 0), 0, "revenue nets to zero");
  assert.equal(o.id, "o2"); assert.equal(made[0].data.drugId, "lab_o2", "falls back to the order id when the test has no catalogue id");
});
