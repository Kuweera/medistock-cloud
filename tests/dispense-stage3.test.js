/* Developer 3, Stage 3: pending prescription + stock + money + reversal + stop, as one workflow (stand-in, not the real rules engine). Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const PCD = require("../pc-dispense.js"), PCX = require("../pc-dispense-ext.js");
const { makeDb } = require("./mock-firestore.js");
const B = "biz1", F = "shop1", UID = "op1", AS_OF = new Date(2026, 10, 15, 10, 0, 0), day = n => PCD.localDay(new Date(2026, 10, 15 + n));
const REVERSAL_KEYS = ["qtyDispensed", "qtyOutstanding", "status", "qtyReturned", "lastReturnRequestId", "lastReturnedBy", "lastReturnedAt", "updatedBy", "updatedAt"];
function setup() {
  const m = makeDb();
  m.db.put("drugs", "d1", { businessId: B, shopId: F, name: "Amoxicillin 500mg", baseUnit: "Capsule", wholesale: 100, retailBase: 300, currentStockBase: 40 });
  m.db.put("batches", "bA", { businessId: B, shopId: F, drugId: "d1", batchNumber: "A1", expiryDate: day(60), quantity: 40, purchasePricePerStockUnit: 100 });
  m.db.put("pc_treatment_orders", "o1", { businessId: B, facilityId: F, kind: "medicine", status: "active", patientId: "p1", patientName: "John Doe", encounterId: "e123", planId: "pl1", medicineId: "d1", medicineName: "Amoxicillin 500mg", doseValue: 1, doseUnit: "capsule", route: "oral", quantityPrescribed: 10, prescribedAt: AS_OF.getTime(), version: 1 });
  m.db.put("prescriptions", "o1", { id: "o1", orderId: "o1", businessId: B, facilityId: F, patientId: "p1", patientName: "John Doe", encounterId: "e123", planId: "pl1", status: "pending", qtyPrescribed: 10, qtyDispensed: 0, qtyOutstanding: 10, qtyUnknown: false, qtySetBy: "prescriber", qtyReturned: 0, lastRequestId: null, drugId: "d1", drugName: "Amoxicillin 500mg" });
  return m;
}
const base = e => Object.assign({ businessId: B, facilityId: F, uid: UID, userName: "Op", orderId: "o1", drugId: "d1", qty: 4, requestId: PCD.newRequestId(), mode: "fefo", candidateBatchIds: ["bA"], asOf: AS_OF, patientConfirmed: true, medicineConfirmed: true, localDay: day(0) }, e || {});
function dispense(tools, qty, paid, requestId) {
  const p = base({ qty: qty, requestId: requestId || PCD.newRequestId() });
  p.hook = PCX.financeHook(tools, { qty: qty, drugId: "d1", unitPrice: 300, amountPaid: paid, businessId: B, facilityId: F, uid: UID, userName: "Op", patientId: "p1" });
  return PCD.runDispense(tools, p).then(r => Object.assign(r, { requestId: p.requestId }));
}
async function ret(tools, db, qty) {
  const recs = db.all("dispense_records").map(r => ({ id: r._id })).reverse();
  return PCX.runReturn(tools, { businessId: B, facilityId: F, uid: UID, userName: "Op", orderId: "o1", requestId: PCD.newRequestId(), qty: qty, reason: "Patient declined", confirmedBack: true, records: recs });
}
const money = db => ({ sales: db.all("sales").reduce((s, x) => s + x.total, 0), receipts: db.all("receipts").length, credit: db.all("credit_transactions").reduce((s, t) => s + t.balanceChange, 0) });

test("Partial dispensing of a pending prescription: stock, money and prescription move once; a retry changes nothing", async () => {
  const { db, tools } = setup(); const r = await dispense(tools, 4, 400);
  assert.equal(db.get("drugs", "d1").currentStockBase, 36); assert.equal(db.all("stock_transactions").length, 1);
  let rx = db.get("prescriptions", "o1"); assert.equal(rx.status, "partially_dispensed"); assert.equal(rx.qtyOutstanding, 6);
  let m = money(db); assert.equal(m.sales, 1200); assert.equal(m.receipts, 2, "part payment: one paid receipt and one credit receipt"); assert.equal(m.credit, 800, "1200 total, 400 paid, 800 on credit");
  const again = await PCD.runDispense(tools, Object.assign(base({ qty: 4, requestId: r.requestId }), { hook: PCX.financeHook(tools, { qty: 4, drugId: "d1", unitPrice: 300, amountPaid: 400, businessId: B, facilityId: F, uid: UID, userName: "Op", patientId: "p1" }) }));
  assert.equal(again.duplicate, true); assert.equal(db.get("drugs", "d1").currentStockBase, 36); assert.equal(db.all("stock_transactions").length, 1); assert.deepEqual(money(db), m, "no second payment or sale");
  await dispense(tools, 6, 1800); rx = db.get("prescriptions", "o1"); assert.equal(rx.status, "completed"); assert.equal(db.get("drugs", "d1").currentStockBase, 30);
  assert.equal(db.all("prescriptions").length, 1); assert.equal(db.all("dispense_records").length, 2);
});
test("A stopped order cannot be dispensed further, but what was already supplied can still be reversed; history is kept", async () => {
  const { db, tools } = setup(); await dispense(tools, 4, 0);
  db.put("pc_treatment_orders", "o1", Object.assign(JSON.parse(JSON.stringify(db.get("pc_treatment_orders", "o1"))), { status: "stopped", endReason: "Allergic reaction" }));
  await assert.rejects(dispense(tools, 2, 0), e => e.code === "order_inactive");
  assert.equal(db.get("drugs", "d1").currentStockBase, 36);
  const before = JSON.parse(JSON.stringify(db.get("prescriptions", "o1"))); const r = await ret(tools, db, 4); const rx = db.get("prescriptions", "o1");
  assert.equal(db.get("drugs", "d1").currentStockBase, 40); assert.equal(rx.qtyDispensed, 0); assert.equal(rx.status, "pending"); assert.equal(rx.qtyReturned, 4);
  assert.deepEqual(Object.keys(rx).filter(k => JSON.stringify(before[k]) !== JSON.stringify(rx[k])).filter(k => REVERSAL_KEYS.indexOf(k) < 0), [], "reversal changes only allowed keys");
  assert.equal(db.all("dispense_records").length, 1, "original dispense record is kept, never deleted"); assert.equal(db.all("stock_transactions").filter(t => t.type === "DISPENSE").length, 1);
  assert.equal(money(db).credit, 0, "credit reversed once");
});
test("Dispense, partial reversal, dispense again: outstanding always equals prescribed minus dispensed", async () => {
  const { db, tools } = setup(); await dispense(tools, 10, 3000); assert.equal(db.get("prescriptions", "o1").status, "completed");
  await ret(tools, db, 3); let rx = db.get("prescriptions", "o1"); assert.equal(rx.status, "partially_dispensed"); assert.equal(rx.qtyDispensed, 7); assert.equal(rx.qtyOutstanding, 3); assert.equal(db.get("drugs", "d1").currentStockBase, 33);
  await dispense(tools, 3, 900); rx = db.get("prescriptions", "o1"); assert.equal(rx.status, "completed"); assert.equal(db.get("drugs", "d1").currentStockBase, 30);
  assert.equal(db.all("stock_transactions").reduce((s, t) => s + t.baseUnitsChange, 0), -10, "net stock movement is -10");
});

// Stage 5 prerequisite for Stage 6: the engine accepts consumable orders (kind "consumable"), still refuses other kinds
test("A consumable order (pending prescription) can be supplied: same stock, money and prescription path; a procedure order is still refused", async () => {
  const { db, tools } = setup();
  db.put("pc_treatment_orders", "o1", Object.assign(JSON.parse(JSON.stringify(db.get("pc_treatment_orders", "o1"))), { kind: "consumable", medicineName: "IV cannula 20G" }));
  await dispense(tools, 4, 400); const rx = db.get("prescriptions", "o1");
  assert.equal(rx.status, "partially_dispensed"); assert.equal(db.get("drugs", "d1").currentStockBase, 36); assert.equal(db.all("stock_transactions").length, 1); assert.equal(money(db).sales, 1200);
  const rec = await ret(tools, db, 4); assert.equal(db.get("drugs", "d1").currentStockBase, 40); assert.equal(db.get("prescriptions", "o1").status, "pending");
  db.put("pc_treatment_orders", "o1", Object.assign(JSON.parse(JSON.stringify(db.get("pc_treatment_orders", "o1"))), { kind: "procedure" }));
  await assert.rejects(dispense(tools, 1, 0), e => e.code === "not_medicine"); assert.equal(db.get("drugs", "d1").currentStockBase, 40);
});
