/* Developer 4 — Firestore security-rules tests (Firebase Emulator).
   Run:  npm install && npm run test:rules        (needs Java 11+ and Node 18+)
   STATUS: written in the sandbox where no emulator could be installed; NOT YET RUN. See docs/SECURITY_TEST_REPORT.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } = require("firebase/firestore");

const B = "biz1", A = "shopA", S = "shopB", B2 = "biz2", C = "shopC";
let env;
const P = { "patient.view": true };
const users = {
  owner: { role: "owner", businessId: B, active: true },
  pharm: { role: "operator", businessId: B, shopId: A, active: true, perms: Object.assign({ "dispense.view": true, "dispense.perform": true }, P) },
  viewer: { role: "operator", businessId: B, shopId: A, active: true, perms: { "dispense.view": true } },
  nurse: { role: "operator", businessId: B, shopId: A, active: true, perms: Object.assign({ "treatment.administer": true }, P) },
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
  const rx = await env.withSecurityRulesDisabled(async c => (await getDoc(doc(c.firestore(), "prescriptions", "o1"))).data());
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
    await setDoc(doc(c.firestore(), "guidelines", "n1"), gl("author", { id: "n1" }));
    await setDoc(doc(c.firestore(), "guidelines", "f1"), gl("author", { id: "f1", scope: "facility" }));
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
