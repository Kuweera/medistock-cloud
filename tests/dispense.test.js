/* Phase 5 tests — run with:  node --test tests/        (Node 18+, no installs needed) */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const PCD = require("../pc-dispense.js");
const { makeDb } = require("./mock-firestore.js");

const B = "biz1", F = "shop1", UID = "op1";
const AS_OF = new Date(2026, 10, 15, 10, 0, 0);          // 15 Nov 2026
const day = n => PCD.localDay(new Date(2026, 10, 15 + n));

function setup(opts) {
  opts = opts || {};
  const m = makeDb();
  m.db.put("drugs", "d1", { businessId: B, shopId: F, name: "Paracetamol 500mg", dosageForm: "Tablet", baseUnit: "Tablet", currentStockBase: opts.drugStock != null ? opts.drugStock : 12 });
  const batches = opts.batches || [{ id: "bA", batchNumber: "A1", expiryDate: day(60), quantity: 12 }];
  batches.forEach(b => m.db.put("batches", b.id, Object.assign({ businessId: B, shopId: F, drugId: "d1" }, b)));
  m.db.put("pc_treatment_orders", "o1", Object.assign({ businessId: B, facilityId: F, kind: "medicine", status: "active", patientId: "p1", patientName: "Test Patient", encounterId: "e1", encounterNo: "V-1", planId: "pl1",
    medicineId: "d1", medicineName: "Paracetamol 500mg", formulation: "Tablet", strength: "500mg", doseValue: 1, doseUnit: "tablet", route: "oral", quantityPrescribed: 20, prescriberId: "doc1", prescriberName: "Dr Test", prescribedAt: AS_OF.getTime(), version: 1 }, opts.order || {}));
  return m;
}
const req = (extra) => Object.assign({ businessId: B, facilityId: F, uid: UID, userName: "Op One", orderId: "o1", drugId: "d1", qty: 12, requestId: PCD.newRequestId(), mode: "fefo",
  candidateBatchIds: ["bA"], asOf: AS_OF, patientConfirmed: true, medicineConfirmed: true, localDay: day(0) }, extra || {});
const rejects = async (p, code) => { await assert.rejects(p, e => { assert.equal(e.code, code, "expected " + code + " got " + e.code + " / " + e.message); return true; }); };

// ------------------------------------------------------------------ batch selection
test("FEFO: earliest expiry first, no-expiry last, expired and empty never used", () => {
  const batches = [
    { id: "late", quantity: 10, expiryDate: day(300) }, { id: "none", quantity: 10, expiryDate: "" }, { id: "soon", quantity: 5, expiryDate: day(10) },
    { id: "old", quantity: 50, expiryDate: day(-1) }, { id: "empty", quantity: 0, expiryDate: day(5) }
  ];
  const p = PCD.planFefo(batches, 22, AS_OF);
  assert.deepEqual(p.allocations.map(a => [a.batchId, a.qty]), [["soon", 5], ["late", 10], ["none", 7]]);
  assert.equal(p.short, 0);
  const s = PCD.planFefo([batches[3]], 1, AS_OF);
  assert.equal(s.short, 1); assert.equal(s.allocations.length, 0);
});
test("A batch that expires today is still usable; yesterday is not", () => {
  assert.equal(PCD.isExpired({ expiryDate: day(0) }, AS_OF), false);
  assert.equal(PCD.isExpired({ expiryDate: day(-1) }, AS_OF), true);
});
test("Expiry/FEFO rules match sales.html exactly (parity with the existing sales code)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "sales.html"), "utf8");
  const grab = (name) => { const i = src.indexOf("function " + name); assert.ok(i >= 0, name + " not found in sales.html"); let d = 0, j = src.indexOf("{", i); const s = j; for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (d === 0) break; } } return src.slice(i, j + 1); };
  const salesFns = new Function(grab("daysUntil") + "\n" + grab("expiryMs") + "\nreturn { daysUntil, expiryMs };")();
  const now = new Date();
  const dates = ["", null, undefined, "garbage"].concat([-400, -1, 0, 1, 30, 900].map(n => PCD.localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))));
  dates.forEach(d => { assert.equal(PCD.daysUntil(d, now), salesFns.daysUntil(d), "daysUntil " + d); assert.equal(PCD.expiryMs(d), salesFns.expiryMs(d), "expiryMs " + d); });
  const batches = dates.map((d, i) => ({ id: "b" + i, quantity: i % 3 === 0 ? 0 : 5, expiryDate: d }));
  const salesOrder = batches.filter(b => salesFns.daysUntil(b.expiryDate) >= 0 && b.quantity > 0).sort((a, b) => salesFns.expiryMs(a.expiryDate) - salesFns.expiryMs(b.expiryDate)).map(b => b.expiryDate || "");
  const ours = PCD.fefoSort(batches.filter(b => PCD.sellable(b, now))).map(b => b.expiryDate || "");
  assert.deepEqual(ours, salesOrder);
});

// ------------------------------------------------------------------ the transaction
test("Dispenses: stock, batch, stock movement, record, prescription and audit all written together", async () => {
  const { db, tools } = setup();
  const r = await PCD.runDispense(tools, req({ qty: 12 }));
  assert.equal(r.duplicate, false);
  assert.equal(db.get("drugs", "d1").currentStockBase, 0);
  assert.equal(db.get("batches", "bA").quantity, 0);
  const recs = db.all("dispense_records"); assert.equal(recs.length, 1);
  assert.equal(recs[0].qtyDispensed, 12); assert.equal(recs[0].batchId, "bA"); assert.equal(recs[0].isSynced, true); assert.equal(recs[0].dispensedBy, UID); assert.equal(recs[0].prescriptionId, "o1");
  assert.equal(recs[0].businessId, B); assert.equal(recs[0].facilityId, F);
  const tx = db.all("stock_transactions"); assert.equal(tx.length, 1); assert.equal(tx[0].type, "DISPENSE"); assert.equal(tx[0].baseUnitsChange, -12); assert.equal(tx[0].shopId, F);
  const rx = db.get("prescriptions", "o1");
  assert.equal(rx.qtyPrescribed, 20); assert.equal(rx.qtyDispensed, 12); assert.equal(rx.qtyOutstanding, 8); assert.equal(rx.status, "partially_dispensed");
  assert.equal(rx.id, "o1"); assert.equal(rx.patientId, "p1"); assert.equal(rx.encounterId, "e1"); assert.equal(rx.drugId, "d1"); assert.equal(rx.dose, "1 tablet");
  assert.equal(db.all("pc_audit_logs").length, 1);
});
test("Partial dispensing: 20 prescribed, 12 available -> 12 dispensed, 8 outstanding; later 8 completes the SAME prescription", async () => {
  const { db, tools } = setup();
  await rejects(PCD.runDispense(tools, req({ qty: 20 })), "stock_short");          // cannot dispense 20 when 12 are available
  assert.equal(db.all("dispense_records").length, 0);
  await PCD.runDispense(tools, req({ qty: 12 }));
  assert.equal(db.get("prescriptions", "o1").qtyOutstanding, 8);
  // restock a new batch, then continue from the outstanding quantity
  db.put("batches", "bB", { businessId: B, shopId: F, drugId: "d1", batchNumber: "B1", expiryDate: day(90), quantity: 30 });
  db.put("drugs", "d1", Object.assign(db.get("drugs", "d1"), { currentStockBase: 30 }));
  await rejects(PCD.runDispense(tools, req({ qty: 9, candidateBatchIds: ["bA", "bB"] })), "over_outstanding");
  const r = await PCD.runDispense(tools, req({ qty: 8, candidateBatchIds: ["bA", "bB"] }));
  assert.equal(r.status, "completed"); assert.equal(r.outstanding, 0);
  assert.equal(db.all("prescriptions").length, 1, "no second prescription document");
  const rx = db.get("prescriptions", "o1"); assert.equal(rx.qtyDispensed, 20); assert.equal(rx.status, "completed");
  assert.equal(db.get("batches", "bB").quantity, 22);
  await rejects(PCD.runDispense(tools, req({ qty: 1, candidateBatchIds: ["bA", "bB"] })), "already_complete");
});
test("Spans batches in FEFO order and writes one record per batch", async () => {
  const { db, tools } = setup({ drugStock: 25, batches: [{ id: "b2", batchNumber: "L", expiryDate: day(200), quantity: 20 }, { id: "b1", batchNumber: "S", expiryDate: day(20), quantity: 5 }] });
  await PCD.runDispense(tools, req({ qty: 15, candidateBatchIds: ["b2", "b1"] }));
  assert.equal(db.get("batches", "b1").quantity, 0); assert.equal(db.get("batches", "b2").quantity, 10);
  const recs = db.all("dispense_records").sort((a, b) => a.lineNo - b.lineNo);
  assert.deepEqual(recs.map(r => [r.batchId, r.qtyDispensed]), [["b1", 5], ["b2", 10]]);
  assert.equal(db.all("stock_transactions").length, 2);
});
test("Expired stock cannot be dispensed (nothing changes)", async () => {
  const { db, tools } = setup({ drugStock: 12, batches: [{ id: "bA", batchNumber: "OLD", expiryDate: day(-3), quantity: 12 }] });
  const before = db.snapshot();
  await rejects(PCD.runDispense(tools, req()), "stock_short");
  assert.equal(db.snapshot(), before);
});
test("Expired batch cannot be picked by hand either", async () => {
  const { db, tools } = setup({ drugStock: 30, batches: [{ id: "bA", batchNumber: "OLD", expiryDate: day(-3), quantity: 12 }, { id: "bB", batchNumber: "OK", expiryDate: day(30), quantity: 18 }] });
  await rejects(PCD.runDispense(tools, req({ mode: "manual", picks: [{ batchId: "bA", qty: 12 }], candidateBatchIds: ["bA", "bB"] })), "batch_expired");
  const r = await PCD.runDispense(tools, req({ mode: "manual", picks: [{ batchId: "bB", qty: 12 }], candidateBatchIds: ["bA", "bB"] }));
  assert.equal(db.get("batches", "bB").quantity, 6); assert.equal(r.lines[0].batchId, "bB");
  assert.equal(db.all("dispense_records")[0].batchMode, "manual");
});
test("Manual picks must add up and stay within the batch", async () => {
  const { tools } = setup({ drugStock: 30, batches: [{ id: "bA", batchNumber: "A", expiryDate: day(30), quantity: 10 }, { id: "bB", batchNumber: "B", expiryDate: day(60), quantity: 20 }] });
  await rejects(PCD.runDispense(tools, req({ mode: "manual", picks: [{ batchId: "bA", qty: 5 }], candidateBatchIds: ["bA", "bB"] })), "manual_sum");
  await rejects(PCD.runDispense(tools, req({ mode: "manual", picks: [{ batchId: "bA", qty: 12 }], candidateBatchIds: ["bA", "bB"] })), "stock_short");
  await rejects(PCD.runDispense(tools, req({ mode: "manual", picks: [{ batchId: "nope", qty: 12 }], candidateBatchIds: ["bA", "bB"] })), "batch_invalid");
});
test("Negative stock is impossible", async () => {
  const { db, tools } = setup({ drugStock: 5, batches: [{ id: "bA", batchNumber: "A", expiryDate: day(30), quantity: 12 }] });   // drug total disagrees with batches
  await rejects(PCD.runDispense(tools, req({ qty: 12 })), "stock_inconsistent");
  assert.equal(db.get("batches", "bA").quantity, 12); assert.equal(db.get("drugs", "d1").currentStockBase, 5);
});
test("Repeated submission (same request) deducts stock once", async () => {
  const { db, tools } = setup();
  const r = req({ qty: 5 });
  const a = await PCD.runDispense(tools, r), b = await PCD.runDispense(tools, r), c = await PCD.runDispense(tools, r);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(c.duplicate, true);
  assert.equal(db.get("drugs", "d1").currentStockBase, 7); assert.equal(db.all("dispense_records").length, 1);
  assert.equal(db.get("prescriptions", "o1").qtyDispensed, 5);
});
test("Two devices dispensing the same last stock at once: only one succeeds", async () => {
  const { db, tools } = setup();
  const results = await Promise.allSettled([PCD.runDispense(tools, req({ qty: 12 })), PCD.runDispense(tools, req({ qty: 12 }))]);
  const ok = results.filter(r => r.status === "fulfilled"), bad = results.filter(r => r.status === "rejected");
  assert.equal(ok.length, 1); assert.equal(bad.length, 1);
  assert.ok(["stock_short", "over_outstanding"].includes(bad[0].reason.code), bad[0].reason.code);
  assert.equal(db.get("drugs", "d1").currentStockBase, 0); assert.equal(db.get("batches", "bA").quantity, 0);
  assert.equal(db.get("prescriptions", "o1").qtyDispensed, 12);
});
test("Two devices dispensing DIFFERENT prescriptions of the same stock never go negative", async () => {
  const { db, tools } = setup();
  db.put("pc_treatment_orders", "o2", Object.assign(db.get("pc_treatment_orders", "o1"), { patientId: "p2", patientName: "Other" }));
  const rs = await Promise.allSettled([PCD.runDispense(tools, req({ qty: 8 })), PCD.runDispense(tools, req({ qty: 8, orderId: "o2" }))]);
  assert.equal(rs.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(db.get("batches", "bA").quantity >= 0); assert.equal(db.get("batches", "bA").quantity, 4);
});
test("Dispensing never touches administration records (MAR / planned administrations)", async () => {
  const { db, tools } = setup();
  await PCD.runDispense(tools, req({ qty: 12 }));
  const touched = new Set(db.writes);
  assert.ok(!touched.has("pc_mar_records")); assert.ok(!touched.has("pc_treatment_events")); assert.ok(!touched.has("pc_treatment_orders"));
  assert.deepEqual([...touched].sort(), ["batches", "dispense_records", "drugs", "pc_audit_logs", "prescriptions", "stock_transactions"]);
});
test("Does not touch the sales/inventory schemas: only existing fields are updated on drugs and batches", async () => {
  const { db, tools } = setup();
  const d0 = Object.keys(db.get("drugs", "d1")).sort(), b0 = Object.keys(db.get("batches", "bA")).sort();
  await PCD.runDispense(tools, req({ qty: 3 }));
  assert.deepEqual(Object.keys(db.get("drugs", "d1")).sort(), d0); assert.deepEqual(Object.keys(db.get("batches", "bA")).sort(), b0);
});
test("A stopped or replaced prescription cannot be dispensed", async () => {
  for (const st of ["stopped", "superseded", "completed"]) {
    const { tools } = setup({ order: { status: st } });
    await rejects(PCD.runDispense(tools, req()), "order_inactive");
  }
});
test("Facility and business isolation", async () => {
  const a = setup({ order: { facilityId: "other" } }); await rejects(PCD.runDispense(a.tools, req()), "wrong_facility");
  const b = setup({ order: { businessId: "other" } }); await rejects(PCD.runDispense(b.tools, req()), "wrong_facility");
  const c = setup(); c.db.put("drugs", "d1", Object.assign(c.db.get("drugs", "d1"), { shopId: "other" })); await rejects(PCD.runDispense(c.tools, req()), "drug_missing");
  const d = setup(); d.db.put("batches", "bX", { businessId: B, shopId: F, drugId: "someOtherDrug", batchNumber: "X", expiryDate: day(10), quantity: 99 });
  await rejects(PCD.runDispense(d.tools, req({ qty: 15, candidateBatchIds: ["bA", "bX"] })), "stock_short");   // foreign-drug batch is ignored
});
test("Medicine matching: must be the catalogue record named on the order", async () => {
  const { db, tools } = setup();
  db.put("drugs", "d2", { businessId: B, shopId: F, name: "Paracetamol 500mg Syrup", baseUnit: "ml", currentStockBase: 100 });
  await rejects(PCD.runDispense(tools, req({ drugId: "d2" })), "drug_mismatch");
  await rejects(PCD.runDispense(tools, req({ drugId: "" })), "no_drug");
  await PCD.runDispense(tools, req({ qty: 5 }));
  db.put("pc_treatment_orders", "o1", Object.assign(db.get("pc_treatment_orders", "o1"), { medicineId: null }));   // unlinked order: pharmacist picks the drug...
  await rejects(PCD.runDispense(tools, req({ drugId: "d2" })), "drug_mismatch");                               // ...but cannot switch drug mid-course
});
test("Order typed without a catalogue link: pharmacist chooses the drug and it is recorded as pharmacist-linked", async () => {
  const { db, tools } = setup({ order: { medicineId: null } });
  await PCD.runDispense(tools, req({ qty: 4 }));
  assert.equal(db.get("prescriptions", "o1").drugLinkedBy, "pharmacist");
});
test("No quantity from the prescriber: needs the pharmacist's figure, recorded as such", async () => {
  const { db, tools } = setup({ order: { quantityPrescribed: null } });
  await rejects(PCD.runDispense(tools, req({ qty: 6 })), "no_quantity");
  await PCD.runDispense(tools, req({ qty: 6, qtyPrescribedOverride: 10 }));
  const rx = db.get("prescriptions", "o1"); assert.equal(rx.qtyPrescribed, 10); assert.equal(rx.qtySetBy, "pharmacist"); assert.equal(rx.qtyOutstanding, 4);
});
test("Confirmation and quantity checks", async () => {
  const { tools } = setup();
  await rejects(PCD.runDispense(tools, req({ patientConfirmed: false })), "not_confirmed");
  await rejects(PCD.runDispense(tools, req({ medicineConfirmed: false })), "not_confirmed");
  await rejects(PCD.runDispense(tools, req({ qty: 0 })), "bad_quantity");
  await rejects(PCD.runDispense(tools, req({ qty: -3 })), "bad_quantity");
  await rejects(PCD.runDispense(tools, req({ requestId: "" })), "no_request_id");
});
test("Stock with no batch record needs explicit confirmation and still cannot go negative", async () => {
  const { db, tools } = setup({ drugStock: 10, batches: [] });
  await rejects(PCD.runDispense(tools, req({ qty: 5, candidateBatchIds: [] })), "unbatched_blocked");
  await rejects(PCD.runDispense(tools, req({ qty: 15, candidateBatchIds: [], allowUnbatched: true })), "stock_short");
  await PCD.runDispense(tools, req({ qty: 5, candidateBatchIds: [], allowUnbatched: true }));
  assert.equal(db.get("drugs", "d1").currentStockBase, 5); assert.equal(db.all("dispense_records")[0].batchId, null);
});

// ------------------------------------------------------------------ offline queue
function memStorage() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; }
const queued = (q, extra) => { const p = req(extra); q.add({ requestId: p.requestId, summary: "x", params: Object.assign({}, p, { clientAt: AS_OF.getTime(), asOf: undefined, candidateBatchIds: undefined }) }); return p; };
test("Offline: an item stays queued (not deducted) until the server confirms it, then syncs once", async () => {
  const { db, tools } = setup(); const q = PCD.Queue(memStorage(), "k");
  const p = queued(q, { qty: 5 });
  db.offline = true;
  const r1 = await PCD.syncQueue(tools, q, async () => ["bA"]);
  assert.equal(r1.waiting, 1); assert.equal(q.count(), 1); assert.equal(db.get("drugs", "d1").currentStockBase, 12, "nothing deducted while offline");
  db.offline = false;
  const r2 = await PCD.syncQueue(tools, q, async () => ["bA"]);
  assert.equal(r2.done, 1); assert.equal(q.count(), 0); assert.equal(db.get("drugs", "d1").currentStockBase, 7);
  assert.equal(db.all("dispense_records")[0].source, "offline_replay");
  const r3 = await PCD.syncQueue(tools, q, async () => ["bA"]); assert.equal(r3.done, 0);
  assert.equal(db.all("dispense_records").length, 1);
});
test("Connection drops AFTER the server committed: replay is recognised as a duplicate, not deducted twice", async () => {
  const { db, tools } = setup(); const q = PCD.Queue(memStorage(), "k");
  queued(q, { qty: 5 });
  db.failNextCommitAfterApply = true;
  const r1 = await PCD.syncQueue(tools, q, async () => ["bA"]);
  assert.equal(r1.waiting, 1); assert.equal(db.get("drugs", "d1").currentStockBase, 7);   // it did commit
  const r2 = await PCD.syncQueue(tools, q, async () => ["bA"]);
  assert.equal(r2.done, 1); assert.equal(db.get("drugs", "d1").currentStockBase, 7); assert.equal(db.all("dispense_records").length, 1); assert.equal(q.count(), 0);
});
test("Offline conflict: two devices queued the same stock; the second is reported as a conflict, kept, and recoverable", async () => {
  const { db, tools } = setup(); const q1 = PCD.Queue(memStorage(), "a"), q2 = PCD.Queue(memStorage(), "b");
  queued(q1, { qty: 12 }); const p2 = queued(q2, { qty: 12 });
  await PCD.syncQueue(tools, q1, async () => ["bA"]);
  const r = await PCD.syncQueue(tools, q2, async () => ["bA"]);
  assert.equal(r.conflicts, 1); assert.equal(db.get("batches", "bA").quantity, 0);
  const item = q2.list()[0]; assert.equal(item.status, "conflict"); assert.match(item.message, /not available|outstanding|already/i);
  // recoverable: after restocking the owner can retry the same request
  db.put("prescriptions", "o1", Object.assign(db.get("prescriptions", "o1"), { qtyDispensed: 0, qtyOutstanding: 20, status: "partially_dispensed" }));
  db.put("batches", "bA", Object.assign(db.get("batches", "bA"), { quantity: 12 })); db.put("drugs", "d1", Object.assign(db.get("drugs", "d1"), { currentStockBase: 12 }));
  q2.update(p2.requestId, { status: "pending" });
  const r2 = await PCD.syncQueue(tools, q2, async () => ["bA"]); assert.equal(r2.done, 1);
});

// ------------------------------------------------------------------ pure helpers
test("Status and queue grouping", () => {
  assert.equal(PCD.statusFor(20, 0), "pending"); assert.equal(PCD.statusFor(20, 12), "partially_dispensed"); assert.equal(PCD.statusFor(20, 20), "completed");
  const o = { status: "active", quantityPrescribed: 20 };
  assert.equal(PCD.queueGroup(o, null), "waiting");
  assert.equal(PCD.queueGroup(o, { status: "partially_dispensed", qtyDispensed: 12 }), "partial");
  assert.equal(PCD.queueGroup(o, { status: "completed", qtyDispensed: 20 }), "done");
  assert.equal(PCD.queueGroup({ status: "stopped" }, null), "stopped");
  assert.equal(PCD.queueGroup({ status: "stopped" }, { status: "completed" }), "done");
  assert.deepEqual(PCD.qtyState(o, null), { prescribed: 20, dispensed: 0, outstanding: 20, known: true, setBy: "prescriber" });
  assert.equal(PCD.qtyState({ quantityPrescribed: null }, null).known, false);
  assert.equal(PCD.qtyState(o, { qtyPrescribed: 20, qtyDispensed: 12 }).outstanding, 8);
});
test("Error messages are plain language", () => {
  assert.equal(PCD.friendlyError({ code: "permission-denied" }), "You do not have permission to perform this action.");
  assert.match(PCD.friendlyError(PCD.PCDError("already_complete", "x")), /already been dispensed/);
  assert.match(PCD.friendlyError(PCD.PCDError("stock_short", "x", { available: 3 })), /not available in the selected stock\. Available: 3/);
  assert.doesNotMatch(PCD.friendlyError({ code: "invalid-argument" }), /invalid-argument/);
});
test("Reports", async () => {
  const { db, tools } = setup({ drugStock: 40, batches: [{ id: "bA", batchNumber: "A", expiryDate: day(30), quantity: 40 }] });
  await PCD.runDispense(tools, req({ qty: 12 }));
  await PCD.runDispense(tools, req({ qty: 8, uid: "op2", userName: "Op Two" }));
  const rep = PCD.buildReport(db.all("prescriptions").map(x => Object.assign({ id: x._id }, x)), db.all("dispense_records"), [db.get("pc_treatment_orders", "o1")], day(0).slice(0, 7));
  assert.equal(rep.received, 1); assert.equal(rep.stockDeducted, 20); assert.equal(rep.completed, 1); assert.equal(rep.partial, 0); assert.equal(rep.byOperator.length, 2);
  assert.equal(rep.medicinesDispensed[0].qty, 20);
});

// ------------------------------------------------------------------ permission failure diagnostics (Priority 1)
test("A refused read says exactly which step was denied, and the message stays a plain permission message", async () => {
  const { db, tools } = setup();
  db.denyMissingReads = ["dispense_records"];           // reproduces the pre-v16 rule behaviour for a missing document
  let err; try { await PCD.runDispense(tools, req()); } catch (e) { err = e; }
  assert.ok(err, "should fail"); assert.equal(err.code, "permission-denied"); assert.match(err.pcdStep, /dispense_records/);
  assert.match(PCD.friendlyError(err), /^You do not have permission to perform this action\. \(Ref: read-dispense_records/);
  assert.match(PCD.technicalDetail(err), /permission-denied/); assert.match(PCD.technicalDetail(err), /dispense_records/);
  assert.equal(db.all("dispense_records").length, 0); assert.equal(db.get("drugs", "d1").currentStockBase, 12, "nothing changed");
});
test("Unrelated errors are never reported as permission errors", () => {
  const net = PCD.friendlyError({ code: "unavailable", message: "offline" }), other = PCD.friendlyError(new Error("boom"));
  assert.doesNotMatch(net, /permission/i); assert.doesNotMatch(other, /permission/i);
  assert.doesNotMatch(PCD.friendlyError(PCD.PCDError("stock_short", "x")), /permission/i);
  assert.doesNotMatch(PCD.friendlyError({ code: "aborted" }), /permission/i);
});
test("Access check is read-only and reports blocked reads", async () => {
  const { db, tools } = setup(); db.put("users", "u1", { role: "owner", businessId: B });
  const ctx = { uid: "u1", businessId: B, facilityId: F, role: "operator", perms: { "dispense.view": true }, facility: { businessId: B, enabledServices: ["patient_care"] } };
  const before = db.snapshot(), writes = db.writes.length;
  let rows = await PCD.diagnose(tools, ctx);
  assert.equal(db.snapshot(), before); assert.equal(db.writes.length, writes);
  assert.equal(rows.find(r => r.name === "Permission dispense.perform").ok, false);
  assert.equal(rows.find(r => r.name === "Permission dispense.view").ok, true);
  assert.equal(rows.find(r => r.name === "Look for a dispensing record that does not exist yet").ok, true);
  db.denyMissingReads = ["dispense_records", "prescriptions"];
  rows = await PCD.diagnose(tools, Object.assign({}, ctx, { role: "owner" }));
  const bad = rows.filter(r => !r.ok).map(r => r.name);
  assert.deepEqual(bad.sort(), ["Look for a dispensing record that does not exist yet", "Look for a prescription that does not exist yet"]);
  assert.match(rows.find(r => !r.ok).detail, /blocked by the security rules/);
  const other = await PCD.diagnose(tools, Object.assign({}, ctx, { facility: { businessId: "someone-else", enabledServices: [] } }));
  assert.equal(other.find(r => r.name === "Shop belongs to your business").ok, false); assert.equal(other.find(r => r.name === "Patient Care switched on for this shop").ok, false);
});
