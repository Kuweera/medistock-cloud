/* Developer 4 — Firestore security-rules tests (Firebase Emulator).
   Run:  npm install && npm run test:rules        (needs Java 11+ and Node 18+)
   STATUS: written in the sandbox where no emulator could be installed; NOT YET RUN. See docs/SECURITY_TEST_REPORT.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection, query, where, limit, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp } = require("firebase/firestore");
const PCD = require("../pc-dispense.js");

const B = "biz1", A = "shopA", S = "shopB", B2 = "biz2", C = "shopC";
let env;
const P = { "patient.view": true };
const users = {
  owner: { role: "owner", businessId: B, active: true },
  pharm: { role: "operator", businessId: B, shopId: A, active: true, perms: Object.assign({ "dispense.view": true, "dispense.perform": true }, P) },
  viewer: { role: "operator", businessId: B, shopId: A, active: true, perms: { "dispense.view": true } },
  nurse: { role: "operator", businessId: B, shopId: A, active: true, perms: Object.assign({ "treatment.administer": true }, P) },
  dispOnly: { role: "operator", businessId: B, shopId: A, active: true, perms: { "dispense.view": true, "dispense.perform": true } },
  inactive: { role: "operator", businessId: B, shopId: A, active: false, perms: { "dispense.view": true, "dispense.perform": true } },
  pharmB: { role: "operator", businessId: B, shopId: S, active: true, perms: Object.assign({ "dispense.view": true, "dispense.perform": true }, P) },
  stranger: { role: "operator", businessId: B2, shopId: C, active: true, perms: { "dispense.view": true, "dispense.perform": true, "guidelines.manage": true, "guidelines.approve": true, "patient.view": true } },
  author: { role: "operator", businessId: B, shopId: A, active: true, perms: { "guidelines.manage": true } },
  approver: { role: "operator", businessId: B, shopId: A, active: true, perms: { "guidelines.approve": true } },
  rules0: { role: "operator", businessId: B, shopId: A, active: true, perms: { "treatment.prescribe": true } }
};
const db = uid => env.authenticatedContext(uid).firestore();
const stamp = uid => ({ businessId: B, facilityId: A, schemaVersion: 1, createdBy: uid, createdAt: serverTimestamp() });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-medistock", firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    for (const [id, u] of Object.entries(users)) await setDoc(doc(f, "users", id), u);
    await setDoc(doc(f, "shops", A), { businessId: B, enabledServices: ["patient_care"] });
    await setDoc(doc(f, "shops", S), { businessId: B, enabledServices: ["patient_care"] });
    await setDoc(doc(f, "shops", C), { businessId: B2, enabledServices: ["patient_care"] });
    await setDoc(doc(f, "pc_patients", "p1"), { businessId: B, registeredFacilityId: A });
    await setDoc(doc(f, "pc_treatment_orders", "o1"), { businessId: B, facilityId: A, kind: "medicine", status: "active", patientId: "p1" });
    await setDoc(doc(f, "pc_treatment_orders", "o2"), { businessId: B, facilityId: A, kind: "medicine", status: "stopped", patientId: "p1" });
    await setDoc(doc(f, "stock_transactions", "sale1"), { businessId: B, shopId: A, type: "SALE", baseUnitsChange: -1 });
  });
});

// ---- helpers that build the same commit the pharmacy screen builds
function dispense(f, uid, o) {
  o = Object.assign({ req: "aa11", order: "o1", qty: 12, prescribed: 20, already: 0, first: true, lines: 1 }, o || {});
  const b = writeBatch(f), id = o.req + "_0", dispensed = o.already + o.qty, outstanding = o.prescribed - dispensed;
  const status = outstanding <= 0 ? "completed" : "partially_dispensed";
  b.set(doc(f, "dispense_records", id), Object.assign(stamp(uid), { id, prescriptionId: o.order, patientId: "p1", drugId: "d1", batchId: "bA", qtyDispensed: o.qty, dispensedBy: uid, dispensedAt: serverTimestamp(), isSynced: true, requestId: o.req, lineNo: 0, lines: 1, groupQty: o.qty }));
  b.set(doc(f, "stock_transactions", "dsp_" + id), { businessId: B, shopId: A, drugId: "d1", type: "DISPENSE", baseUnitsChange: -o.qty, dispenseRequestId: o.req, prescriptionId: o.order });
  const rxBase = { qtyDispensed: dispensed, qtyOutstanding: outstanding, status, lastDispensedAt: serverTimestamp(), lastDispensedBy: uid, lastRequestId: o.req, updatedBy: uid, updatedAt: serverTimestamp() };
  if (o.first) b.set(doc(f, "prescriptions", o.order), Object.assign(stamp(uid), rxBase, { id: o.order, orderId: o.order, patientId: "p1", encounterId: "e1", drugId: "d1", drugName: "Test", dose: "1 tablet", qtyPrescribed: o.prescribed }));
  else b.update(doc(f, "prescriptions", o.order), rxBase);
  return b;
}

test("dispensing: a pharmacist can dispense (prescription + record + stock entry in one commit)", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
});
test("dispensing: partial then second dispensing continues from the outstanding quantity", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
  await assertSucceeds(dispense(db("pharm"), "pharm", { req: "bb22", qty: 8, already: 12, first: false }).commit());
  let rx;
  await env.withSecurityRulesDisabled(async c => { rx = (await getDoc(doc(c.firestore(), "prescriptions", "o1"))).data(); });
  assert.ok(rx, "prescription o1 should exist after two dispensings");
  assert.equal(rx.status, "completed"); assert.equal(rx.qtyOutstanding, 0);
});
test("dispensing: a dispensing with more than the prescribed quantity is denied", async () => {
  await assertFails(dispense(db("pharm"), "pharm", { qty: 25 }).commit());
});
test("dispensing: after completion no further dispensing is allowed", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm", { qty: 20 }).commit());
  await assertFails(dispense(db("pharm"), "pharm", { req: "cc33", qty: 1, already: 20, first: false }).commit());
});
test("dispensing: a stopped order cannot be dispensed", async () => {
  await assertFails(dispense(db("pharm"), "pharm", { order: "o2" }).commit());
});
test("dispensing: nurse (no dispense.perform), view-only user, other shop and other business are all denied", async () => {
  for (const u of ["nurse", "viewer"]) await assertFails(dispense(db(u), u).commit());
  await assertFails(dispense(db("pharmB"), "pharmB").commit());
  await assertFails(dispense(db("stranger"), "stranger").commit());
});
test("dispensing: the same request cannot be recorded twice (duplicate submission)", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
  await assertFails(dispense(db("pharm"), "pharm", { already: 12, first: false, qty: 4 }).commit());   // same req id "aa11"
});
test("dispensing: a record without its prescription, or a prescription total that does not match the record, is denied", async () => {
  const f = db("pharm"), b = writeBatch(f);
  b.set(doc(f, "dispense_records", "zz_0"), Object.assign(stamp("pharm"), { id: "zz_0", prescriptionId: "o1", patientId: "p1", drugId: "d1", batchId: "bA", qtyDispensed: 5, dispensedBy: "pharm", dispensedAt: serverTimestamp(), isSynced: true, requestId: "zz", lineNo: 0, groupQty: 5 }));
  await assertFails(b.commit());
  const f2 = db("pharm"), b3 = writeBatch(f2);
  b3.set(doc(f2, "prescriptions", "o1"), Object.assign(stamp("pharm"), { id: "o1", orderId: "o1", patientId: "p1", drugId: "d1", qtyPrescribed: 20, qtyDispensed: 20, qtyOutstanding: 0, status: "completed", lastDispensedBy: "pharm", lastRequestId: "ww" }));
  b3.set(doc(f2, "dispense_records", "ww_0"), Object.assign(stamp("pharm"), { id: "ww_0", prescriptionId: "o1", patientId: "p1", drugId: "d1", batchId: "bA", qtyDispensed: 3, dispensedBy: "pharm", dispensedAt: serverTimestamp(), isSynced: true, requestId: "ww", lineNo: 0, groupQty: 3 }));
  await assertFails(b3.commit());   // prescription says 20 dispensed, record says 3
});
test("dispense_records are append-only (even the owner cannot edit or delete)", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
  for (const u of ["pharm", "owner"]) {
    await assertFails(updateDoc(doc(db(u), "dispense_records", "aa11_0"), { qtyDispensed: 1 }));
    await assertFails(deleteDoc(doc(db(u), "dispense_records", "aa11_0")));
    await assertFails(deleteDoc(doc(db(u), "prescriptions", "o1")));
  }
});
test("prescriptions: quantities cannot be lowered or changed outside a dispensing commit", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
  await assertFails(updateDoc(doc(db("pharm"), "prescriptions", "o1"), { qtyDispensed: 2, qtyOutstanding: 18, status: "partially_dispensed", updatedBy: "pharm", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db("pharm"), "prescriptions", "o1"), { qtyPrescribed: 1, updatedBy: "pharm", updatedAt: serverTimestamp() }));
});
test("prescriptions and records: facility isolation on reads", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
  await assertSucceeds(getDoc(doc(db("pharm"), "prescriptions", "o1")));
  await assertSucceeds(getDoc(doc(db("viewer"), "dispense_records", "aa11_0")));
  await assertFails(getDoc(doc(db("nurse"), "prescriptions", "o1")));
  await assertFails(getDoc(doc(db("pharmB"), "prescriptions", "o1")));
  await assertFails(getDoc(doc(db("stranger"), "dispense_records", "aa11_0")));
});

test("stock_transactions: DISPENSE entries are permanent; Sales-type entries behave as before", async () => {
  await assertSucceeds(dispense(db("pharm"), "pharm").commit());
  await assertFails(updateDoc(doc(db("pharm"), "stock_transactions", "dsp_aa11_0"), { baseUnitsChange: 0 }));
  await assertFails(deleteDoc(doc(db("owner"), "stock_transactions", "dsp_aa11_0")));
  await assertSucceeds(updateDoc(doc(db("pharm"), "stock_transactions", "sale1"), { note: "edited" }));   // regression: unchanged
  await assertFails(updateDoc(doc(db("pharm"), "stock_transactions", "sale1"), { type: "DISPENSE" }));   // cannot be relabelled
  await assertSucceeds(deleteDoc(doc(db("pharm"), "stock_transactions", "sale1")));                       // regression: unchanged
});
test("stock_transactions: a DISPENSE entry cannot be created alone", async () => {
  await assertFails(setDoc(doc(db("pharm"), "stock_transactions", "dsp_xx_0"), { businessId: B, shopId: A, drugId: "d1", type: "DISPENSE", baseUnitsChange: -5, dispenseRequestId: "xx" }));
});

// ---- guidelines
const gl = (uid, extra) => Object.assign(stamp(uid), { id: "gl_k1_v1", guidelineKey: "k1", version: 1, scope: "national", approvalStatus: "draft", title: "TEST entry", category: "ncd", symptoms: [], investigations: [], treatment: "", source: "TEST source",
  sourceTitle: "T", sourceOrg: "O", sourceEdition: "2023", sourceRef: "p1", jurisdiction: "Uganda", enteredDate: "2026-11-15", effectiveDate: "2026-11-15", reviewDate: "2027-11-15" }, extra || {});
const approveFields = uid => ({ approvalStatus: "approved", approvedBy: uid, approvedByName: "x", approvedAt: serverTimestamp(), selfApproved: false, updatedBy: uid, updatedAt: serverTimestamp() });

test("guidelines: create needs guidelines.manage; wrong id or category is denied", async () => {
  await assertSucceeds(setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author")));
  await assertFails(setDoc(doc(db("nurse"), "guidelines", "gl_k1_v1"), gl("nurse")));
  await assertFails(setDoc(doc(db("author"), "guidelines", "gl_other_v1"), gl("author")));
  await assertFails(setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author", { category: "not_a_category" })));
  await assertFails(setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author", { approvalStatus: "approved" })));
});
test("guidelines: manage-only user cannot approve; approver can; approved text can no longer be edited; nothing is deleted", async () => {
  await setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author"));
  await assertFails(updateDoc(doc(db("author"), "guidelines", "gl_k1_v1"), approveFields("author")));
  await assertSucceeds(updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), approveFields("approver")));
  await assertFails(updateDoc(doc(db("author"), "guidelines", "gl_k1_v1"), { treatment: "changed", updatedBy: "author", updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db("owner"), "guidelines", "gl_k1_v1")));
});
test("guidelines: approval is refused when source details are incomplete", async () => {
  await setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author", { sourceRef: "" }));
  await assertFails(updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), approveFields("approver")));
});
test("guidelines: an approver can retire an approved entry (with a reason) and discard a draft; no reason is refused", async () => {
  await setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author"));
  await updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), approveFields("approver"));
  const ret = (u, reason) => ({ approvalStatus: "retired", retiredReason: reason, retiredBy: u, retiredByName: "x", retiredAt: serverTimestamp(), updatedBy: u, updatedAt: serverTimestamp() });
  await assertFails(updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), ret("approver", "")));
  await assertFails(updateDoc(doc(db("author"), "guidelines", "gl_k1_v1"), ret("author", "no longer valid")));   // manage-only cannot retire approved
  await assertSucceeds(updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), ret("approver", "no longer valid")));
  await setDoc(doc(db("author"), "guidelines", "gl_k2_v1"), gl("author", { id: "gl_k2_v1", guidelineKey: "k2" }));
  await assertSucceeds(updateDoc(doc(db("author"), "guidelines", "gl_k2_v1"), ret("author", "wrong entry")));   // author may discard own draft
});
test("guidelines: a new version replaces the old one only in the same commit", async () => {
  await setDoc(doc(db("author"), "guidelines", "gl_k1_v1"), gl("author"));
  await updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), approveFields("approver"));
  await setDoc(doc(db("author"), "guidelines", "gl_k1_v2"), gl("author", { id: "gl_k1_v2", version: 2 }));
  await assertFails(updateDoc(doc(db("approver"), "guidelines", "gl_k1_v1"), { approvalStatus: "superseded", supersededBy: "gl_k1_v2", updatedBy: "approver", updatedAt: serverTimestamp() }));
  const f = db("approver"), b = writeBatch(f);
  b.update(doc(f, "guidelines", "gl_k1_v2"), approveFields("approver"));
  b.update(doc(f, "guidelines", "gl_k1_v1"), { approvalStatus: "superseded", supersededBy: "gl_k1_v2", updatedBy: "approver", updatedAt: serverTimestamp() });
  await assertSucceeds(b.commit());
});
test("guidelines: national entries are readable business-wide, facility protocols only by their facility, other businesses never", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const f = c.firestore();
    await setDoc(doc(f, "guidelines", "n1"), gl("author", { id: "n1" }));
    await setDoc(doc(f, "guidelines", "f1"), gl("author", { id: "f1", scope: "facility" }));
  });
  await assertSucceeds(getDoc(doc(db("pharmB"), "guidelines", "n1")));
  await assertFails(getDoc(doc(db("pharmB"), "guidelines", "f1")));
  await assertSucceeds(getDoc(doc(db("nurse"), "guidelines", "f1")));
  await assertFails(getDoc(doc(db("stranger"), "guidelines", "n1")));
});

// ---- existing Phase 1-4 rules that the master plan names explicitly
test("v14: an operator without rules.manage cannot approve a dosing rule", async () => {
  await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), "pc_dosing_rules", "r1"), { businessId: B, facilityId: A, approvalStatus: "draft", medicineName: "TEST", source: "TEST", jurisdiction: "UG", version: 1 }));
  await assertFails(updateDoc(doc(db("rules0"), "pc_dosing_rules", "r1"), { approvalStatus: "approved", approvedBy: "rules0", approvedAt: serverTimestamp(), updatedBy: "rules0", updatedAt: serverTimestamp() }));
});
test("v14: a signed clinical note cannot be edited or deleted", async () => {
  await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), "pc_clinical_notes", "n1"), { businessId: B, facilityId: A, patientId: "p1", status: "signed", authorId: "owner", content: "x" }));
  await assertFails(updateDoc(doc(db("owner"), "pc_clinical_notes", "n1"), { content: "changed", updatedBy: "owner", updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db("owner"), "pc_clinical_notes", "n1")));
});
test("v14: facility isolation — another business cannot read a patient", async () => {
  await assertFails(getDoc(doc(db("stranger"), "pc_patients", "p1")));
});


// =====================================================================================================================
// v16 — the dispensing permission failure. These run the REAL engine (pc-dispense.js runDispense, a real runTransaction)
// against the real rules, because the v15 tests only built write batches and never read a document that does not exist.
// =====================================================================================================================
async function seedEngine() {
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, "drugs", "d1"), { businessId: B, shopId: A, name: "Paracetamol 500mg", dosageForm: "Tablet", baseUnit: "Tablet", currentStockBase: 50 });
    await setDoc(doc(f, "batches", "bA"), { businessId: B, shopId: A, drugId: "d1", batchNumber: "A1", expiryDate: "2099-01-01", quantity: 50 });
    await setDoc(doc(f, "pc_treatment_orders", "e1"), { businessId: B, facilityId: A, kind: "medicine", status: "active", patientId: "p1", patientName: "Test Patient", encounterId: "enc1", medicineId: "d1", medicineName: "Paracetamol 500mg", formulation: "Tablet", strength: "500mg", doseValue: 1, doseUnit: "tablet", quantityPrescribed: 20, prescriberId: "doc1", prescriberName: "Dr T", prescribedAt: Date.now(), version: 1 });
  });
}
const tools = uid => { const f = db(uid); return { db: f, doc, collection, runTransaction, serverTimestamp, query, where, limit, getDocs, getDoc }; };
const params = (uid, o) => Object.assign({ businessId: B, facilityId: A, uid, userName: uid, orderId: "e1", drugId: "d1", qty: 12, requestId: "r" + Math.random().toString(16).slice(2, 12), mode: "fefo", candidateBatchIds: ["bA"],
  asOf: new Date(), patientConfirmed: true, medicineConfirmed: true, localDay: new Date().toISOString().slice(0, 10) }, o || {});

test("v16 engine: the owner can dispense (first dispensing reads a prescription and record that do not exist yet)", async () => {
  await seedEngine();
  const r = await PCD.runDispense(tools("owner"), params("owner"));
  assert.equal(r.duplicate, false);
  await env.withSecurityRulesDisabled(async c => { const rx = (await getDoc(doc(c.firestore(), "prescriptions", "e1"))).data(); assert.equal(rx.qtyDispensed, 12); assert.equal(rx.qtyOutstanding, 8);
    assert.equal((await getDoc(doc(c.firestore(), "drugs", "d1"))).data().currentStockBase, 38); });
});
test("v16 engine: an operator with dispense permission (and NOT patient.view) can dispense, twice, and a retry is a no-op", async () => {
  await seedEngine();
  const p1 = params("dispOnly");
  await PCD.runDispense(tools("dispOnly"), p1);
  const again = await PCD.runDispense(tools("dispOnly"), p1);
  assert.equal(again.duplicate, true);
  const r2 = await PCD.runDispense(tools("dispOnly"), params("dispOnly", { qty: 8 }));
  assert.equal(r2.status, "completed");
  await env.withSecurityRulesDisabled(async c => { assert.equal((await getDoc(doc(c.firestore(), "drugs", "d1"))).data().currentStockBase, 30); });
});
test("v16 engine: operators without dispense.perform, inactive operators, other shop and other business are refused (with a labelled step)", async () => {
  await seedEngine();
  for (const u of ["nurse", "viewer", "inactive", "pharmB", "stranger"]) {
    let err; try { await PCD.runDispense(tools(u), params(u)); } catch (e) { err = e; }
    assert.ok(err, u + " should be refused"); assert.equal(err.code, "permission-denied", u + ": " + (err && err.message));
    assert.ok(err.pcdStep, u + " should carry a step label");
    assert.match(PCD.friendlyError(err), /^You do not have permission to perform this action\./);
  }
  await env.withSecurityRulesDisabled(async c => { assert.equal((await getDoc(doc(c.firestore(), "drugs", "d1"))).data().currentStockBase, 50, "no stock changed"); });
});
test("v16 reads: a missing prescription or record can be probed only by dispensers; existing ones still need dispense.view and the right shop", async () => {
  await seedEngine();
  for (const u of ["owner", "pharm", "dispOnly"]) { await assertSucceeds(getDoc(doc(db(u), "prescriptions", "nothing"))); await assertSucceeds(getDoc(doc(db(u), "dispense_records", "nothing_0"))); }
  for (const u of ["nurse", "viewer", "inactive"]) { await assertFails(getDoc(doc(db(u), "prescriptions", "nothing"))); await assertFails(getDoc(doc(db(u), "dispense_records", "nothing_0"))); }
  // (a dispenser of ANOTHER business can also probe a missing id: the rules cannot tell whose it would be. This reveals only that a guessed id does not exist; existing documents stay protected, tested below.)
  await PCD.runDispense(tools("pharm"), params("pharm"));
  const rxRead = u => getDoc(doc(db(u), "prescriptions", "e1"));
  await assertSucceeds(rxRead("owner")); await assertSucceeds(rxRead("viewer")); await assertFails(rxRead("nurse")); await assertFails(rxRead("pharmB")); await assertFails(rxRead("stranger"));
});
test("v16 reads: dispense.view can list its own facility's prescriptions and records but not another facility's", async () => {
  await seedEngine(); await PCD.runDispense(tools("pharm"), params("pharm"));
  const q = (u, c, fac) => getDocs(query(collection(db(u), c), where("businessId", "==", B), where("facilityId", "==", fac), limit(5)));
  await assertSucceeds(q("viewer", "prescriptions", A)); await assertSucceeds(q("viewer", "dispense_records", A));
  await assertFails(q("viewer", "prescriptions", S)); await assertFails(q("nurse", "dispense_records", A)); await assertFails(q("pharmB", "prescriptions", A));
});
test("v16 reads: dispense.view (without patient.view) can read MEDICINE orders, registration numbers and allergies of its facility, not procedure orders", async () => {
  await seedEngine();
  await env.withSecurityRulesDisabled(async c => {
    const f = c.firestore();
    await setDoc(doc(f, "pc_treatment_orders", "proc1"), { businessId: B, facilityId: A, kind: "procedure", status: "active", patientId: "p1" });
    await setDoc(doc(f, "pc_patient_facility_links", "p1_" + A), { businessId: B, facilityId: A, patientId: "p1", localRegNo: "R-1" });
    await setDoc(doc(f, "pc_allergies", "al1"), { businessId: B, facilityId: A, patientId: "p1", status: "active", substance: "x" });
  });
  await assertSucceeds(getDoc(doc(db("dispOnly"), "pc_treatment_orders", "e1")));
  await assertFails(getDoc(doc(db("dispOnly"), "pc_treatment_orders", "proc1")));
  await assertSucceeds(getDocs(query(collection(db("dispOnly"), "pc_treatment_orders"), where("businessId", "==", B), where("facilityId", "==", A), where("kind", "==", "medicine"), where("status", "==", "active"), limit(5))));
  await assertSucceeds(getDoc(doc(db("dispOnly"), "pc_patient_facility_links", "p1_" + A)));
  await assertSucceeds(getDocs(query(collection(db("dispOnly"), "pc_allergies"), where("businessId", "==", B), where("facilityId", "==", A), where("status", "==", "active"), limit(5))));
  await assertFails(getDoc(doc(db("stranger"), "pc_treatment_orders", "e1")));
  await assertFails(getDoc(doc(db("pharmB"), "pc_treatment_orders", "e1")));
  await assertFails(getDoc(doc(db("viewer"), "pc_treatment_orders", "proc1")));
});
test("v16 access check: the read-only diagnostic finds nothing blocked for a pharmacist and flags what a non-dispenser cannot reach", async () => {
  await seedEngine();
  const okRows = await PCD.diagnose(tools("dispOnly"), { uid: "dispOnly", businessId: B, facilityId: A, role: "operator", perms: users.dispOnly.perms, facility: { businessId: B, enabledServices: ["patient_care"] } });
  assert.deepEqual(okRows.filter(r => !r.ok), []);
  const badRows = await PCD.diagnose(tools("nurse"), { uid: "nurse", businessId: B, facilityId: A, role: "operator", perms: users.nurse.perms, facility: { businessId: B, enabledServices: ["patient_care"] } });
  assert.ok(badRows.some(r => !r.ok && /blocked by the security rules/.test(r.detail)));
});
