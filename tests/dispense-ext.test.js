/* v17 tests: price/credit, reversals, substitution, consumables. Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const PCD = require("../pc-dispense.js");
const PCX = require("../pc-dispense-ext.js");
const { makeDb } = require("./mock-firestore.js");
const B = "biz1", F = "shop1", UID = "op1";
const AS_OF = new Date(2026, 10, 15, 10, 0, 0);
const day = n => PCD.localDay(new Date(2026, 10, 15 + n));

function setup(opts) {
  opts = opts || {};
  const m = makeDb();
  m.db.put("drugs", "d1", { businessId: B, shopId: F, name: "Ceftriaxone inj", baseUnit: "Vial", stockUnit: "Box", baseUnitsPerStock: 10, wholesale: 5000, retailBase: 1000, currentStockBase: 20 });
  m.db.put("drugs", "d2", { businessId: B, shopId: F, name: "Ceftriaxone other brand", baseUnit: "Vial", stockUnit: "Box", baseUnitsPerStock: 10, wholesale: 6000, retailBase: 1500, currentStockBase: 5 });
  m.db.put("batches", "bA", { businessId: B, shopId: F, drugId: "d1", batchNumber: "A1", expiryDate: day(60), quantity: 20, purchasePricePerStockUnit: 5000 });
  m.db.put("batches", "bB", { businessId: B, shopId: F, drugId: "d2", batchNumber: "B1", expiryDate: day(60), quantity: 5, purchasePricePerStockUnit: 6000 });
  m.db.put("pc_treatment_orders", "o1", Object.assign({ businessId: B, facilityId: F, kind: "medicine", status: "active", patientId: "p1", patientName: "Test Patient", encounterId: "e1",
    medicineId: "d1", medicineName: "Ceftriaxone inj", route: "IM", quantityPrescribed: 10, prescribedAt: AS_OF.getTime(), version: 1 }, opts.order || {}));
  return m;
}
const base = (t, e) => Object.assign({ businessId: B, facilityId: F, uid: UID, userName: "Op", orderId: "o1", drugId: "d1", qty: 4, requestId: PCD.newRequestId(), mode: "fefo",
  candidateBatchIds: ["bA"], asOf: AS_OF, patientConfirmed: true, medicineConfirmed: true, localDay: day(0) }, e || {});
function dispense(tools, o) {
  o = o || {}; const p = base(tools, o.p);
  const f = o.fin === null ? null : Object.assign({ qty: p.qty, drugId: p.drugId, unitPrice: 1000, amountPaid: 0, businessId: B, facilityId: F, uid: UID, userName: "Op", patientId: "p1" }, o.fin);
  if (f) p.hook = PCX.financeHook(tools, f);
  return PCD.runDispense(tools, p).then(r => Object.assign(r, { requestId: p.requestId }));
}
const rejects = async (p, code) => { await assert.rejects(p, e => { assert.equal(e.code, code, "expected " + code + " got " + e.code + " / " + e.message); return true; }); };

// ---------- prices and bill
test("Prices come from the same retail fields as Sales; editable price drives the total", () => {
  assert.equal(PCX.defaultUnitPrice({ retailBase: 30 }), 30);
  assert.equal(PCX.defaultUnitPrice({ retailBase: 0, retailStock: 2000, baseUnitsPerStock: 10 }), 200);
  assert.deepEqual(PCX.bill({ qty: 4, unitPrice: 1000, amountPaid: 0 }).status, "credit");
  const b = PCX.bill({ qty: 4, unitPrice: 1200, amountPaid: 1000 });
  assert.equal(b.total, 4800); assert.equal(b.outstanding, 3800); assert.equal(b.status, "part_paid");
  assert.equal(PCX.bill({ qty: 4, unitPrice: 1000, amountPaid: 99999 }).outstanding, 0);
  assert.equal(PCX.bill({ qty: 4, unitPrice: 0, amountPaid: 0 }).status, "no_charge");
});
test("Unpaid dispensing is CREDIT in Sales' own shapes; stock is deducted once", async () => {
  const { db, tools } = setup();
  const r = await dispense(tools, { fin: { amountPaid: 0, customerName: "Test Patient" } });
  assert.equal(db.get("drugs", "d1").currentStockBase, 16);
  assert.equal(db.get("batches", "bA").quantity, 16);
  const ct = db.all("credit_transactions"); assert.equal(ct.length, 1);
  assert.equal(ct[0].type, "CREDIT_SALE"); assert.equal(ct[0].balanceChange, 4000);
  const sales = db.all("sales"); assert.equal(sales.length, 1); assert.equal(sales[0].paymentStatus, "CREDIT"); assert.equal(sales[0].costOfGoods, 2000);
  assert.equal(db.all("credit_accounts").length, 1);
  const bill = db.get("dispense_bills", r.requestId); assert.equal(bill.paymentStatus, "credit"); assert.equal(bill.amountOutstanding, 4000);
  assert.equal(db.all("stock_transactions").filter(t => t.type !== "DISPENSE").length, 0);
});
test("Part payment splits into one paid and one credit receipt; full payment writes no credit", async () => {
  const a = setup();
  await dispense(a.tools, { fin: { amountPaid: 1500 } });
  assert.deepEqual(a.db.all("receipts").map(x => x.paymentStatus).sort(), ["CREDIT", "PAID"]);
  assert.equal(a.db.all("sales").reduce((s, x) => s + x.total, 0), 4000);
  assert.equal(a.db.all("credit_transactions")[0].amount, 2500);
  const b = setup();
  await dispense(b.tools, { fin: { amountPaid: 4000, method: "Mobile money" } });
  assert.equal(b.db.all("credit_transactions").length, 0); assert.equal(b.db.all("dispense_bills")[0].paymentMethod, "Mobile money");
});
test("Dispensing works with no payment details at all (never blocked by payment)", async () => {
  const { db, tools } = setup();
  await dispense(tools, { fin: null });
  assert.equal(db.get("drugs", "d1").currentStockBase, 16); assert.equal(db.all("receipts").length, 0);
});
test("Retrying the same request creates no second stock deduction and no second financial record", async () => {
  const { db, tools } = setup();
  const id = PCD.newRequestId();
  await dispense(tools, { p: { requestId: id } });
  const r2 = await dispense(tools, { p: { requestId: id } });
  assert.equal(r2.duplicate, true);
  assert.equal(db.get("drugs", "d1").currentStockBase, 16); assert.equal(db.all("sales").length, 1); assert.equal(db.all("credit_transactions").length, 1);
});
test("A failed dispensing writes no money records", async () => {
  const { db, tools } = setup();
  await rejects(dispense(tools, { p: { qty: 11 } }), "over_outstanding");
  assert.equal(db.all("sales").length + db.all("receipts").length + db.all("dispense_bills").length, 0);
});

// ---------- reversal
async function ret(tools, db, o) {
  const recs = db.all("dispense_records").map(r => ({ id: r._id })).reverse();
  return PCX.runReturn(tools, Object.assign({ businessId: B, facilityId: F, uid: UID, userName: "Op", orderId: "o1", requestId: PCD.newRequestId(), qty: 2, reason: "Patient declined", confirmedBack: true, records: recs }, o || {}));
}
test("Reversal of a not-yet-given injection restores stock once and reduces credit", async () => {
  const { db, tools } = setup();
  await dispense(tools, {});
  const id = PCD.newRequestId();
  const r = await ret(tools, db, { requestId: id, qty: 3 });
  assert.equal(r.creditReduced, 3000); assert.equal(r.refundDue, 0);
  assert.equal(db.get("drugs", "d1").currentStockBase, 19); assert.equal(db.get("batches", "bA").quantity, 19);
  const rx = db.get("prescriptions", "o1"); assert.equal(rx.qtyDispensed, 1); assert.equal(rx.qtyOutstanding, 9);
  const bal = db.all("credit_transactions").reduce((s, t) => s + t.balanceChange, 0); assert.equal(bal, 1000);
  assert.equal(db.all("sales").reduce((s, x) => s + x.total, 0), 1000);
  const again = await ret(tools, db, { requestId: id, qty: 3 });          // retry of the same reversal
  assert.equal(again.duplicate, true); assert.equal(db.get("drugs", "d1").currentStockBase, 19);
});
test("Cannot reverse more than was dispensed, in total, however many times", async () => {
  const { db, tools } = setup();
  await dispense(tools, {});
  await ret(tools, db, { qty: 3 });
  await rejects(ret(tools, db, { qty: 2 }), "over_returnable");
  await ret(tools, db, { qty: 1 });
  await rejects(ret(tools, db, { qty: 1 }), "nothing_to_return");
  assert.equal(db.get("drugs", "d1").currentStockBase, 20); assert.equal(db.get("batches", "bA").quantity, 20);
});
test("Paid part is shown as a refund due, and a negative cash sale is written", async () => {
  const { db, tools } = setup();
  await dispense(tools, { fin: { amountPaid: 4000 } });
  const r = await ret(tools, db, { qty: 2 });
  assert.equal(r.refundDue, 2000); assert.equal(r.creditReduced, 0);
  assert.equal(db.all("sales").filter(s => s.total < 0)[0].paymentStatus, "PAID");
});
test("Handed-over medicine cannot be reversed (same transaction check)", async () => {
  const { db, tools } = setup();
  await dispense(tools, { p: { handedOver: true } });
  await rejects(ret(tools, db), "handed_over");
  assert.equal(db.get("drugs", "d1").currentStockBase, 16);
});
test("Marking handed over later closes the reversal; injections stay reversible until then", async () => {
  const { db, tools } = setup();
  const r = await dispense(tools, {});
  await ret(tools, db, { qty: 1 });
  await PCX.runHandover(tools, { businessId: B, facilityId: F, uid: UID, userName: "Op", requestId: r.requestId });
  await rejects(ret(tools, db, { qty: 1 }), "handed_over");
});
test("A dose already recorded as given blocks reversal; a refused/missed dose does not; an unanswerable check blocks", async () => {
  const { db, tools } = setup();
  await dispense(tools, {});
  db.put("pc_mar_records", "m1", { businessId: B, facilityId: F, orderId: "o1", outcome: "refused", status: "active" });
  await ret(tools, db, { qty: 1 });
  db.put("pc_mar_records", "m2", { businessId: B, facilityId: F, orderId: "o1", outcome: "administered", status: "active" });
  await rejects(ret(tools, db, { qty: 1 }), "administered");
  const before = db.snapshot();
  assert.equal(db.snapshot(), before);
  const broken = Object.assign({}, tools, { getDocs: async () => { throw new Error("offline"); } });
  await rejects(ret(broken, db, { qty: 1 }), "mar_unchecked");
});
test("A reversal needs a reason and the 'back and unused' confirmation; never succeeds offline", async () => {
  const { db, tools } = setup();
  await dispense(tools, {});
  await rejects(ret(tools, db, { reason: "x" }), "no_reason");
  await rejects(ret(tools, db, { confirmedBack: false }), "not_back");
  db.offline = true;
  await assert.rejects(ret(tools, db), e => e.code === "unavailable");
  db.offline = false;
  assert.equal(db.get("drugs", "d1").currentStockBase, 16);
});
test("Two devices reversing the same stock at the same time cannot restore it twice", async () => {
  const { db, tools } = setup();
  await dispense(tools, {});
  const recs = db.all("dispense_records").map(r => ({ id: r._id }));
  const mk = () => PCX.runReturn(tools, { businessId: B, facilityId: F, uid: UID, orderId: "o1", requestId: PCD.newRequestId(), qty: 3, reason: "wrong patient", confirmedBack: true, records: recs });
  const res = await Promise.allSettled([mk(), mk()]);
  assert.equal(res.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(db.get("drugs", "d1").currentStockBase, 19);
});
test("Dispense, reverse, dispense again never creates stock", async () => {
  const { db, tools } = setup();
  for (let i = 0; i < 3; i++) { await dispense(tools, { p: { qty: 10 } }); await ret(tools, db, { qty: 10 }); }
  assert.equal(db.get("drugs", "d1").currentStockBase, 20);
  assert.equal(db.all("batches").find(b => b._id === "bA").quantity, 20);
});

// ---------- substitution
test("Substitution needs a reason and an authoriser, and only before anything is dispensed", async () => {
  const { db, tools } = setup();
  await rejects(dispense(tools, { p: { drugId: "d2", candidateBatchIds: ["bB"], qty: 2 } }), "drug_mismatch");
  await rejects(dispense(tools, { p: { drugId: "d2", candidateBatchIds: ["bB"], qty: 2, substitution: { reason: "", authorisedBy: "" } } }), "sub_reason");
  await dispense(tools, { p: { drugId: "d2", candidateBatchIds: ["bB"], qty: 2, substitution: { reason: "Out of stock", authorisedBy: "Dr Test" } }, fin: { drugId: "d2", unitPrice: 1500 } });
  const rx = db.get("prescriptions", "o1"); assert.equal(rx.drugId, "d2"); assert.equal(rx.substitutedForId, "d1"); assert.equal(rx.substitutionAuthorisedBy, "Dr Test");
  assert.equal(db.get("drugs", "d1").currentStockBase, 20); assert.equal(db.get("drugs", "d2").currentStockBase, 3);
  await rejects(dispense(tools, { p: { drugId: "d1", qty: 1, substitution: { reason: "back", authorisedBy: "Dr" } } }), "sub_after_dispense");
});
test("Substitute after a full reversal works; after dispensing without reversal it does not", async () => {
  const { db, tools } = setup();
  await dispense(tools, {});
  await rejects(dispense(tools, { p: { drugId: "d2", candidateBatchIds: ["bB"], qty: 1, substitution: { reason: "x y", authorisedBy: "Dr" } } }), "sub_after_dispense");
  await ret(tools, db, { qty: 4 });
  await dispense(tools, { p: { drugId: "d2", candidateBatchIds: ["bB"], qty: 1, substitution: { reason: "Brand out", authorisedBy: "Dr" } }, fin: { drugId: "d2" } });
  assert.equal(db.get("prescriptions", "o1").drugId, "d2");
});

// ---------- consumables
function cset() {
  const m = setup();
  m.db.put("consumable_items", "c1", { businessId: B, facilityId: F, name: "Syringe 5ml", unit: "piece", qtyOnHand: 10, reorderLevel: 5, active: true });
  m.db.put("consumable_items", "c2", { businessId: B, facilityId: F, name: "Gloves", unit: "pair", qtyOnHand: 1, reorderLevel: 4, active: true });
  return m;
}
const cuse = (tools, items, e) => PCX.runConsumableUse(tools, Object.assign({ businessId: B, facilityId: F, uid: UID, userName: "Op", requestId: PCD.newRequestId(), items, patientId: "p1", orderId: "o1", procedure: "IM injection" }, e || {}));
test("Consumables are whatever was picked: only chosen items move, medicines are untouched", async () => {
  const { db, tools } = cset();
  await cuse(tools, [{ itemId: "c1", qty: 2 }]);
  assert.equal(db.get("consumable_items", "c1").qtyOnHand, 8); assert.equal(db.get("consumable_items", "c2").qtyOnHand, 1);
  assert.equal(db.get("drugs", "d1").currentStockBase, 20);
  await rejects(cuse(tools, []), "c_no_items");
});
test("Consumables: idempotent, no negative stock, no duplicate lines", async () => {
  const { db, tools } = cset();
  const id = PCD.newRequestId();
  await cuse(tools, [{ itemId: "c1", qty: 2 }], { requestId: id });
  assert.equal((await cuse(tools, [{ itemId: "c1", qty: 2 }], { requestId: id })).duplicate, true);
  assert.equal(db.get("consumable_items", "c1").qtyOnHand, 8);
  await rejects(cuse(tools, [{ itemId: "c2", qty: 2 }]), "c_short");
  await rejects(cuse(tools, [{ itemId: "c1", qty: 1 }, { itemId: "c1", qty: 1 }]), "c_dup_item");
  assert.equal(db.get("consumable_items", "c2").qtyOnHand, 1);
});
test("Consumable stock: receive, adjust needs a reason, cannot go below zero, low-stock list, bundle only suggests", async () => {
  const { db, tools } = cset();
  const a = (e) => PCX.runConsumableAdjust(tools, Object.assign({ businessId: B, facilityId: F, uid: UID, requestId: PCD.newRequestId(), itemId: "c2" }, e));
  await a({ kind: "receive", qty: 10 }); assert.equal(db.get("consumable_items", "c2").qtyOnHand, 11);
  await rejects(a({ kind: "adjust", qty: -1 }), "c_reason");
  await a({ kind: "adjust", qty: -2, reason: "Torn packs" }); assert.equal(db.get("consumable_items", "c2").qtyOnHand, 9);
  await rejects(a({ kind: "adjust", qty: -50, reason: "count" }), "c_short");
  const items = [{ id: "c1", name: "S", qtyOnHand: 3, reorderLevel: 5 }, { id: "c2", name: "G", qtyOnHand: 9, reorderLevel: 4 }];
  assert.deepEqual(PCX.lowStock(items).map(x => x.id), ["c1"]);
  const sug = PCX.suggestFromBundle({ items: [{ itemId: "c1", qty: 2 }, { itemId: "zz", qty: 1 }] }, items);
  assert.equal(sug.length, 1); assert.equal(db.get("consumable_items", "c1").qtyOnHand, 10);
});
