/* Developer 3, Stage D: PCD.closeVisitWrites (the ONE builder of the normal close, used by the visit page and the pharmacy) and PCD.takeHomeVisit (may the pharmacy close this visit?).
   The GOLDEN objects are a hand copy of what encounter.html built before the builder existed. */
const test = require("node:test"), assert = require("node:assert/strict"), PCD = require("../pc-dispense.js");

const stamp = () => ({ businessId: "B1", facilityId: "F1", schemaVersion: 1, createdBy: "u1", createdAt: "SERVER_TS", clientCreatedAt: 1700000000000 });
const base = { stamp, ts: "SERVER_TS", encId: "e1", patientId: "p1", by: { id: "u1", name: "Pam Pharmacist" }, note: "  collected, counselled  " };

test("the close writes exactly what the visit page wrote before: six fields and the audit record", () => {
  const r = PCD.closeVisitWrites(base);
  assert.deepEqual(r.update, { status: "closed", closedAt: "SERVER_TS", closedBy: "u1", closeNote: "collected, counselled", updatedAt: "SERVER_TS", updatedBy: "u1" });
  assert.deepEqual(r.audit, Object.assign({}, stamp(), { actorUid: "u1", actorName: "Pam Pharmacist", action: "encounter.close", recordPath: "pc_encounters/e1", patientId: "p1", encounterId: "e1", at: "SERVER_TS" }));
});

test("only the keys the rules allow with encounter.close are written (status, closedAt, closedBy, closeNote, updatedAt, updatedBy)", () => {
  const allowed = ["status", "closedAt", "closedBy", "closeNote", "cancelReason", "journey", "updatedAt", "updatedBy"];
  const keys = Object.keys(PCD.closeVisitWrites(base).update); assert.ok(keys.every(k => allowed.indexOf(k) >= 0), keys.join(","));
  assert.equal(PCD.closeVisitWrites(base).update.status, "closed"); assert.equal(PCD.closeVisitWrites(base).update.closedBy, "u1", "the rule needs closedBy == the user");
});

test("an empty or missing note is stored as an empty string, as before", () => {
  assert.equal(PCD.closeVisitWrites(Object.assign({}, base, { note: "" })).update.closeNote, ""); assert.equal(PCD.closeVisitWrites(Object.assign({}, base, { note: undefined })).update.closeNote, ""); assert.equal(PCD.closeVisitWrites(Object.assign({}, base, { note: null })).update.closeNote, "");
});

test("an incomplete request is refused and builds nothing; the inputs are not changed", () => {
  for (const patch of [{ encId: "" }, { patientId: "" }, { by: {} }, { by: null }, { stamp: null }]) assert.throws(() => PCD.closeVisitWrites(Object.assign({}, base, patch)), e => e.pcd === true && /cannot be closed/.test(e.message), JSON.stringify(Object.keys(patch)));
  assert.throws(() => PCD.closeVisitWrites(), e => e.pcd === true);
  const snap = JSON.stringify(base.by); PCD.closeVisitWrites(base); assert.equal(JSON.stringify(base.by), snap);
});

// ---- take-home-only visits ----
const med = (id, patch) => Object.assign({ id, kind: "medicine", status: "active", administrationMode: "take_home", medicineName: "Med " + id, quantityPrescribed: 10, quantityUnit: "Tablet" }, patch);
const rx = (id, patch) => Object.assign({ id, status: "pending", qtyPrescribed: 10, qtyOutstanding: 10, qtyUnit: "Tablet", qtyUnknown: false }, patch);

test("a visit with only take-home medicines and consumables may be closed by the pharmacy", () => {
  const r = PCD.takeHomeVisit([med("a"), med("b"), { id: "c", kind: "consumable", status: "active", medicineName: "Syringe", quantityPrescribed: 2 }], { a: rx("a", { status: "completed", qtyOutstanding: 0 }), b: rx("b", { status: "completed", qtyOutstanding: 0 }), c: rx("c", { status: "completed", qtyOutstanding: 0, qtyPrescribed: 2 }) });
  assert.equal(r.ok, true); assert.equal(r.items.length, 3); assert.equal(r.notDone, 0); assert.deepEqual(r.staff, []);
});

test("ANYTHING staff give keeps the close with the visit page: procedure, facility-given, ward chart, and an older order with no care mode", () => {
  for (const o of [{ id: "x", kind: "procedure", status: "active", procedureName: "Wound dressing" }, med("x", { administrationMode: "facility_administered" }), med("x", { administrationMode: "inpatient_mar" }), med("x", { administrationMode: undefined }), med("x", { administrationMode: null }), med("x", { administrationMode: "something_new" })]) {
    const r = PCD.takeHomeVisit([med("a"), o], {}); assert.equal(r.ok, false, JSON.stringify(o)); assert.equal(r.staff.length, 1); assert.ok(r.staff[0]);
  }
  assert.deepEqual(PCD.takeHomeVisit([med("a"), med("x", { administrationMode: "facility_administered", medicineName: "Ceftriaxone" })], {}).staff, ["Ceftriaxone"], "the names are reported");
});

test("only ACTIVE orders count: a stopped or completed staff-given order does not block, and stopped take-home items are not listed", () => {
  const r = PCD.takeHomeVisit([med("a"), { id: "p", kind: "procedure", status: "completed", procedureName: "Done" }, med("s", { status: "stopped" }), med("z", { status: "superseded", administrationMode: "facility_administered" })], {});
  assert.equal(r.ok, true); assert.deepEqual(r.items.map(i => i.id), ["a"]); assert.deepEqual(r.staff, []);
});

test("a visit with no take-home item at all is not a take-home visit", () => {
  for (const list of [[], null, undefined, [med("s", { status: "stopped" })], [{ id: "p", kind: "procedure", status: "stopped" }]]) assert.equal(PCD.takeHomeVisit(list, {}).ok, false, JSON.stringify(list));
});

test("what has been supplied: done, partial, waiting, unknown; the outstanding quantity comes from the prescription", () => {
  const r = PCD.takeHomeVisit([med("a"), med("b"), med("c"), med("d"), med("e")], {
    a: rx("a", { status: "completed", qtyOutstanding: 0 }), b: rx("b", { status: "partially_dispensed", qtyOutstanding: 4 }), c: rx("c"), d: rx("d", { qtyUnknown: true, qtyPrescribed: 0, qtyOutstanding: 0 }) });   // e: no prescription document loaded
  const st = Object.fromEntries(r.items.map(i => [i.id, i.state])); assert.deepEqual(st, { a: "done", b: "partial", c: "waiting", d: "unknown", e: "waiting" });
  assert.equal(r.items.find(i => i.id === "b").outstanding, 4); assert.equal(r.items.find(i => i.id === "e").outstanding, 10, "no prescription loaded: the ordered quantity counts as not yet supplied"); assert.equal(r.notDone, 4);
  assert.equal(r.ok, true, "outstanding quantities do not stop the close (the user is asked to confirm); only staff-given treatment does");
});

test("the inputs are not changed", () => {
  const o = [med("a")], x = { a: rx("a") }, snap = JSON.stringify([o, x]); PCD.takeHomeVisit(o, x); assert.equal(JSON.stringify([o, x]), snap);
});
