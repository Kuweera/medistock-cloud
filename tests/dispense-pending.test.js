/* Developer 3, Stage 2: the dispensing engine with a PENDING prescription (written by the clinician with the order, rules v19).
   The update must change only the keys the prescription rules allow. Run: node --test tests/ (stand-in, not the real rules engine) */
const test = require("node:test");
const assert = require("node:assert/strict");
const PCD = require("../pc-dispense.js");
const { makeDb } = require("./mock-firestore.js");
const B = "biz1", F = "shop1", UID = "op1", AS_OF = new Date(2026, 10, 15, 10, 0, 0), day = n => PCD.localDay(new Date(2026, 10, 15 + n));
// keys the pharmacy may change (firestore.rules: first dispensing of a pending prescription / later dispensing)
const FIRST = ["qtyPrescribed", "qtyUnknown", "qtySetBy", "drugId", "drugName", "qtyDispensed", "qtyOutstanding", "status", "lastDispensedAt", "lastDispensedBy", "lastRequestId", "updatedBy", "updatedAt"];
const LATER = ["qtyDispensed", "qtyOutstanding", "status", "lastDispensedAt", "lastDispensedBy", "lastRequestId", "updatedBy", "updatedAt"];

function setup(o) {
  o = o || {}; const m = makeDb();
  m.db.put("drugs", "d1", { businessId: B, shopId: F, name: "Paracetamol 500mg", baseUnit: "Tablet", currentStockBase: 30 });
  m.db.put("batches", "bA", { businessId: B, shopId: F, drugId: "d1", batchNumber: "A1", expiryDate: day(60), quantity: 30 });
  m.db.put("pc_treatment_orders", "o1", { businessId: B, facilityId: F, kind: "medicine", status: "active", patientId: "p1", patientName: "Test Patient", encounterId: "e1", encounterNo: "V-1", planId: "pl1",
    medicineId: o.medicineId === undefined ? "d1" : o.medicineId, medicineName: "Paracetamol", doseValue: 1, doseUnit: "tablet", route: "oral", quantityPrescribed: o.orderQty === undefined ? 20 : o.orderQty, prescriberId: "doc1", prescriberName: "Dr", version: 1 });
  const qty = o.qty === undefined ? 20 : o.qty;
  m.db.put("prescriptions", "o1", { id: "o1", orderId: "o1", businessId: B, facilityId: F, patientId: "p1", patientName: "Test Patient", encounterId: "e1", planId: "pl1", status: "pending",
    qtyPrescribed: qty, qtyDispensed: 0, qtyOutstanding: qty, qtyUnknown: qty === 0, qtySetBy: "prescriber", qtyReturned: 0, lastRequestId: null, drugId: o.drugId === undefined ? "d1" : o.drugId, drugName: "Paracetamol", prescribedName: "Paracetamol" });
  return m;
}
const req = x => Object.assign({ businessId: B, facilityId: F, uid: UID, userName: "Op", orderId: "o1", drugId: "d1", qty: 12, requestId: PCD.newRequestId(), mode: "fefo", candidateBatchIds: ["bA"], asOf: AS_OF, patientConfirmed: true, medicineConfirmed: true, localDay: day(0) }, x || {});
const changed = (a, b) => Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const snap = (db, c, id) => JSON.parse(JSON.stringify(db.get(c, id)));

test("Pending prescription, quantity and medicine known: partial then full dispensing update the SAME document, only allowed keys change", async () => {
  const { db, tools } = setup(); let before = snap(db, "prescriptions", "o1");
  await PCD.runDispense(tools, req({ qty: 12 })); let rx = db.get("prescriptions", "o1");
  assert.equal(rx.status, "partially_dispensed"); assert.equal(rx.qtyDispensed, 12); assert.equal(rx.qtyOutstanding, 8); assert.equal(rx.qtyPrescribed, 20);
  assert.deepEqual(changed(before, rx).filter(k => LATER.indexOf(k) < 0), [], "only keys allowed by the later-dispensing rule");
  assert.equal(db.all("prescriptions").length, 1, "no second prescription document");
  before = snap(db, "prescriptions", "o1"); await PCD.runDispense(tools, req({ qty: 8 })); rx = db.get("prescriptions", "o1");
  assert.equal(rx.status, "completed"); assert.equal(rx.qtyOutstanding, 0); assert.equal(db.get("drugs", "d1").currentStockBase, 10);
  assert.equal(db.all("stock_transactions").length, 2, "one stock movement per dispensing, no duplicates");
});
test("Pending prescription with NO quantity: the pharmacy states it, the prescription records qtySetBy pharmacy and clears qtyUnknown", async () => {
  const { db, tools } = setup({ qty: 0, orderQty: null }); const before = snap(db, "prescriptions", "o1");
  await assert.rejects(PCD.runDispense(tools, req({ qty: 10 })), e => e.code === "no_quantity");
  assert.equal(db.get("drugs", "d1").currentStockBase, 30, "nothing changed when no quantity is stated"); assert.deepEqual(snap(db, "prescriptions", "o1"), before);
  await PCD.runDispense(tools, req({ qty: 10, qtyPrescribedOverride: 10 })); const rx = db.get("prescriptions", "o1");
  assert.equal(rx.qtyPrescribed, 10); assert.equal(rx.qtyUnknown, false); assert.equal(rx.qtySetBy, "pharmacy"); assert.equal(rx.status, "completed");
  assert.deepEqual(changed(before, rx).filter(k => FIRST.indexOf(k) < 0), [], "only keys allowed by the first-dispensing rule");
});
test("Pending prescription whose medicine is not matched to stock: the pharmacy matches it at first dispensing", async () => {
  const { db, tools } = setup({ medicineId: null, drugId: null }); const before = snap(db, "prescriptions", "o1");
  await PCD.runDispense(tools, req({ qty: 5 })); const rx = db.get("prescriptions", "o1");
  assert.equal(rx.drugId, "d1"); assert.equal(rx.drugName, "Paracetamol 500mg"); assert.equal(rx.status, "partially_dispensed"); assert.equal(rx.qtyPrescribed, 20);
  assert.deepEqual(changed(before, rx).filter(k => FIRST.indexOf(k) < 0), []);
});
test("A stopped order cannot be dispensed even if its prescription is still pending; nothing changes", async () => {
  const { db, tools } = setup(); db.put("pc_treatment_orders", "o1", Object.assign(snap(db, "pc_treatment_orders", "o1"), { status: "stopped" }));
  await assert.rejects(PCD.runDispense(tools, req({ qty: 5 })), e => e.code === "order_inactive");
  assert.equal(db.get("drugs", "d1").currentStockBase, 30); assert.equal(db.all("dispense_records").length, 0); assert.equal(db.all("stock_transactions").length, 0);
});
test("Retrying the same dispensing request does not deduct stock twice", async () => {
  const { db, tools } = setup(); const r = req({ qty: 12 });
  await PCD.runDispense(tools, r); const again = await PCD.runDispense(tools, r);
  assert.equal(again.duplicate, true); assert.equal(db.get("drugs", "d1").currentStockBase, 18); assert.equal(db.all("stock_transactions").length, 1);
});
