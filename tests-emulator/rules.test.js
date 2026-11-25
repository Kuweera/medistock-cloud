/* Developer 4 — Firestore security-rules tests (Firebase Emulator).
   Run:  npm install && npm run test:rules        (needs Java 11+ and Node 18+)
   STATUS: written in the sandbox where no emulator could be installed; NOT YET RUN. See docs/SECURITY_TEST_REPORT.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection, query, where, limit, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp } = require("firebase/firestore");
const PCD = require("../pc-dispense.js");
const PCX = require("../pc-dispense-ext.js");

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
  rev: { role: "operator", businessId: B, shopId: A, active: true, perms: { "dispense.view": true, "dispense.perform": true, "dispense.reverse": true } },
  cman: { role: "operator", businessId: B, shopId: A, active: true, perms: { "consumables.manage": true, "consumables.use": true } },
  cuse: { role: "operator", businessId: B, shopId: A, active: true, perms: { "consumables.use": true } },
  labTech: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "lab.collect": true, "lab.process": true, "lab.result": true, "lab.verify": true } },
  labColl: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "lab.collect": true } },
  labCash: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "lab.payment": true } },
  clin: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "investigation.request": true, "investigation.review": true } },
  prescriber: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "treatment.prescribe": true } },
  prescriberB: { role: "operator", businessId: B, shopId: S, active: true, perms: { "patient.view": true, "treatment.prescribe": true } },
  consultant: { role: "operator", businessId: B, shopId: A, active: true, perms: { "consult.record": true } },
  receptionist: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "patient.register": true } },
  dispReport: { role: "operator", businessId: B, shopId: A, active: true, perms: { "dispense.view": true, "dispense.report": true } },
  p21editor: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "patient.edit": true } },
  p21consent: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "patient.consent": true } },
  triager: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "triage.record": true } },
  labMgr: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "ranges.manage": true } },
  labLead: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "ranges.approve": true } },
  labBoth: { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "ranges.manage": true, "ranges.approve": true } },
  rules0: { role: "operator", businessId: B, shopId: A, active: true, perms: { "treatment.prescribe": true } }
};
// one Firestore object per user for the whole run: building a new one on every call made the SDK refuse to mix documents ("different Firestore instance")
const dbs = {};
const db = uid => dbs[uid] || (dbs[uid] = env.authenticatedContext(uid).firestore());
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
  await assertSucceeds(getDoc(doc(db("nurse"), "prescriptions", "o1")));          // v19: clinicians (administer) may read dispensing
  await assertFails(getDoc(doc(db("receptionist"), "prescriptions", "o1")));      // patient.view alone does not give dispensing
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
  await env.withSecurityRulesDisabled(async c => { const f = c.firestore(); // one Firestore object per context: a second c.firestore() call throws "already started"
    const rx = (await getDoc(doc(f, "prescriptions", "e1"))).data(); assert.equal(rx.qtyDispensed, 12); assert.equal(rx.qtyOutstanding, 8);
    assert.equal((await getDoc(doc(f, "drugs", "d1"))).data().currentStockBase, 38); });
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
  await assertSucceeds(rxRead("owner")); await assertSucceeds(rxRead("viewer")); await assertSucceeds(rxRead("nurse")); await assertFails(rxRead("receptionist")); await assertFails(rxRead("pharmB")); await assertFails(rxRead("stranger"));
});
test("v16 reads: dispense.view can list its own facility's prescriptions and records but not another facility's", async () => {
  await seedEngine(); await PCD.runDispense(tools("pharm"), params("pharm"));
  const q = (u, c, fac) => getDocs(query(collection(db(u), c), where("businessId", "==", B), where("facilityId", "==", fac), limit(5)));
  await assertSucceeds(q("viewer", "prescriptions", A)); await assertSucceeds(q("viewer", "dispense_records", A));
  await assertFails(q("viewer", "prescriptions", S)); await assertSucceeds(q("nurse", "dispense_records", A)); await assertFails(q("receptionist", "dispense_records", A)); await assertFails(q("pharmB", "prescriptions", A));
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
  const okRows = await PCD.diagnose(tools("dispOnly"), { uid: "dispOnly", businessId: B, facilityId: A, role: "operator", perms: Object.assign({}, users.dispOnly.perms, { "dispense.report": true }), facility: { businessId: B, enabledServices: ["patient_care"] } });
  assert.deepEqual(okRows.filter(r => !r.ok), []);
  const badRows = await PCD.diagnose(tools("nurse"), { uid: "nurse", businessId: B, facilityId: A, role: "operator", perms: users.nurse.perms, facility: { businessId: B, enabledServices: ["patient_care"] } });
  assert.ok(badRows.some(r => !r.ok && /blocked by the security rules/.test(r.detail)));
});

// ---------------------------------------------------------------- v17 (NOT RUN in the build environment: needs the Firebase emulator)
const fin = (uid, o) => Object.assign({ qty: 4, drugId: "d1", unitPrice: 100, amountPaid: 0, businessId: B, facilityId: A, uid, userName: uid, patientId: "p1" }, o || {});
async function dispenseWithBill(uid, o, f) { const p = params(uid, Object.assign({ qty: 4 }, o)); p.hook = PCX.financeHook(tools(uid), fin(uid, f)); await PCD.runDispense(tools(uid), p); return p; }
const retParams = (uid, qty, extra) => Object.assign({ businessId: B, facilityId: A, uid, userName: uid, orderId: "e1", requestId: "x" + Math.random().toString(16).slice(2, 10), qty, reason: "declined", confirmedBack: true }, extra || {});
async function recs() { let out = []; await env.withSecurityRulesDisabled(async c => { const s = await getDocs(query(collection(c.firestore(), "dispense_records"), where("prescriptionId", "==", "e1"))); out = s.docs.map(d => ({ id: d.id })); }); return out; }

test("v17: a pharmacist can dispense with a bill (credit), through the real rules, and a retry changes nothing", async () => {
  await seedEngine(); const p = await dispenseWithBill("dispOnly");
  const again = PCD.runDispense(tools("dispOnly"), Object.assign({}, p, { hook: PCX.financeHook(tools("dispOnly"), fin("dispOnly")) })); assert.equal((await again).duplicate, true);
  await env.withSecurityRulesDisabled(async c => { const s = await getDocs(collection(c.firestore(), "credit_transactions")); assert.equal(s.size, 1); });
});
test("v17: only someone with dispense.reverse can reverse; a reversal restores stock once; the ledger caps it", async () => {
  await seedEngine(); await dispenseWithBill("rev");
  await assert.rejects(PCX.runReturn(tools("dispOnly"), Object.assign(retParams("dispOnly", 2), { records: await recs() })));
  await PCX.runReturn(tools("rev"), Object.assign(retParams("rev", 3), { records: await recs() }));
  await assert.rejects(PCX.runReturn(tools("rev"), Object.assign(retParams("rev", 2), { records: await recs() })), "only 1 left");
  await env.withSecurityRulesDisabled(async c => { assert.equal((await getDoc(doc(c.firestore(), "drugs", "d1"))).data().currentStockBase, 49); });
});
test("v17: a handed-over dispensing cannot be reversed; return records, ledger and RETURN stock entries cannot be edited or deleted", async () => {
  await seedEngine(); await dispenseWithBill("rev", { handedOver: true });
  await assert.rejects(PCX.runReturn(tools("rev"), Object.assign(retParams("rev", 1), { records: await recs() })));
  await seedEngine(); await dispenseWithBill("rev", {}, {});
  const r = retParams("rev", 1); await PCX.runReturn(tools("rev"), Object.assign(r, { records: await recs() }));
  for (const [c, id] of [["dispense_returns", "drt_" + r.requestId], ["dispense_return_ledger", (await recs())[0].id], ["stock_transactions", "drt_" + r.requestId + "_0"]]) {
    await assertFails(deleteDoc(doc(db("owner"), c, id))); await assertFails(updateDoc(doc(db("owner"), c, id), { qty: 99, qtyReturned: 99 }));
  }
});
test("v17: a prescription quantity cannot be lowered by hand; the ledger cannot exceed what was dispensed", async () => {
  await seedEngine(); await dispenseWithBill("rev");
  await assertFails(updateDoc(doc(db("rev"), "prescriptions", "e1"), { qtyDispensed: 0, qtyOutstanding: 20, status: "pending", updatedBy: "rev", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db("rev"), "dispense_return_ledger", (await recs())[0].id), Object.assign(stamp("rev"), { id: (await recs())[0].id, recordId: (await recs())[0].id, qtyReturned: 999, lastReturnRequestId: "zz" })));
});
test("v17: substitution is refused by the engine once something is dispensed and needs a reason", async () => {
  await seedEngine(); await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), "drugs", "d2"), { businessId: B, shopId: A, name: "Other", baseUnit: "Tablet", currentStockBase: 10 }));
  await assert.rejects(PCD.runDispense(tools("dispOnly"), params("dispOnly", { drugId: "d2", qty: 1 })));
  await assert.rejects(PCD.runDispense(tools("dispOnly"), params("dispOnly", { drugId: "d2", qty: 1, substitution: { reason: "", authorisedBy: "" } })));
});
test("v17 consumables: use needs a movement; negative stock, other shops and non-permitted users are refused; manage is separate from use", async () => {
  await seedEngine();
  const mg = tools("cman");
  const c = await PCX.createConsumable(mg, { businessId: B, facilityId: A, uid: "cman", name: "Syringe", unit: "piece", reorderLevel: 2 });
  await PCX.runConsumableAdjust(mg, { businessId: B, facilityId: A, uid: "cman", requestId: "rc1", itemId: c.id, kind: "receive", qty: 5 });
  await PCX.runConsumableUse(tools("cuse"), { businessId: B, facilityId: A, uid: "cuse", requestId: "u1", items: [{ itemId: c.id, qty: 2 }] });
  await assert.rejects(PCX.runConsumableUse(tools("cuse"), { businessId: B, facilityId: A, uid: "cuse", requestId: "u2", items: [{ itemId: c.id, qty: 9 }] }));
  await assert.rejects(PCX.runConsumableAdjust(tools("cuse"), { businessId: B, facilityId: A, uid: "cuse", requestId: "a1", itemId: c.id, kind: "adjust", qty: -1, reason: "lost" }), "use is not manage");
  await assert.rejects(PCX.runConsumableUse(tools("pharmB"), { businessId: B, facilityId: A, uid: "pharmB", requestId: "u3", items: [{ itemId: c.id, qty: 1 }] }));
  await assertFails(updateDoc(doc(db("cman"), "consumable_items", c.id), { qtyOnHand: 999, updatedBy: "cman", updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db("owner"), "consumable_items", c.id)));
});

// =====================================================================================================================
// v18 (Developer 4): laboratory specimen steps, corrections, critical notices and bills.  WRITTEN, NOT RUN (no emulator in the sandbox).
// =====================================================================================================================
const upd = (uid, extra) => Object.assign({ updatedAt: serverTimestamp(), updatedBy: uid }, extra);
async function seedLab(status, extra) {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "pc_inv_orders", "L1"), Object.assign({ businessId: B, facilityId: A, patientId: "p1", encounterId: "enc1", status: status, name: "T", resultType: "number", price: 5000, priority: "routine" }, extra || {})); });
}
test("v18 lab: collected -> received -> accepted -> processing need lab.process; a collect-only user cannot receive", async () => {
  await seedLab("collected");
  await assertFails(updateDoc(doc(db("labColl"), "pc_inv_orders", "L1"), upd("labColl", { status: "received", receivedAt: serverTimestamp(), receivedBy: "labColl", receivedByName: "x" })));
  await assertSucceeds(updateDoc(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "received", receivedAt: serverTimestamp(), receivedBy: "labTech", receivedByName: "x" })));
  await assertSucceeds(updateDoc(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "accepted", acceptedAt: serverTimestamp(), acceptedBy: "labTech", acceptedByName: "x", specimenCondition: "ok" })));
  await assertSucceeds(updateDoc(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "processing", processingAt: serverTimestamp(), processingBy: "labTech", processingByName: "x" })));
});
test("v18 lab: a specimen can be rejected only with a reason, and a rejected order cannot move on", async () => {
  await seedLab("received");
  await assertFails(updateDoc(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "rejected", rejectedAt: serverTimestamp(), rejectedBy: "labTech", rejectedByName: "x", rejectReason: "", rejectCode: "x" })));
  await assertSucceeds(updateDoc(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "rejected", rejectedAt: serverTimestamp(), rejectedBy: "labTech", rejectedByName: "x", rejectReason: "Haemolysed", rejectCode: "Haemolysed" })));
  await assertFails(updateDoc(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "processing", processingAt: serverTimestamp(), processingBy: "labTech", processingByName: "x" })));
});
test("v18 lab: a correction needs a reason and keeps the old result; a verified result is never edited", async () => {
  await seedLab("processing");
  const r = (id, extra) => Object.assign(stamp("labTech"), { orderId: "L1", patientId: "p1", value: 3, status: "unverified", enteredBy: "labTech" }, extra || {});
  const b1 = writeBatch(db("labTech")); b1.set(doc(db("labTech"), "pc_inv_results", "L1"), r()); b1.update(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "resulted", resultedAt: serverTimestamp(), resultedBy: "labTech", resultedByName: "x", currentResultId: "L1" })); await assertSucceeds(b1.commit());
  const b2 = writeBatch(db("labTech")); b2.set(doc(db("labTech"), "pc_inv_results", "L2"), r("L2", { amends: "L1" })); b2.update(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "resulted", resultedAt: serverTimestamp(), resultedBy: "labTech", resultedByName: "x", currentResultId: "L2" })); await assertFails(b2.commit());
  const b3 = writeBatch(db("labTech")); b3.set(doc(db("labTech"), "pc_inv_results", "L2"), r("L2", { amends: "L1", correctionReason: "typo" })); b3.update(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "resulted", resultedAt: serverTimestamp(), resultedBy: "labTech", resultedByName: "x", currentResultId: "L2" })); await assertSucceeds(b3.commit());
  await assertFails(updateDoc(doc(db("labTech"), "pc_inv_results", "L1"), upd("labTech", { value: 99 })));
  await assertFails(deleteDoc(doc(db("owner"), "pc_inv_results", "L1")));
});
test("v18 lab: a critical notice can exist only with a critical result, is acknowledged by a clinician (not the lab), and is never deleted", async () => {
  await seedLab("processing");
  const res = (crit) => Object.assign(stamp("labTech"), { orderId: "L1", patientId: "p1", value: 3, status: "unverified", enteredBy: "labTech", critical: crit });
  const alert = Object.assign(stamp("labTech"), { orderId: "L1", patientId: "p1", resultId: "L1", status: "open" });
  const bad = writeBatch(db("labTech")); bad.set(doc(db("labTech"), "pc_inv_results", "L1"), res(false)); bad.update(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "resulted", resultedAt: serverTimestamp(), resultedBy: "labTech", resultedByName: "x", currentResultId: "L1" })); bad.set(doc(db("labTech"), "pc_lab_alerts", "L1"), alert);
  await assertFails(bad.commit());
  const good = writeBatch(db("labTech")); good.set(doc(db("labTech"), "pc_inv_results", "L1"), res(true)); good.update(doc(db("labTech"), "pc_inv_orders", "L1"), upd("labTech", { status: "resulted", resultedAt: serverTimestamp(), resultedBy: "labTech", resultedByName: "x", currentResultId: "L1" })); good.set(doc(db("labTech"), "pc_lab_alerts", "L1"), alert);
  await assertSucceeds(good.commit());
  await assertFails(updateDoc(doc(db("labTech"), "pc_lab_alerts", "L1"), upd("labTech", { status: "informed", informedBy: "labTech", informedByName: "x", informedAt: serverTimestamp(), informedPerson: "", informedHow: "phone" })));
  await assertSucceeds(updateDoc(doc(db("labTech"), "pc_lab_alerts", "L1"), upd("labTech", { status: "informed", informedBy: "labTech", informedByName: "x", informedAt: serverTimestamp(), informedPerson: "Dr Test", informedHow: "phone" })));
  await assertFails(updateDoc(doc(db("labTech"), "pc_lab_alerts", "L1"), upd("labTech", { status: "acknowledged", ackedBy: "labTech", ackedByName: "x", ackedAt: serverTimestamp(), ackNote: "" })));
  await assertSucceeds(updateDoc(doc(db("clin"), "pc_lab_alerts", "L1"), upd("clin", { status: "acknowledged", ackedBy: "clin", ackedByName: "x", ackedAt: serverTimestamp(), ackNote: "" })));
  await assertFails(deleteDoc(doc(db("owner"), "pc_lab_alerts", "L1")));
});
test("v18 lab bills: one per order, sums must match, no charge needs a reason, reversal needs a reason, lab-only staff cannot read bills, nothing is deleted", async () => {
  await seedLab("verified");
  const bill = Object.assign(stamp("labCash"), { orderId: "L1", patientId: "p1", price: 5000, amountPaid: 1000, amountOutstanding: 4000, amountWaived: 0, status: "part_paid", customerName: "x" });
  await assertFails(setDoc(doc(db("labTech"), "pc_lab_bills", "L1"), bill));
  await assertFails(setDoc(doc(db("labCash"), "pc_lab_bills", "L1"), Object.assign({}, bill, { amountOutstanding: 1 })));
  await assertFails(setDoc(doc(db("labCash"), "pc_lab_bills", "L1"), Object.assign({}, bill, { price: 1, amountPaid: 1, amountOutstanding: 0 })));
  await assertFails(setDoc(doc(db("labCash"), "pc_lab_bills", "L1"), Object.assign({}, bill, { amountPaid: 0, amountOutstanding: 0, amountWaived: 5000, status: "waived" })));
  await assertSucceeds(setDoc(doc(db("labCash"), "pc_lab_bills", "L1"), bill));
  await assertFails(setDoc(doc(db("labCash"), "pc_lab_bills", "L1"), Object.assign({}, bill, { amountPaid: 5000, amountOutstanding: 0, status: "paid" })));
  await assertFails(getDoc(doc(db("labTech"), "pc_lab_bills", "L1")));
  await assertSucceeds(getDoc(doc(db("labCash"), "pc_lab_bills", "L1")));
  await assertFails(updateDoc(doc(db("labCash"), "pc_lab_bills", "L1"), upd("labCash", { status: "reversed", reverseReason: "", reversedBy: "labCash", reversedByName: "x", reversedAt: serverTimestamp() })));
  await assertSucceeds(updateDoc(doc(db("labCash"), "pc_lab_bills", "L1"), upd("labCash", { status: "reversed", reverseReason: "wrong patient", reversedBy: "labCash", reversedByName: "x", reversedAt: serverTimestamp() })));
  await assertFails(deleteDoc(doc(db("owner"), "pc_lab_bills", "L1")));
});
test("v18 lab: the cashier may look for a missing credit account, the lab technician may not", async () => {
  await assertSucceeds(getDoc(doc(db("labCash"), "credit_accounts", "dspca_p1")));
  await assertFails(getDoc(doc(db("labTech"), "credit_accounts", "dspca_p1")));
});

test("v18: administration records are readable by a user with dispense.reverse, not by a plain dispenser", async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "pc_mar_records", "m1"), { businessId: B, facilityId: A, orderId: "e1", patientId: "p1", outcome: "administered", status: "active" }); });
  await assertSucceeds(getDoc(doc(db("rev"), "pc_mar_records", "m1")));
  await assertFails(getDoc(doc(db("dispOnly"), "pc_mar_records", "m1")));
});

// ======================= v19 (Lead Developer): pending prescriptions, clinician read of dispensing, bill read =======================
const rxPending = (uid, id, extra) => Object.assign(stamp(uid), { id, orderId: id, patientId: "p1", encounterId: "e1", planId: "pl1", patientName: "Test", medicineName: "TEST drug",
  drugId: "d1", status: "pending", qtyPrescribed: 20, qtyDispensed: 0, qtyOutstanding: 20, qtySetBy: "prescriber" }, extra || {});
const orderDoc = (uid, extra) => Object.assign(stamp(uid), { kind: "medicine", status: "active", patientId: "p1", encounterId: "e1", planId: "pl1", prescriberId: uid, scheduleType: "once", version: 1, medicineName: "TEST drug", doseValue: 1 }, extra || {});
async function seedV19() {
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, "pc_encounters", "e1"), { businessId: B, facilityId: A, patientId: "p1", status: "open" });
    await setDoc(doc(f, "pc_treatment_plans", "pl1"), { businessId: B, facilityId: A, patientId: "p1", status: "active" });
  });
}
function prescribeBatch(f, uid, id, orderExtra, rxExtra) {
  const b = writeBatch(f);
  b.set(doc(f, "pc_treatment_orders", id), orderDoc(uid, orderExtra));
  b.set(doc(f, "prescriptions", id), rxPending(uid, id, rxExtra));
  return b;
}
test("v19: a clinician creates the order and its PENDING prescription in one commit", async () => {
  await seedV19();
  await assertSucceeds(prescribeBatch(db("prescriber"), "prescriber", "n1").commit());
});
test("v19: a pending prescription with no quantity (qtyUnknown) and no drug is accepted; with neither a quantity nor the flag it is refused", async () => {
  await seedV19();
  await assertSucceeds(prescribeBatch(db("prescriber"), "prescriber", "n2", {}, { qtyPrescribed: 0, qtyOutstanding: 0, qtyUnknown: true, drugId: null }).commit());
  await assertFails(prescribeBatch(db("prescriber"), "prescriber", "n3", {}, { qtyPrescribed: 0, qtyOutstanding: 0, drugId: null }).commit());
});
test("v19: a pending prescription cannot be created without its order, for another patient, dispensed, by a non-prescriber, or in another facility", async () => {
  await seedV19();
  const alone = writeBatch(db("prescriber")); alone.set(doc(db("prescriber"), "prescriptions", "n4"), rxPending("prescriber", "n4"));
  await assertFails(alone.commit());
  await assertFails(prescribeBatch(db("prescriber"), "prescriber", "n5", {}, { patientId: "other" }).commit());
  await assertFails(prescribeBatch(db("prescriber"), "prescriber", "n6", {}, { qtyDispensed: 5, qtyOutstanding: 15, status: "partially_dispensed" }).commit());
  await assertFails(prescribeBatch(db("viewer"), "viewer", "n7").commit());
  await assertFails(prescribeBatch(db("prescriberB"), "prescriberB", "n8").commit());
});
test("v19: stopping the order cancels the pending prescription in the same commit; a cancel on its own, or after dispensing, is refused", async () => {
  await seedV19();
  await assertSucceeds(prescribeBatch(db("prescriber"), "prescriber", "n9").commit());
  const f = db("prescriber"), up = { updatedBy: "prescriber", updatedAt: serverTimestamp() };
  const alone = writeBatch(f); alone.update(doc(f, "prescriptions", "n9"), Object.assign({ status: "cancelled", endedBy: "prescriber", endedAt: serverTimestamp(), endReason: "stopped" }, up));
  await assertFails(alone.commit());
  const ok = writeBatch(f);
  ok.update(doc(f, "pc_treatment_orders", "n9"), Object.assign({ status: "stopped", endedBy: "prescriber", endedAt: serverTimestamp(), endReason: "not needed" }, up));
  ok.update(doc(f, "prescriptions", "n9"), Object.assign({ status: "cancelled", endedBy: "prescriber", endedAt: serverTimestamp(), endReason: "not needed" }, up));
  await assertSucceeds(ok.commit());
  // after something was dispensed the prescription can no longer be cancelled
  await env.withSecurityRulesDisabled(async ctx => { const g = ctx.firestore(); await setDoc(doc(g, "prescriptions", "n10"), Object.assign(rxPending("prescriber", "n10"), { status: "partially_dispensed", qtyDispensed: 5, qtyOutstanding: 15 })); await setDoc(doc(g, "pc_treatment_orders", "n10"), { businessId: B, facilityId: A, kind: "medicine", status: "active", patientId: "p1", prescriberId: "prescriber" }); });
  const late = writeBatch(f);
  late.update(doc(f, "pc_treatment_orders", "n10"), Object.assign({ status: "stopped", endedBy: "prescriber", endedAt: serverTimestamp(), endReason: "late stop" }, up));
  late.update(doc(f, "prescriptions", "n10"), Object.assign({ status: "cancelled", endedBy: "prescriber", endedAt: serverTimestamp(), endReason: "late stop" }, up));
  await assertFails(late.commit());
});
test("v19: the pharmacy can dispense a pending prescription whose quantity and drug were open, stating them itself; a drug already set cannot be changed this way", async () => {
  await seedV19();
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "prescriptions", "o1"), rxPending("pharm", "o1", { qtyPrescribed: 0, qtyOutstanding: 0, qtyUnknown: true, drugId: null })); });
  const f = db("pharm"), b = writeBatch(f), id = "zz11_0";
  b.set(doc(f, "dispense_records", id), Object.assign(stamp("pharm"), { id, prescriptionId: "o1", patientId: "p1", drugId: "d1", batchId: "bA", qtyDispensed: 12, groupQty: 12, dispensedBy: "pharm", dispensedAt: serverTimestamp(), isSynced: true, requestId: "zz11", lineNo: 0 }));
  b.set(doc(f, "stock_transactions", "dsp_" + id), { businessId: B, shopId: A, drugId: "d1", type: "DISPENSE", baseUnitsChange: -12, dispenseRequestId: "zz11", prescriptionId: "o1" });
  b.update(doc(f, "prescriptions", "o1"), { qtyPrescribed: 12, qtyUnknown: false, qtySetBy: "pharmacy", drugId: "d1", drugName: "TEST", qtyDispensed: 12, qtyOutstanding: 0, status: "completed", lastDispensedAt: serverTimestamp(), lastDispensedBy: "pharm", lastRequestId: "zz11", updatedBy: "pharm", updatedAt: serverTimestamp() });
  await assertSucceeds(b.commit());
});
test("v19: clinicians (prescribe, administer, consult) can read prescriptions and dispense records of their facility; a receptionist and another facility cannot", async () => {
  await seedV19();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, "prescriptions", "r1"), { businessId: B, facilityId: A, status: "pending", qtyDispensed: 0 });
    await setDoc(doc(f, "dispense_records", "r1_0"), { businessId: B, facilityId: A, prescriptionId: "r1" });
    await setDoc(doc(f, "dispense_bills", "r1"), { businessId: B, facilityId: A, total: 100 });
  });
  for (const u of ["prescriber", "nurse", "consultant"]) {
    if (u === "nurse") { await assertSucceeds(getDoc(doc(db(u), "prescriptions", "r1"))); } else { await assertSucceeds(getDoc(doc(db(u), "prescriptions", "r1"))); await assertSucceeds(getDoc(doc(db(u), "dispense_records", "r1_0"))); }
    await assertFails(getDoc(doc(db(u), "dispense_bills", "r1")));
  }
  await assertFails(getDoc(doc(db("receptionist"), "prescriptions", "r1")));
  await assertFails(getDoc(doc(db("prescriberB"), "prescriptions", "r1")));
  await assertFails(getDoc(doc(db("stranger"), "prescriptions", "r1")));
  const q = query(collection(db("prescriber"), "prescriptions"), where("businessId", "==", B), where("facilityId", "==", A));
  await assertSucceeds(getDocs(q));
});
test("v19: dispensing bills (money) are readable with dispense.report or dispense.perform, not by a view-only user", async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "dispense_bills", "b1"), { businessId: B, facilityId: A, total: 100 }); });
  await assertSucceeds(getDoc(doc(db("dispReport"), "dispense_bills", "b1")));
  await assertSucceeds(getDoc(doc(db("pharm"), "dispense_bills", "b1")));
  await assertFails(getDoc(doc(db("viewer"), "dispense_bills", "b1")));
  await assertSucceeds(getDoc(doc(db("owner"), "dispense_bills", "b1")));
});
test("v19 lab ledger: the lab cashier writes the bill and its `sales` rows in ONE commit; rows of another shop are refused; the same rows cannot be rewritten by a retry (fixed ids)", async () => {
  await seedLab("verified");
  const f = db("labCash"), bill = Object.assign(stamp("labCash"), { orderId: "L1", patientId: "p1", price: 5000, amountPaid: 2000, amountOutstanding: 3000, amountWaived: 0, status: "part_paid", customerName: "x" });
  const row = (id, total, status, shop) => ({ businessId: B, shopId: shop || A, ownerUid: "labCash", drugId: "lab_t1", drugName: "Test", drugClass: "Laboratory", unitLevel: "base", qty: 1, baseQtyDeducted: 0, pricePerUnit: Math.abs(total), total, costOfGoods: 0, receiptId: null, cashier: "x", paymentStatus: status, source: "laboratory", labOrderId: "L1", createdAt: serverTimestamp() });
  const wrong = writeBatch(f); wrong.set(doc(f, "pc_lab_bills", "L1"), bill); wrong.set(doc(f, "sales", "labsl_L1_p"), row("p", 2000, "PAID", S));
  await assertFails(wrong.commit());
  const ok = writeBatch(f); ok.set(doc(f, "pc_lab_bills", "L1"), bill); ok.set(doc(f, "sales", "labsl_L1_p"), row("p", 2000, "PAID")); ok.set(doc(f, "sales", "labsl_L1_c"), row("c", 3000, "CREDIT"));
  await assertSucceeds(ok.commit());
  // the shop-wide rule for `sales` lets a shop member update rows, so the fixed id only blocks a second CREATE through the bill rule: a repeat bill for the same order is refused
  const again = writeBatch(f); again.set(doc(f, "pc_lab_bills", "L1"), bill);
  await assertFails(again.commit());
});
// ======================= v20 (Lead): visit journey hint =======================
test("v20 journey: staff with an encounter permission can set a small valid journey hint; invalid values, extra keys, oversized notes and users without an encounter permission are refused", async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "pc_encounters", "ej1"), { businessId: B, facilityId: A, patientId: "p1", status: "open", stage: "registered" }); });
  const up = (u, journey, extra) => updateDoc(doc(db(u), "pc_encounters", "ej1"), Object.assign({ journey, updatedBy: u, updatedAt: serverTimestamp() }, extra || {}));
  const good = { v: 1, next: "investigation", waiting: ["laboratory", "clinician"], note: "FBC and malaria test" };
  await assertSucceeds(up("consultant", good));
  await assertSucceeds(up("consultant", { v: 1, next: "none" }, { stage: "in_consultation" }));
  await assertFails(up("consultant", Object.assign({}, good, { next: "teleport" })));
  await assertFails(up("consultant", Object.assign({}, good, { secret: "x" })));
  await assertFails(up("consultant", Object.assign({}, good, { v: 2 })));
  await assertFails(up("consultant", Object.assign({}, good, { waiting: ["laboratory", "pharmacy", "treatment", "clinician", "patient"] })));
  await assertFails(up("consultant", Object.assign({}, good, { waiting: ["bank"] })));
  await assertFails(up("consultant", Object.assign({}, good, { note: "x".repeat(141) })));
  await assertFails(up("consultant", "a string"));
  await assertFails(up("receptionist", good));
  await assertFails(up("prescriberB", good));
});
test("v20 journey: it cannot be set on a closed encounter, and no other field can ride along with it", async () => {
  await env.withSecurityRulesDisabled(async ctx => { const g = ctx.firestore(); await setDoc(doc(g, "pc_encounters", "ej2"), { businessId: B, facilityId: A, patientId: "p1", status: "closed", stage: "registered" }); await setDoc(doc(g, "pc_encounters", "ej3"), { businessId: B, facilityId: A, patientId: "p1", status: "open", stage: "registered", reason: "x" }); });
  await assertFails(updateDoc(doc(db("consultant"), "pc_encounters", "ej2"), { journey: { v: 1, next: "none" }, updatedBy: "consultant", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db("consultant"), "pc_encounters", "ej3"), { journey: { v: 1, next: "none" }, reason: "changed", updatedBy: "consultant", updatedAt: serverTimestamp() }));
});

// ======================= v21 (Lead): identity corrections, snapshot refresh, share expiry =======================
const seedPatient21 = async id => env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "pc_patients", id), { businessId: B, facilityId: A, registeredFacilityId: A, status: "active", fullName: "Old Name", nameKey: "old name", sex: "male", phone: "0700", schemaVersion: 1, createdBy: "x" }); });
const corr21 = (uid, id, n, extra) => Object.assign({ businessId: B, facilityId: A, schemaVersion: 1, createdBy: uid, createdAt: serverTimestamp(), patientId: id, version: n, reason: "Misspelt at registration", before: { fullName: "Old Name", nameKey: "old name" }, after: { fullName: "New Name", nameKey: "new name" }, correctedBy: uid }, extra || {});
const upd21 = uid => ({ updatedBy: uid, updatedAt: serverTimestamp() });
test("v21 corrections: a name/sex/date-of-birth change needs a correction record in the same commit; other edits stay as before", async () => {
  await seedPatient21("px");
  const f = db("p21editor"), pref = doc(f, "pc_patients", "px");
  await assertFails(updateDoc(pref, Object.assign({ fullName: "New Name", nameKey: "new name" }, upd21("p21editor"))));
  await assertFails(updateDoc(pref, Object.assign({ fullName: "New Name", nameKey: "new name", identityVersion: 1 }, upd21("p21editor"))));
  const alone = writeBatch(f); alone.set(doc(f, "pc_patient_corrections", "px_1"), corr21("p21editor", "px", 1)); await assertFails(alone.commit());
  const skip = writeBatch(f); skip.update(pref, Object.assign({ fullName: "New Name", nameKey: "new name", identityVersion: 3 }, upd21("p21editor"))); skip.set(doc(f, "pc_patient_corrections", "px_3"), corr21("p21editor", "px", 3)); await assertFails(skip.commit());
  const short = writeBatch(f); short.update(pref, Object.assign({ fullName: "New Name", nameKey: "new name", identityVersion: 1 }, upd21("p21editor"))); short.set(doc(f, "pc_patient_corrections", "px_1"), corr21("p21editor", "px", 1, { reason: "x" })); await assertFails(short.commit());
  const foreign = writeBatch(db("viewer")); foreign.update(doc(db("viewer"), "pc_patients", "px"), Object.assign({ fullName: "New Name", nameKey: "new name", identityVersion: 1 }, upd21("viewer"))); foreign.set(doc(db("viewer"), "pc_patient_corrections", "px_1"), corr21("viewer", "px", 1)); await assertFails(foreign.commit());
  await assertSucceeds(updateDoc(pref, Object.assign({ phone: "0711" }, upd21("p21editor"))));   // not an identity field
  const ok = writeBatch(f); ok.update(pref, Object.assign({ fullName: "New Name", nameKey: "new name", identityVersion: 1 }, upd21("p21editor"))); ok.set(doc(f, "pc_patient_corrections", "px_1"), corr21("p21editor", "px", 1)); await assertSucceeds(ok.commit());
  const next = writeBatch(f); next.update(pref, Object.assign({ sex: "female", identityVersion: 2 }, upd21("p21editor"))); next.set(doc(f, "pc_patient_corrections", "px_2"), corr21("p21editor", "px", 2, { before: { sex: "male" }, after: { sex: "female" } })); await assertSucceeds(next.commit());
  await assertSucceeds(getDoc(doc(f, "pc_patient_corrections", "px_1")));
  await assertFails(updateDoc(doc(f, "pc_patient_corrections", "px_1"), { reason: "changed later" }));
  await assertFails(deleteDoc(doc(f, "pc_patient_corrections", "px_1")));
  await assertFails(getDoc(doc(db("stranger"), "pc_patient_corrections", "px_1")));
});
const shareDoc21 = extra => Object.assign({ businessId: B, facilityId: A, patientId: "psh", granteeBusinessId: B, granteeFacilityId: S, granteeFacilityName: "B", patientSnapshot: { fullName: "Old Name" }, purpose: "care", consentMethod: "verbal", consentGivenBy: "Self", grantedBy: "x", schemaVersion: 1, createdBy: "x" }, extra || {});
const seedShare21 = async extra => { await seedPatient21("psh"); await env.withSecurityRulesDisabled(async ctx => { const g = ctx.firestore(); await setDoc(doc(g, "pc_shares", "psh_" + A + "_" + B), shareDoc21(extra)); await setDoc(doc(g, "pc_allergies", "alsh"), { businessId: B, facilityId: A, patientId: "psh", status: "active", substance: "x" }); }); };
test("v21 shares: the sharing facility can refresh the snapshot of an active share; nothing else can ride along; others and revoked shares are refused", async () => {
  await seedShare21();
  const f = db("p21consent"), ref = doc(f, "pc_shares", "psh_" + A + "_" + B), u = upd21("p21consent");
  await assertSucceeds(updateDoc(ref, Object.assign({ patientSnapshot: { fullName: "New Name" }, snapshotAt: serverTimestamp() }, u)));
  await assertFails(updateDoc(ref, Object.assign({ patientSnapshot: { fullName: "New Name" }, snapshotAt: new Date(Date.now() - 3600000) }, u)));   // a client-made time that is not the server time (an exact "now" could coincide with it by chance)
  await assertFails(updateDoc(ref, Object.assign({ patientSnapshot: { fullName: "X" }, snapshotAt: serverTimestamp(), purpose: "other" }, u)));
  await assertFails(updateDoc(ref, Object.assign({ patientSnapshot: "text", snapshotAt: serverTimestamp() }, u)));
  await assertFails(updateDoc(doc(db("p21editor"), "pc_shares", "psh_" + A + "_" + B), Object.assign({ patientSnapshot: { fullName: "X" }, snapshotAt: serverTimestamp() }, upd21("p21editor"))));
  await assertFails(updateDoc(doc(db("prescriberB"), "pc_shares", "psh_" + A + "_" + B), Object.assign({ patientSnapshot: { fullName: "X" }, snapshotAt: serverTimestamp() }, upd21("prescriberB"))));
});
test("v21 shares: a revoked share cannot be refreshed or given an expiry", async () => {
  await seedShare21({ revokedAt: new Date(), revokedBy: "x" });
  const f = db("p21consent"), ref = doc(f, "pc_shares", "psh_" + A + "_" + B);
  await assertFails(updateDoc(ref, Object.assign({ patientSnapshot: { fullName: "N" }, snapshotAt: serverTimestamp() }, upd21("p21consent"))));
  await assertFails(updateDoc(ref, Object.assign({ consentExpiresAt: new Date(Date.now() + 86400000) }, upd21("p21consent"))));
});
test("v21 expiry: a share can be given a future end date, extended or cleared, never a past date; once the date has passed the receiving facility can no longer read the patient's shared records", async () => {
  await seedShare21();
  const f = db("p21consent"), ref = doc(f, "pc_shares", "psh_" + A + "_" + B), u = upd21("p21consent"), allergy = () => getDoc(doc(env.authenticatedContext("prescriberB").firestore(), "pc_allergies", "alsh"));   // fresh client each time: no cached result can hide a refusal
  await assertSucceeds(allergy());                                                                   // no expiry: works as before
  await assertFails(updateDoc(ref, Object.assign({ consentExpiresAt: new Date(Date.now() - 86400000) }, u)));
  await assertSucceeds(updateDoc(ref, Object.assign({ consentExpiresAt: new Date(Date.now() + 86400000) }, u)));
  await assertSucceeds(allergy());                                                                   // not yet expired
  await assertSucceeds(updateDoc(ref, Object.assign({ consentExpiresAt: new Date(Date.now() + 5 * 86400000) }, u)));
  await assertSucceeds(updateDoc(ref, Object.assign({ consentExpiresAt: null }, u)));
  await env.withSecurityRulesDisabled(async ctx => {
    const g = ctx.firestore(), r = doc(g, "pc_shares", "psh_" + A + "_" + B);
    await updateDoc(r, { consentExpiresAt: new Date(Date.now() - 60000) });
    const saved = (await getDoc(r)).data(); assert.ok(saved.consentExpiresAt && saved.consentExpiresAt.toMillis() < Date.now(), "fixture: the stored expiry is in the past"); assert.equal(saved.revokedAt === undefined || saved.revokedAt === null, true);
  });
  await assertFails(allergy());                                                                      // expired
  await assertSucceeds(getDoc(doc(db("prescriberB"), "pc_shares", "psh_" + A + "_" + B)));           // the share itself stays readable, so the screen can say "expired"
});
test("v21 expiry: a new share can start with a future end date but not a past one", async () => {
  await seedPatient21("psh");
  const f = db("p21consent"), id = "psh_" + A + "_" + B;
  const mk = extra => Object.assign({}, shareDoc21(extra), { createdBy: "p21consent", createdAt: serverTimestamp(), grantedBy: "p21consent", schemaVersion: 1 });
  await assertFails(setDoc(doc(f, "pc_shares", id), mk({ consentExpiresAt: new Date(Date.now() - 86400000) })));
  await assertSucceeds(setDoc(doc(f, "pc_shares", id), mk({ consentExpiresAt: new Date(Date.now() + 86400000) })));
});

// ======================= v22 (Lead): order care mode =======================
test("v22 administrationMode: optional on a new order; only the three agreed values; cannot be changed afterwards; old orders without it still work", async () => {
  await seedV19();
  const f = db("prescriber"), mk = (id, mode) => setDoc(doc(f, "pc_treatment_orders", id), Object.assign(orderDoc("prescriber"), mode === undefined ? {} : { administrationMode: mode }));
  await assertSucceeds(mk("m0"));
  for (const [i, m] of ["take_home", "facility_administered", "inpatient_mar"].entries()) await assertSucceeds(mk("m" + (i + 1), m));
  await assertFails(mk("m9", "bogus"));
  await assertFails(mk("m8", 5));
  await assertFails(updateDoc(doc(f, "pc_treatment_orders", "m1"), { administrationMode: "inpatient_mar", updatedBy: "prescriber", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(f, "pc_treatment_orders", "m1"), { status: "stopped", endedBy: "prescriber", endedAt: serverTimestamp(), endReason: "not needed", updatedBy: "prescriber", updatedAt: serverTimestamp() }));
});

// ======================= v23 (Lead): attendance for facility-administered doses; consumables as orders (Option B) =======================
async function seed23(mode, evStatus, evExtra) {
  await seedV19();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, "pc_treatment_orders", "o23"), Object.assign(orderDoc("prescriber"), { createdAt: new Date() }, mode === null ? {} : { administrationMode: mode }));
    await setDoc(doc(f, "pc_treatment_events", "o23_a"), Object.assign({ businessId: B, facilityId: A, orderId: "o23", patientId: "p1", status: evStatus || "pending", idKey: "a", plannedAt: 1700000000000, plannedDay: "2026-11-20" }, evExtra || {}));
  });
}
const arrive23 = (uid, extra) => updateDoc(doc(db(uid), "pc_treatment_events", "o23_a"), Object.assign({ attendance: "attended", attendanceAt: 1700000100000, attendanceBy: uid, attendanceByName: uid, updatedAt: serverTimestamp(), updatedBy: uid }, extra || {}));
function dna23(uid, o) {
  o = o || {};
  const f = db(uid), b = writeBatch(f);
  if (!o.noMar) b.set(doc(f, "pc_mar_records", "mr23"), Object.assign(stamp(uid), { orderId: "o23", eventId: "o23_a", patientId: "p1", outcome: "missed", omissionReason: o.reason === undefined ? "did not come" : o.reason, attendance: "did_not_attend", status: "active", administeredBy: uid, actualAt: 1700000200000 }, o.mar || {}));
  b.update(doc(f, "pc_treatment_events", "o23_a"), Object.assign({ status: "missed", lastRecordId: "mr23", actualAt: 1700000200000, administeredBy: uid, administeredByName: uid, attendance: "did_not_attend", attendanceAt: 1700000200000, attendanceBy: uid, attendanceByName: uid, updatedAt: serverTimestamp(), updatedBy: uid }, o.ev || {}));
  return b.commit();
}
test("v23 attendance: arrival on a pending facility-administered dose is allowed for treatment.administer and keeps the status pending; undo is allowed", async () => {
  await seed23("facility_administered");
  await assertSucceeds(arrive23("nurse"));
  await assertSucceeds(updateDoc(doc(db("nurse"), "pc_treatment_events", "o23_a"), { attendance: null, updatedAt: serverTimestamp(), updatedBy: "nurse" }));
});
test("v23 attendance: arrival is refused for take_home, inpatient_mar and missing-mode orders, for non-pending events, for users without treatment.administer, for another uid, with status change or extra keys", async () => {
  for (const mode of ["take_home", "inpatient_mar", null]) { await seed23(mode); await assertFails(arrive23("nurse")); await env.clearFirestore(); }
  await seed23("facility_administered", "administered"); await assertFails(arrive23("nurse")); await env.clearFirestore();
  await seed23("facility_administered");
  await assertFails(arrive23("prescriber"));                                   // no treatment.administer
  await assertFails(arrive23("nurse", { attendanceBy: "prescriber" }));         // someone else's uid
  await assertFails(arrive23("nurse", { status: "administered" }));             // status change
  await assertFails(arrive23("nurse", { actualDoseValue: 5 }));                 // extra key
  await assertFails(arrive23("nurse", { attendance: "maybe" }));
});
test("v23 attendance: DID NOT ATTEND needs its MAR record (missed, reason of 3+ characters) in the same commit and a facility-administered pending dose", async () => {
  await seed23("facility_administered");
  await assertSucceeds(dna23("nurse"));
});
test("v23 attendance: did-not-attend refused without the MAR record, with a short reason, after arrival, with another status, or on a non-facility order", async () => {
  await seed23("facility_administered"); await assertFails(dna23("nurse", { noMar: true })); await env.clearFirestore();
  await seed23("facility_administered"); await assertFails(dna23("nurse", { reason: "ab" })); await env.clearFirestore();
  await seed23("facility_administered", "pending", { attendance: "attended", attendanceBy: "nurse", attendanceAt: 1 }); await assertFails(dna23("nurse")); await env.clearFirestore();
  await seed23("facility_administered"); await assertFails(dna23("nurse", { ev: { status: "refused" }, mar: { outcome: "refused" } })); await env.clearFirestore();
  await seed23("inpatient_mar"); await assertFails(dna23("nurse")); await env.clearFirestore();
  await seed23("facility_administered"); await assertFails(dna23("nurse", { mar: { attendance: "attended" } }));
});
test("v23 attendance: the administration record may carry attendance only as did_not_attend with outcome missed", async () => {
  await seed23("facility_administered");
  const f = db("nurse"), mk = (id, extra) => setDoc(doc(f, "pc_mar_records", id), Object.assign(stamp("nurse"), { orderId: "o23", eventId: "o23_a", patientId: "p1", outcome: "missed", omissionReason: "no show", status: "active", administeredBy: "nurse", actualAt: 1 }, extra));
  await assertFails(mk("x1", { attendance: "attended" }));
  await assertFails(mk("x2", { attendance: "did_not_attend", outcome: "refused" }));
  await assertSucceeds(mk("x3", { attendance: "did_not_attend" }));
});
test("v23 attendance: correcting a did-not-attend record (mar.amend) returns the dose to pending and must clear the attendance", async () => {
  await seed23("facility_administered");
  await assertSucceeds(dna23("nurse"));
  const fixer = "amender";
  await env.withSecurityRulesDisabled(async ctx => {
    const g = ctx.firestore();   // one Firestore object per context
    await setDoc(doc(g, "users", fixer), { role: "operator", businessId: B, shopId: A, active: true, perms: { "patient.view": true, "mar.amend": true } });
    await updateDoc(doc(g, "pc_mar_records", "mr23"), { status: "entered_in_error", errorReason: "wrong patient" });
  });
  const ref = doc(env.authenticatedContext(fixer).firestore(), "pc_treatment_events", "o23_a"), u = { updatedAt: serverTimestamp(), updatedBy: fixer };
  await assertFails(updateDoc(ref, Object.assign({ status: "pending" }, u)));                                  // attendance not cleared
  await assertSucceeds(updateDoc(ref, Object.assign({ status: "pending", attendance: null }, u)));
});
test("v23 consumables: a clinician creates a consumable order with its pending prescription in one commit; kind 'consumable' is checked for quantity, item and schedule", async () => {
  await seedV19();
  const cons = extra => Object.assign({ kind: "consumable", medicineId: "d1", medicineName: "TEST gauze", quantityPrescribed: 3, scheduleType: "once" }, extra || {});
  const strip = o => { const t = Object.assign({}, o); return t; };
  const mk = (id, oExtra) => { const f = db("prescriber"), b = writeBatch(f); const o = orderDoc("prescriber", cons(oExtra)); delete o.doseValue; b.set(doc(f, "pc_treatment_orders", id), o); b.set(doc(f, "prescriptions", id), rxPending("prescriber", id, { medicineName: "TEST gauze" })); return b.commit(); };
  await assertSucceeds(mk("c1"));
  await assertFails(mk("c2", { quantityPrescribed: 0 }));
  await assertFails(mk("c3", { medicineId: null }));
  await assertFails(mk("c4", { scheduleType: "daily" }));
});
test("v23 consumables: the supplies user reads the consumable order; a consumable order cannot have dose events; other kinds are still refused", async () => {
  await seedV19();
  const f = db("prescriber"), b = writeBatch(f), o = orderDoc("prescriber", { kind: "consumable", medicineId: "d1", medicineName: "TEST gauze", quantityPrescribed: 3 }); delete o.doseValue;
  b.set(doc(f, "pc_treatment_orders", "c9"), o); b.set(doc(f, "prescriptions", "c9"), rxPending("prescriber", "c9", { medicineName: "TEST gauze" }));
  await b.commit();
  await assertSucceeds(getDoc(doc(db("pharm"), "pc_treatment_orders", "c9")));
  await assertFails(setDoc(doc(db("prescriber"), "pc_treatment_orders", "c10"), orderDoc("prescriber", { kind: "bogus" })));
  const e = writeBatch(db("prescriber"));
  e.set(doc(db("prescriber"), "pc_treatment_events", "c9_a"), Object.assign(stamp("prescriber"), { orderId: "c9", patientId: "p1", status: "pending", idKey: "a", plannedAt: 1, plannedDay: "2026-11-20" }));
  await assertFails(e.commit());
});

// ======================= v24 (Lead): guideline import (sources and sections) =======================
const SHA = "ab12cd34ef56ab78" + "0".repeat(48);
const src24 = (uid, extra) => Object.assign(stamp(uid), { id: "gsrc_" + SHA.slice(0, 16), fileName: "ucg.pdf", fileType: "pdf", fileSizeBytes: 1000, sha256: SHA, pageCount: 3, extractionMethod: "text", ocrUsed: false,
  ocrPages: [], extractionWarnings: [], sectionCount: 1, sourceTitle: "TEST source", sourceOrg: "TEST org", jurisdiction: "TEST", sourceEdition: "2099", status: "imported" }, extra || {});
const sec24 = (uid, extra) => Object.assign(stamp(uid), { sourceId: "gsrc_" + SHA.slice(0, 16), seq: 1, kind: "paragraph", headingPath: ["TEST"], text: "TEST text", ocr: false, reviewStatus: "unreviewed" }, extra || {});
const srcId24 = "gsrc_" + SHA.slice(0, 16), secId24 = srcId24 + "_s00001";
test("v24 import: a guidelines.manage user saves a source and its section in one commit; the same file again, a wrong id, missing source details or a status other than imported are refused", async () => {
  const f = db("author"), b = writeBatch(f);
  b.set(doc(f, "guideline_sources", srcId24), src24("author")); b.set(doc(f, "guideline_sections", secId24), sec24("author"));
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(f, "guideline_sources", srcId24), src24("author")));                                   // second import of the same file is an overwrite, not a create
  await assertFails(setDoc(doc(f, "guideline_sources", "gsrc_wrong"), src24("author")));
  await assertFails(setDoc(doc(f, "guideline_sources", "gsrc_" + "9".repeat(16)), src24("author", { sha256: "9".repeat(64), sourceOrg: "" })));
  await assertFails(setDoc(doc(f, "guideline_sources", "gsrc_" + "8".repeat(16)), src24("author", { sha256: "8".repeat(64), status: "rejected" })));
});
test("v24 import: sections need an existing source of the same business, the right id and kind; users without guidelines.manage and other businesses are refused", async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "guideline_sources", srcId24), Object.assign(src24("author"), { createdAt: new Date() })); });
  const f = db("author");
  await assertSucceeds(setDoc(doc(f, "guideline_sections", secId24), sec24("author")));
  await assertFails(setDoc(doc(f, "guideline_sections", srcId24 + "_s2"), sec24("author", { seq: 2 })));                // id not in the agreed form
  await assertFails(setDoc(doc(f, "guideline_sections", srcId24 + "_s00002"), sec24("author", { seq: 2, kind: "script" })));
  await assertFails(setDoc(doc(f, "guideline_sections", srcId24 + "_s00003"), sec24("author", { seq: 3, sourceId: "gsrc_missing000000" })));
  await assertFails(setDoc(doc(db("approver"), "guideline_sections", srcId24 + "_s00004"), sec24("approver", { seq: 4 })));   // approve is not manage
  await assertFails(setDoc(doc(db("stranger"), "guideline_sections", srcId24 + "_s00005"), Object.assign(sec24("stranger", { seq: 5 }), { businessId: B2, facilityId: C })));
});
test("v24 import: manage and approve users read sources and sections, others do not; only an approver can reject (with a reason); sections can only be marked used or discarded; nothing is deleted", async () => {
  await env.withSecurityRulesDisabled(async ctx => { const g = ctx.firestore();
    await setDoc(doc(g, "guideline_sources", srcId24), Object.assign(src24("author"), { createdAt: new Date() }));
    await setDoc(doc(g, "guideline_sections", secId24), Object.assign(sec24("author"), { createdAt: new Date() })); });
  await assertSucceeds(getDoc(doc(db("author"), "guideline_sources", srcId24)));
  await assertSucceeds(getDoc(doc(db("approver"), "guideline_sections", secId24)));
  await assertFails(getDoc(doc(db("nurse"), "guideline_sources", srcId24)));
  await assertFails(getDoc(doc(db("stranger"), "guideline_sources", srcId24)));
  const u = uid => ({ updatedAt: serverTimestamp(), updatedBy: uid });
  await assertSucceeds(updateDoc(doc(db("author"), "guideline_sections", secId24), Object.assign({ reviewStatus: "used", usedInGuidelineId: "gl_k1_v1" }, u("author"))));
  await assertFails(updateDoc(doc(db("author"), "guideline_sections", secId24), Object.assign({ text: "changed" }, u("author"))));
  await assertFails(updateDoc(doc(db("author"), "guideline_sources", srcId24), Object.assign({ status: "rejected", rejectedReason: "bad scan", rejectedBy: "author" }, u("author"))));
  await assertFails(updateDoc(doc(db("approver"), "guideline_sources", srcId24), Object.assign({ status: "rejected", rejectedReason: "x", rejectedBy: "approver" }, u("approver"))));
  await assertSucceeds(updateDoc(doc(db("approver"), "guideline_sources", srcId24), Object.assign({ status: "rejected", rejectedReason: "bad scan", rejectedBy: "approver", rejectedAt: Date.now() }, u("approver"))));
  await assertFails(deleteDoc(doc(db("author"), "guideline_sections", secId24)));
});

test("v24 import: retire needs a reason and the approver's own uid; the planned section count of an imported source may only grow; a 400-section batch is accepted", async () => {
  const f = db("author"), b = writeBatch(f);
  b.set(doc(f, "guideline_sources", srcId24), src24("author", { sectionCount: 400 }));
  for (let i = 1; i <= 399; i++) b.set(doc(f, "guideline_sections", srcId24 + "_s" + String(i).padStart(5, "0")), sec24("author", { seq: i }));
  await assertSucceeds(b.commit());
  const u = uid => ({ updatedAt: serverTimestamp(), updatedBy: uid });
  await assertSucceeds(updateDoc(doc(db("author"), "guideline_sources", srcId24), Object.assign({ sectionCount: 450 }, u("author"))));
  await assertFails(updateDoc(doc(db("author"), "guideline_sources", srcId24), Object.assign({ sectionCount: 10 }, u("author"))));
  await assertFails(updateDoc(doc(db("author"), "guideline_sources", srcId24), Object.assign({ sectionCount: 460, sourceTitle: "changed" }, u("author"))));
  await assertFails(updateDoc(doc(db("approver"), "guideline_sources", srcId24), Object.assign({ status: "retired", retiredBy: "approver" }, u("approver"))));            // no reason
  await assertSucceeds(updateDoc(doc(db("approver"), "guideline_sources", srcId24), Object.assign({ status: "retired", retiredReason: "replaced by new edition", retiredBy: "approver", retiredByName: "A", retiredAt: Date.now() }, u("approver"))));
});

// ======================= v25 (Lead): reference ranges (all values below are obviously fake test values) =======================
const rr25 = (uid, extra) => Object.assign(stamp(uid), { rangeKey: "k1", version: 1, approvalStatus: "draft", subjectType: "lab_test", subjectId: "t1", paramKey: "", paramLabel: "TEST", unit: "TESTunit",
  refMin: 1, refMax: 2, sex: "any", minAgeMonths: null, maxAgeMonths: null, pregnancy: "any", source: "TEST source", effectiveDate: "2099-01-01", reviewDate: "" }, extra || {});
const rrU = uid => ({ updatedAt: serverTimestamp(), updatedBy: uid });
async function seedRR(id, extra) { await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "pc_reference_ranges", id), Object.assign(rr25("labMgr"), { createdAt: new Date() }, extra || {})); }); }
test("v25 ranges: ranges.manage creates a DRAFT; missing key, wrong status, wrong id, bad subject, empty unit, short source, bad lists, no bounds, min>max, bad ages and another facility are refused", async () => {
  const f = db("labMgr"), mk = (id, extra) => setDoc(doc(f, "pc_reference_ranges", id), rr25("labMgr", extra));
  await assertSucceeds(mk("rr_k1_v1"));
  await assertFails(setDoc(doc(db("labLead"), "pc_reference_ranges", "rr_k1_v1"), rr25("labLead")));
  await assertFails(mk("rr_k2_v1", { rangeKey: "k2", approvalStatus: "approved" }));
  await assertFails(mk("rr_wrong", { rangeKey: "k3" }));
  await assertFails(mk("rr_k4_v1", { rangeKey: "k4", subjectType: "bogus" }));
  await assertFails(mk("rr_k5_v1", { rangeKey: "k5", unit: "" }));
  await assertFails(mk("rr_k6_v1", { rangeKey: "k6", source: "ab" }));
  await assertFails(mk("rr_k7_v1", { rangeKey: "k7", sex: "other" }));
  await assertFails(mk("rr_k8_v1", { rangeKey: "k8", pregnancy: "maybe" }));
  await assertFails(mk("rr_k9_v1", { rangeKey: "k9", refMin: null, refMax: null }));
  await assertSucceeds(mk("rr_k10_v1", { rangeKey: "k10", refMin: null, refMax: null, refText: "TEST text" }));
  await assertFails(mk("rr_k11_v1", { rangeKey: "k11", refMin: 5, refMax: 2 }));
  await assertFails(mk("rr_k12_v1", { rangeKey: "k12", minAgeMonths: 12, maxAgeMonths: 12 }));
  await assertFails(mk("rr_k13_v1", { rangeKey: "k13", minAgeMonths: -1 }));
  await assertFails(mk("rr_k14_v1", { rangeKey: "k14", facilityId: S }));
});
test("v25 ranges: a draft can be edited by ranges.manage but identity fields and approved ranges cannot be changed", async () => {
  await seedRR("rr_k1_v1"); await seedRR("rr_k2_v1", { rangeKey: "k2", approvalStatus: "approved", approvedBy: "labLead", selfApproved: false });
  const f = db("labMgr");
  await assertSucceeds(updateDoc(doc(f, "pc_reference_ranges", "rr_k1_v1"), Object.assign({ refMax: 3 }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(f, "pc_reference_ranges", "rr_k1_v1"), Object.assign({ subjectId: "other" }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(f, "pc_reference_ranges", "rr_k1_v1"), Object.assign({ rangeKey: "zz" }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(f, "pc_reference_ranges", "rr_k1_v1"), Object.assign({ unit: "" }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(f, "pc_reference_ranges", "rr_k2_v1"), Object.assign({ refMax: 9 }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(db("labLead"), "pc_reference_ranges", "rr_k1_v1"), Object.assign({ refMax: 3 }, rrU("labLead"))));            // approve is not manage
});
test("v25 ranges: approval needs ranges.approve, the caller as approvedBy, a correct selfApproved, only approval keys, an effective date and a sane review date", async () => {
  await seedRR("rr_k1_v1"); await seedRR("rr_k2_v1", { rangeKey: "k2", effectiveDate: "" }); await seedRR("rr_k3_v1", { rangeKey: "k3", reviewDate: "2098-01-01" });
  const ap = (uid, id, extra) => updateDoc(doc(db(uid), "pc_reference_ranges", id), Object.assign({ approvalStatus: "approved", approvedBy: uid, approvedByName: uid, approvedAt: serverTimestamp(), selfApproved: false, reviewerCredential: "TEST reviewer" }, rrU(uid), extra || {}));
  await assertFails(ap("labMgr", "rr_k1_v1"));                                                   // no ranges.approve
  await assertFails(ap("labLead", "rr_k1_v1", { approvedBy: "labMgr" }));
  await assertFails(ap("labLead", "rr_k1_v1", { selfApproved: true }));                           // wrong selfApproved
  await assertFails(ap("labLead", "rr_k1_v1", { refMax: 99 }));                                   // other key changed
  await assertFails(ap("labLead", "rr_k2_v1"));                                                   // no effective date
  await assertFails(ap("labLead", "rr_k3_v1"));                                                   // review date before effective date
  await assertSucceeds(ap("labLead", "rr_k1_v1"));
  await seedRR("rr_k4_v1", { rangeKey: "k4", createdBy: "labBoth" });
  await assertSucceeds(ap("labBoth", "rr_k4_v1", { selfApproved: true }));                        // self-approval is recorded, not blocked
});
test("v25 ranges: a newer version replaces the old one in the same commit only; other key, lower version or no newer approved version are refused", async () => {
  await seedRR("rr_k1_v1", { approvalStatus: "approved", approvedBy: "labLead", selfApproved: false });
  await seedRR("rr_k1_v2", { version: 2 }); await seedRR("rr_k9_v3", { rangeKey: "k9", version: 3 });
  const f = db("labLead"), b = writeBatch(f);
  b.update(doc(f, "pc_reference_ranges", "rr_k1_v2"), Object.assign({ approvalStatus: "approved", approvedBy: "labLead", approvedByName: "L", approvedAt: serverTimestamp(), selfApproved: false, reviewerCredential: "TEST reviewer" }, rrU("labLead")));
  b.update(doc(f, "pc_reference_ranges", "rr_k1_v1"), Object.assign({ approvalStatus: "superseded", supersededBy: "rr_k1_v2" }, rrU("labLead")));
  await assertSucceeds(b.commit());
});
test("v25 ranges: supersede alone, with another range key or with a lower version is refused", async () => {
  await seedRR("rr_k1_v2", { version: 2, approvalStatus: "approved", approvedBy: "labLead", selfApproved: false });
  await seedRR("rr_k1_v1", { version: 1, approvalStatus: "approved", approvedBy: "labLead", selfApproved: false });
  await seedRR("rr_k5_v3", { rangeKey: "k5", version: 3, approvalStatus: "approved", approvedBy: "labLead", selfApproved: false });
  const f = db("labLead"), sup = (id, by) => updateDoc(doc(f, "pc_reference_ranges", id), Object.assign({ approvalStatus: "superseded", supersededBy: by }, rrU("labLead")));
  await assertFails(sup("rr_k1_v2", "rr_k1_v1"));                // replaced by a LOWER version
  await assertFails(sup("rr_k1_v1", "rr_k5_v3"));                // different range key
  await assertSucceeds(sup("rr_k1_v1", "rr_k1_v2"));             // the newer version is already approved
  await assertFails(updateDoc(doc(db("labMgr"), "pc_reference_ranges", "rr_k5_v3"), Object.assign({ approvalStatus: "superseded", supersededBy: "rr_k1_v2" }, rrU("labMgr"))));
});
test("v25 ranges: retire needs a reason and the caller; only ranges.approve may retire an approved range; ranges.manage may discard a draft; delete never", async () => {
  await seedRR("rr_k1_v1", { approvalStatus: "approved", approvedBy: "labLead", selfApproved: false }); await seedRR("rr_k2_v1", { rangeKey: "k2" });
  const rt = (uid, id, extra) => updateDoc(doc(db(uid), "pc_reference_ranges", id), Object.assign({ approvalStatus: "retired", retiredReason: "replaced by the new kit", retiredBy: uid, retiredByName: uid, retiredAt: Date.now() }, rrU(uid), extra || {}));
  await assertFails(rt("labMgr", "rr_k1_v1"));                                      // manage cannot retire an approved range
  await assertFails(rt("labLead", "rr_k1_v1", { retiredReason: "x" }));
  await assertFails(rt("labLead", "rr_k1_v1", { retiredBy: "labMgr" }));
  await assertSucceeds(rt("labLead", "rr_k1_v1"));
  await assertSucceeds(rt("labMgr", "rr_k2_v1"));                                   // discard a draft
  await assertFails(deleteDoc(doc(db("labLead"), "pc_reference_ranges", "rr_k1_v1")));
});
test("v25 ranges: members with patient.view read; another facility and users without patient.view do not", async () => {
  await seedRR("rr_k1_v1", { approvalStatus: "approved", approvedBy: "labLead", selfApproved: false });
  await assertSucceeds(getDoc(doc(db("nurse"), "pc_reference_ranges", "rr_k1_v1")));
  await assertFails(getDoc(doc(db("pharmB"), "pc_reference_ranges", "rr_k1_v1")));
  await assertFails(getDoc(doc(db("dispOnly"), "pc_reference_ranges", "rr_k1_v1")));
});

// ======================= v26 (Lead): alert rules, acknowledgements, lactation, observation fields (all values are fake test values) =======================
const ar26 = (uid, extra) => Object.assign(stamp(uid), { ruleKey: "a1", version: 1, approvalStatus: "draft", subjectType: "vital", subjectId: "spo2", unit: "%", level: "critical", operator: "lt", value: 1,
  message: "TEST alert", urgencyText: "TEST", minAgeMonths: 0, maxAgeMonths: null, reproductive: "any", contextRequired: [], requiresAck: true, source: "TEST source", effectiveDate: "2099-01-01", reviewDate: "" }, extra || {});
test("v26 alert rules: ranges.manage creates a draft; operator/value, range bounds, critical without acknowledgement, vital without age limits, bad level or text and a missing key are refused", async () => {
  const f = db("labMgr"), mk = (key, extra) => setDoc(doc(f, "pc_alert_rules", "ar_" + key + "_v1"), ar26("labMgr", Object.assign({ ruleKey: key }, extra || {})));
  await assertSucceeds(mk("a1"));
  await assertSucceeds(mk("a2", { operator: "range", min: 1, max: 2, value: null }));
  await assertSucceeds(mk("a3", { level: "moderate", requiresAck: false }));
  await assertFails(mk("a4", { operator: "range", min: 3, max: 2 }));
  await assertFails(mk("a5", { operator: "gt", value: null }));
  await assertFails(mk("a6", { requiresAck: false }));                                 // critical needs acknowledgement
  await assertFails(mk("a7", { minAgeMonths: null, maxAgeMonths: null }));            // a vital with no age limits must say allAges
  await assertSucceeds(mk("a8", { minAgeMonths: null, maxAgeMonths: null, allAges: true }));
  await assertFails(mk("a9", { level: "severe" }));
  await assertFails(mk("a10", { message: "x" }));
  await assertFails(mk("a11", { reproductive: "maybe" }));
  await assertFails(setDoc(doc(db("labLead"), "pc_alert_rules", "ar_a12_v1"), ar26("labLead", { ruleKey: "a12" })));          // approve is not manage
  await assertFails(mk("a13", { approvalStatus: "approved" }));
});
test("v26 alert rules: approve by a person with ranges.approve; replace by a newer version in the same commit; retire with a reason; delete never; read by facility members only", async () => {
  await env.withSecurityRulesDisabled(async ctx => { const g = ctx.firestore(); const base = Object.assign(ar26("labMgr"), { createdAt: new Date() });
    await setDoc(doc(g, "pc_alert_rules", "ar_a1_v1"), Object.assign({}, base, { approvalStatus: "approved", approvedBy: "labLead", selfApproved: false }));
    await setDoc(doc(g, "pc_alert_rules", "ar_a1_v2"), Object.assign({}, base, { version: 2 })); });
  const f = db("labLead"), b = writeBatch(f);
  b.update(doc(f, "pc_alert_rules", "ar_a1_v2"), Object.assign({ approvalStatus: "approved", approvedBy: "labLead", approvedByName: "L", approvedAt: serverTimestamp(), selfApproved: false, reviewerCredential: "TEST reviewer" }, rrU("labLead")));
  b.update(doc(f, "pc_alert_rules", "ar_a1_v1"), Object.assign({ approvalStatus: "superseded", supersededBy: "ar_a1_v2" }, rrU("labLead")));
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(db("labMgr"), "pc_alert_rules", "ar_a1_v2"), Object.assign({ approvalStatus: "retired", retiredReason: "no longer used", retiredBy: "labMgr" }, rrU("labMgr"))));
  await assertSucceeds(updateDoc(doc(f, "pc_alert_rules", "ar_a1_v2"), Object.assign({ approvalStatus: "retired", retiredReason: "no longer used", retiredBy: "labLead" }, rrU("labLead"))));
  await assertFails(deleteDoc(doc(f, "pc_alert_rules", "ar_a1_v2")));
  await assertSucceeds(getDoc(doc(db("nurse"), "pc_alert_rules", "ar_a1_v2")));
  await assertFails(getDoc(doc(db("pharmB"), "pc_alert_rules", "ar_a1_v2")));
});
test("v26 ranges: lactation values are accepted, a bad value is refused, and a vital range without age limits needs allAges", async () => {
  const f = db("labMgr"), mk = (key, extra) => setDoc(doc(f, "pc_reference_ranges", "rr_" + key + "_v1"), rr25("labMgr", Object.assign({ rangeKey: key }, extra)));
  for (const [i, v] of ["pregnant", "lactating", "pregnant_or_lactating", "neither", "any"].entries()) await assertSucceeds(mk("rp" + i, { reproductive: v }));
  await assertFails(mk("rpx", { reproductive: "maybe" }));
  await assertFails(mk("rv1", { subjectType: "vital", subjectId: "pulse" }));
  await assertSucceeds(mk("rv2", { subjectType: "vital", subjectId: "pulse", allAges: true }));
  await assertSucceeds(mk("rv3", { subjectType: "vital", subjectId: "pulse", minAgeMonths: 0, maxAgeMonths: 12 }));
});
test("v26 observations: a triage record may carry interp, ctx and repeatOf (bounded), and a critical alert is acknowledged by its recorder in an append-only record", async () => {
  await seedV19();
  const f = db("triager"), tri = (id, extra) => setDoc(doc(f, "pc_triage", id), Object.assign(stamp("triager"), { encounterId: "e1", patientId: "p1", recordedBy: "triager", status: "active", spo2: 90 }, extra || {}));
  await assertSucceeds(tri("t1", { interp: { spo2: { level: "critical", unit: "%", ruleVersion: 1 } }, ctx: { calm: true } }));
  await assertSucceeds(tri("t2", { repeatOf: "t1" }));
  await assertFails(tri("t3", { interp: "text" }));
  await assertFails(tri("t4", { repeatOf: 5 }));
  const ack = (id, extra) => setDoc(doc(f, "pc_obs_acks", id), Object.assign(stamp("triager"), { encounterId: "e1", patientId: "p1", recordedBy: "triager", status: "active", triageId: "t1", measure: "spo2", level: "critical", ruleId: "ar_a1_v1", ruleVersion: 1, ackBy: "triager", note: "seen" }, extra || {}));
  await assertSucceeds(ack("ack_t1_spo2"));
  await assertFails(ack("ack_t1_pulse"));                                  // id does not match the measure
  await assertFails(ack("ack_t1_spo2x", { measure: "spo2x", triageId: "nope" }));
  await assertFails(ack("ack_t1_bp", { measure: "bp", ackBy: "labMgr" }));
  await assertFails(updateDoc(doc(f, "pc_obs_acks", "ack_t1_spo2"), { note: "changed" }));
  await assertFails(setDoc(doc(db("labMgr"), "pc_obs_acks", "ack_t2_spo2"), Object.assign(stamp("labMgr"), { encounterId: "e1", patientId: "p1", recordedBy: "labMgr", status: "active", triageId: "t2", measure: "spo2", level: "critical", ruleId: "r", ruleVersion: 1, ackBy: "labMgr" })));
});

// ======================= v27 (Lead): reviewed proposals (all values are fake test values) =======================
test("v27 review: an approval without the reviewer's credential is refused; a proposal can be REJECTED with a reason (kept, never active); the original proposal and origin cannot be edited", async () => {
  await seedRR("rr_k1_v1", { origin: "evidence_proposal", proposal: { refMin: 1, refMax: 2, source: "TEST source" } });
  await seedRR("rr_k2_v1", { rangeKey: "k2" });
  const ap = (id, extra) => updateDoc(doc(db("labLead"), "pc_reference_ranges", id), Object.assign({ approvalStatus: "approved", approvedBy: "labLead", approvedByName: "L", approvedAt: serverTimestamp(), selfApproved: false }, rrU("labLead"), extra || {}));
  await assertFails(ap("rr_k1_v1"));                                              // no credential
  await assertFails(ap("rr_k1_v1", { reviewerCredential: "x" }));
  await assertSucceeds(ap("rr_k1_v1", { reviewerCredential: "TEST reviewer", approvalNote: "checked against the source page" }));
  const rj = (uid, id, extra) => updateDoc(doc(db(uid), "pc_reference_ranges", id), Object.assign({ approvalStatus: "rejected", rejectedReason: "does not fit our practice", rejectedBy: uid, rejectedByName: uid, rejectedAt: Date.now() }, rrU(uid), extra || {}));
  await assertFails(rj("labMgr", "rr_k2_v1"));                                    // reject needs ranges.approve
  await assertFails(rj("labLead", "rr_k2_v1", { rejectedReason: "x" }));
  await assertFails(rj("labLead", "rr_k2_v1", { rejectedBy: "labMgr" }));
  await assertSucceeds(rj("labLead", "rr_k2_v1"));
  await assertFails(updateDoc(doc(db("labBoth"), "pc_reference_ranges", "rr_k2_v1"), Object.assign({ approvalStatus: "approved", approvedBy: "labBoth", approvedAt: serverTimestamp(), selfApproved: false, reviewerCredential: "TEST" }, rrU("labBoth"))));   // rejected is final
  await assertFails(rj("labLead", "rr_k1_v1"));                                   // an approved range cannot be rejected (retire or replace it)
  await seedRR("rr_k3_v1", { rangeKey: "k3", origin: "evidence_proposal", proposal: { refMin: 1, refMax: 2 } });
  await assertSucceeds(updateDoc(doc(db("labMgr"), "pc_reference_ranges", "rr_k3_v1"), Object.assign({ refMax: 5, changeReason: "our laboratory's validated interval" }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(db("labMgr"), "pc_reference_ranges", "rr_k3_v1"), Object.assign({ proposal: { refMin: 9, refMax: 9 } }, rrU("labMgr"))));
  await assertFails(updateDoc(doc(db("labMgr"), "pc_reference_ranges", "rr_k3_v1"), Object.assign({ origin: "custom" }, rrU("labMgr"))));
});
test("v27 alert rules: screening, alert and emergency types; an emergency (or critical) rule must require acknowledgement; a screening rule need not; rejection works like ranges", async () => {
  const f = db("labMgr"), mk = (key, extra) => setDoc(doc(f, "pc_alert_rules", "ar_" + key + "_v1"), ar26("labMgr", Object.assign({ ruleKey: key }, extra || {})));
  await assertSucceeds(mk("s1", { ruleType: "screening", level: "screening", requiresAck: false, operator: "gte", value: 50 }));
  await assertSucceeds(mk("s2", { ruleType: "alert", level: "moderate", requiresAck: false }));
  await assertSucceeds(mk("s3", { ruleType: "emergency", level: "critical", requiresAck: true }));
  await assertFails(mk("s4", { ruleType: "emergency", level: "moderate", requiresAck: false }));
  await assertFails(mk("s5", { ruleType: "bogus" }));
  await assertSucceeds(updateDoc(doc(db("labLead"), "pc_alert_rules", "ar_s1_v1"), Object.assign({ approvalStatus: "rejected", rejectedReason: "UCG wording differs", rejectedBy: "labLead" }, rrU("labLead"))));
  await assertFails(updateDoc(doc(db("labLead"), "pc_alert_rules", "ar_s2_v1"), Object.assign({ approvalStatus: "approved", approvedBy: "labLead", approvedAt: serverTimestamp(), selfApproved: false }, rrU("labLead"))));   // no credential
});
