/* Developer 4, Stage 3B: pc-ranges-admin.js (pure logic). TEST values only, invented for testing; no clinical content. In-memory, no Firebase. */
const test = require("node:test"), assert = require("node:assert/strict");
const PCA = require("../pc-ranges-admin.js"), PCR = require("../pc-ranges.js");
const ctx = (o) => Object.assign({ businessId: "b1", facilityId: "f1", uid: "u1", name: "TEST User", ts: "TS", now: 1 }, o);
const RF = (o) => Object.assign({ subjectType: "lab_test", subjectId: "t1", unit: "tu", refMin: "10", refMax: "20", source: "TEST source", sex: "any", pregnancy: "any", lactation: "any", effectiveDate: "2026-01-01" }, o);
const AF = (o) => Object.assign({ subjectType: "vital", subjectId: "pulse", unit: "/min", ruleType: "alert", operator: "gt", value: "5", message: "TEST message", source: "TEST source", allAges: true, effectiveDate: "2026-01-01" }, o);
const noBad = (o) => { const bad = []; (function walk(x, p) { if (x === null || x === undefined) bad.push(p); else if (typeof x === "object" && !Array.isArray(x) && x.constructor === Object) Object.keys(x).forEach(k => walk(x[k], p + "." + k)); })(o, ""); return bad; };
const APPROVE_KEYS = ["approvalStatus", "approvedBy", "approvedByName", "approvedAt", "selfApproved", "reviewerCredential", "approvalNote", "updatedAt", "updatedBy"];
const RETIRE_KEYS = ["approvalStatus", "retiredReason", "retiredBy", "retiredByName", "retiredAt", "updatedAt", "updatedBy"], REJECT_KEYS = ["approvalStatus", "rejectedReason", "rejectedBy", "rejectedByName", "rejectedAt", "updatedAt", "updatedBy"], SUPERSEDE_KEYS = ["approvalStatus", "supersededBy", "updatedAt", "updatedBy"];
const only = (o, keys) => Object.keys(o).every(k => keys.includes(k));
const draft = (kind, f, o) => { const b = PCA.buildDraft(kind, f, ctx(), Object.assign({ key: "tk1", version: 1 }, o)); assert.deepEqual(b.errors, []); return Object.assign({ id: b.id }, b.data); };

test("a range draft has the exact shape the rules need, and never a null", () => {
  const b = PCA.buildDraft("range", RF({ boundaryNote: "", requireFlags: "", lactation: "not_lactating" }), ctx(), { key: "tk1", version: 1 });
  assert.deepEqual(b.errors, []); assert.equal(b.id, "rr_tk1_v1"); const d = b.data;
  assert.equal(d.approvalStatus, "draft"); assert.equal(d.origin, "custom"); assert.equal(d.createdBy, "u1"); assert.equal(d.createdAt, "TS"); assert.equal(d.schemaVersion, 1); assert.equal(d.rangeKey, "tk1"); assert.equal(d.version, 1);
  assert.equal(d.refMin, 10); assert.equal(d.refMax, 20); assert.equal(d.lactation, "not_lactating"); assert.equal("boundaryNote" in d, false); assert.equal("requireFlags" in d, false); assert.deepEqual(noBad(d), []); assert.equal("reproductive" in d, false);
  assert.equal(PCR.validate(d).length, 0);
});
test("a range draft is refused in advance for what the rules refuse", () => {
  const bad = (f, o) => PCA.buildDraft("range", RF(f), ctx(), Object.assign({ key: "tk1", version: 1 }, o)).errors.join(" | ");
  assert.match(bad({ source: "ab" }), /source/i); assert.match(bad({ refMin: "1,5" }), /decimal point/); assert.match(bad({ refMin: "", refMax: "", refText: "" }), /lower limit|upper limit|text/); assert.match(bad({ refMin: "30" }), /above the upper/);
  assert.match(bad({ subjectType: "vital", subjectId: "pulse", unit: "/min" }), /age limit/); assert.equal(bad({ subjectType: "vital", subjectId: "pulse", unit: "/min", allAges: true }), "");
  assert.equal(bad({ refMin: "", refMax: "", refText: "TEST text interval" }), "", "text-only range is valid");
  assert.match(bad({}, { key: "Bad Key" }), /key may only/); assert.match(bad({}, { version: 0 }), /version/); assert.match(bad({ requireFlags: new Array(11).fill("flag_a").join(",") }), /at most 10/); assert.match(bad({ boundaryNote: "x".repeat(501) }), /500/);
  assert.match(bad({ minAgeMonths: "x" }), /number/); assert.match(bad({ sex: "other" }), /sex/); assert.match(bad({ lactation: "maybe" }), /lactation/);
  assert.match(bad({ subjectType: "lab_param", paramKey: "" }), /parameter/); assert.match(bad({ effectiveDate: "2026-02-30" }), /not a valid date/);
});
test("an alert-rule draft: the level follows the rule type; emergency always asks for acknowledgement", () => {
  const e = draft("rule", AF({ ruleType: "emergency" })), a = draft("rule", AF({ ruleType: "alert", requiresAck: false })), s = draft("rule", AF({ ruleType: "screening" }));
  assert.equal(e.level, "critical"); assert.equal(e.requiresAck, true); assert.equal(a.level, "moderate"); assert.equal(a.requiresAck, false); assert.equal(s.level, "screening"); assert.equal(a.ruleKey, "tk1"); assert.equal(a.value, 5); assert.deepEqual(noBad(e), []);
  assert.equal(PCA.buildDraft("rule", AF({}), ctx(), { key: "tk2", version: 3 }).id, "ar_tk2_v3");
  const bad = (f) => PCA.buildDraft("rule", AF(f), ctx(), { key: "tk1", version: 1 }).errors.join(" | ");
  assert.match(bad({ message: "ab" }), /at least 3/); assert.match(bad({ message: "x".repeat(301) }), /at most 300/); assert.match(bad({ operator: "eq" }), /compared/); assert.match(bad({ value: "" }), /threshold/); assert.match(bad({ ruleType: "x" }), /rule type/); assert.match(bad({ allAges: false }), /age limit/);
  const r = draft("rule", AF({ operator: "range", value: "", min: "3", max: "9" })); assert.equal(r.min, 3); assert.equal(r.max, 9); assert.equal("value" in r, false); assert.match(bad({ operator: "range", min: "9", max: "3", value: "" }), /minimum must be below/);
});
test("editing a draft replaces the whole document: a cleared box disappears, identity, creator, origin and proposal stay", () => {
  const d = draft("range", RF({ boundaryNote: "TEST note", requireFlags: "flag_a" }), { origin: "evidence_proposal", proposal: { refMin: 10, source: "TEST original", reviewRequired: true } });
  const ex = Object.assign({}, d, { createdAt: "CREATED" }); delete ex.id;
  const r = PCA.editDraft("range", ex, RF({ refMin: "11", boundaryNote: "", requireFlags: "", subjectId: "OTHER", decisionReason: "TEST reason" }), ctx({ uid: "u2", ts: "T2" }));
  assert.equal(r.ok, true); assert.deepEqual(r.errors, []); const n = r.data;
  assert.equal(n.refMin, 11); assert.equal("boundaryNote" in n, false); assert.equal("requireFlags" in n, false); assert.equal(n.subjectId, "t1", "the subject never changes"); assert.equal(n.createdBy, "u1"); assert.equal(n.createdAt, "CREATED"); assert.equal(n.origin, "evidence_proposal");
  assert.deepEqual(n.proposal, d.proposal); assert.equal(n.updatedBy, "u2"); assert.equal(n.updatedAt, "T2"); assert.equal(n.approvalStatus, "draft"); assert.equal(n.rangeKey, "tk1"); assert.equal(n.version, 1); assert.deepEqual(noBad(n), []); assert.equal(n.decisionReason, "TEST reason");
  assert.equal(PCA.editDraft("range", Object.assign({}, ex, { approvalStatus: "approved" }), RF({}), ctx()).ok, false); assert.equal(PCA.editDraft("range", ex, RF({ source: "" }), ctx()).ok, false);
});
test("approve: credential and effective date are required; self-approval is recorded and labelled, not blocked; only the allowed keys change", () => {
  const d = draft("range", RF({})), c1 = ctx({ uid: "u2", name: "TEST Second", ts: "T2" });
  assert.match(PCA.approve("range", d, { reviewerCredential: "" }, [d], c1).errors.join(" "), /reviewer/i); const early = PCA.approve("range", Object.assign({}, d, { effectiveDate: "" }), { reviewerCredential: "xx" }, [d], ctx()); assert.equal(early.ok, false); assert.equal(early.selfApproved, true, "the label is known even while something is missing"); assert.equal(PCA.approve("range", Object.assign({}, d, { effectiveDate: "" }), { reviewerCredential: "xx" }, [d], c1).selfApproved, false); assert.match(PCA.approve("range", Object.assign({}, d, { effectiveDate: "" }), { reviewerCredential: "RN" }, [], c1).errors.join(" "), /effective date/i);
  const a = PCA.approve("range", d, { reviewerCredential: "TEST role", approvalNote: "ok" }, [d], c1); assert.equal(a.ok, true); assert.equal(a.selfApproved, false); assert.equal(a.ops.length, 1); const p = a.ops[0].patch;
  assert.equal(a.ops[0].id, "rr_tk1_v1"); assert.equal(p.approvalStatus, "approved"); assert.equal(p.approvedBy, "u2"); assert.equal(p.approvedAt, "T2"); assert.equal(p.selfApproved, false); assert.equal(p.reviewerCredential, "TEST role"); assert.equal(p.approvalNote, "ok"); assert.ok(only(p, APPROVE_KEYS)); assert.deepEqual(noBad(p), []);
  const s = PCA.approve("range", d, { reviewerCredential: "TEST role" }, [d], ctx()); assert.equal(s.ok, true); assert.equal(s.selfApproved, true); assert.equal(s.ops[0].patch.selfApproved, true); assert.equal("approvalNote" in s.ops[0].patch, false);
  assert.match(PCA.approvalLabel(Object.assign({}, d, { approvalStatus: "approved", selfApproved: true, reviewerCredential: "TEST role" })), /same person.*second person should check.*TEST role/); assert.match(PCA.approvalLabel(Object.assign({}, d, { approvalStatus: "approved", selfApproved: false })), /second person/); assert.equal(PCA.approvalLabel(d), "");
  assert.equal(PCA.approve("range", Object.assign({}, d, { approvalStatus: "rejected" }), { reviewerCredential: "RN" }, [], c1).ok, false);
});
test("approve a newer version: the old approved version is replaced in the same commit; an older version cannot replace a newer one", () => {
  const v1 = Object.assign(draft("range", RF({})), { approvalStatus: "approved" }), v2 = draft("range", RF({ refMax: "25" }), { version: 2 }), c = ctx({ uid: "u2", ts: "T2" });
  assert.equal(PCA.nextVersion("range", v1, [v1]), 2); assert.equal(PCA.nextVersion("range", v1, [v1, v2]), 3);
  const a = PCA.approve("range", v2, { reviewerCredential: "TEST role" }, [v1, v2], c); assert.equal(a.ok, true); assert.equal(a.ops.length, 2); assert.equal(a.replaces, "rr_tk1_v1");
  assert.deepEqual(a.ops[1], { id: "rr_tk1_v1", patch: { approvalStatus: "superseded", supersededBy: "rr_tk1_v2", updatedAt: "T2", updatedBy: "u2" } }); assert.ok(only(a.ops[1].patch, SUPERSEDE_KEYS));
  const v1d = Object.assign({}, v1, { approvalStatus: "draft" }), old = PCA.approve("range", v1d, { reviewerCredential: "RN" }, [Object.assign({}, v2, { approvalStatus: "approved" }), v1d], c); assert.match(old.errors.join(" "), /newer version is already approved/);
});
test("approve warns about a possible overlap with another approved range of the same measurement (not blocking)", () => {
  const a = Object.assign(draft("range", RF({}), { key: "tka" }), { approvalStatus: "approved", source: "TEST src A" }), b = draft("range", RF({ refMin: "12", refMax: "18" }), { key: "tkb" });
  const r = PCA.approve("range", b, { reviewerCredential: "RN" }, [a, b], ctx({ uid: "u2" })); assert.equal(r.ok, true); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /overlap/);
  const c = draft("range", RF({ sex: "male" }), { key: "tkc" }); assert.equal(PCA.approve("range", c, { reviewerCredential: "RN" }, [a, c], ctx({ uid: "u2" })).warnings.length, 0, "a more specific range is not an overlap risk");
});
test("alert-rule approval needs the same stamp and effective date (and never asks for a normal interval)", () => {
  const d = draft("rule", AF({})), r = PCA.approve("rule", d, { reviewerCredential: "TEST role" }, [d], ctx({ uid: "u2" })); assert.equal(r.ok, true); assert.equal(r.ops[0].id, "ar_tk1_v1"); assert.ok(only(r.ops[0].patch, APPROVE_KEYS));
  assert.match(PCA.approve("rule", Object.assign({}, d, { effectiveDate: "" }), { reviewerCredential: "RN" }, [], ctx()).errors.join(" "), /effective date/i);
});
test("reject and retire need a reason and change only the allowed keys; only drafts are rejected", () => {
  const d = draft("range", RF({})), a = Object.assign({}, d, { approvalStatus: "approved" });
  assert.equal(PCA.reject(d, "ab", ctx()).ok, false); const r = PCA.reject(d, "TEST reason", ctx({ ts: "T3" })); assert.equal(r.ok, true); assert.equal(r.patch.approvalStatus, "rejected"); assert.equal(r.patch.rejectedBy, "u1"); assert.equal(r.patch.rejectedReason, "TEST reason"); assert.ok(only(r.patch, REJECT_KEYS));
  assert.equal(PCA.reject(a, "TEST reason", ctx()).ok, false, "an approved item is retired or replaced, not rejected");
  assert.equal(PCA.retire(a, "", ctx()).ok, false); const t = PCA.retire(a, "TEST reason", ctx()); assert.equal(t.ok, true); assert.ok(only(t.patch, RETIRE_KEYS)); assert.equal(t.patch.retiredBy, "u1"); assert.equal(PCA.retire(d, "TEST discard", ctx()).ok, true); assert.equal(PCA.retire(Object.assign({}, d, { approvalStatus: "rejected" }), "TEST", ctx()).ok, false);
});
const FILE = (arr) => JSON.stringify({ format: "medistock-range-proposals", formatVersion: 1, proposals: arr });
const P = (o) => Object.assign({ kind: "range", key: "tp1", version: 1, subjectType: "lab_test", subjectId: "t1", unit: "tu", refMin: 1, refMax: 2, source: "TEST source" }, o);
test("importer: drafts only, origin evidence_proposal, original values kept in proposal, deterministic ids", () => {
  const r = PCA.planImport(FILE([P({}), P({ kind: "alert_rule", key: "tp2", subjectType: "vital", subjectId: "pulse", unit: "/min", allAges: true, ruleType: "emergency", operator: "lt", value: 1, message: "TEST msg", reviewRequired: true })]), ctx(), new Set());
  assert.equal(r.ok, true); assert.deepEqual(r.counts, { create: 2, skip_exists: 0, invalid: 0 }); const [a, b] = r.items;
  assert.equal(a.id, "rr_tp1_v1"); assert.equal(a.coll, "pc_reference_ranges"); assert.equal(a.data.approvalStatus, "draft"); assert.equal(a.data.origin, "evidence_proposal"); assert.equal(a.data.proposal.refMin, 1); assert.equal(a.data.proposal.source, "TEST source"); assert.equal(a.data.proposal.reviewRequired, false); assert.equal("kind" in a.data.proposal, false);
  assert.equal(b.id, "ar_tp2_v1"); assert.equal(b.coll, "pc_alert_rules"); assert.equal(b.data.level, "critical"); assert.equal(b.data.requiresAck, true); assert.equal(PCA.needsDecision(b.data), true); assert.equal(PCA.needsDecision(a.data), false);
  r.items.forEach(it => { assert.equal(it.data.approvalStatus, "draft"); assert.equal(it.data.createdBy, "u1"); assert.deepEqual(noBad(it.data), []); assert.equal("approvedBy" in it.data, false); });
});
test("importer: an id that already exists in ANY status is skipped, never overwritten; the same file twice creates nothing the second time", () => {
  const f = FILE([P({}), P({ key: "tp3" })]); const r = PCA.planImport(f, ctx(), new Set(["pc_reference_ranges/rr_tp1_v1"]));
  assert.deepEqual(r.counts, { create: 1, skip_exists: 1, invalid: 0 }); assert.equal(r.items[0].status, "skip_exists"); assert.equal(r.items[0].data, null);
  const again = PCA.planImport(f, ctx(), new Set(["pc_reference_ranges/rr_tp1_v1", "pc_reference_ranges/rr_tp3_v1"])); assert.deepEqual(again.counts, { create: 0, skip_exists: 2, invalid: 0 });
  assert.equal(PCA.planImport(FILE([P({}), P({})]), ctx(), new Set()).items[1].status, "invalid", "a key and version twice in one file");
});
test("importer: approval fields, bad data and bad files are refused with a clear reason; nothing is guessed", () => {
  const r = PCA.planImport(FILE([P({ approvalStatus: "approved" }), P({ key: "tp4", refMin: 9, refMax: 2 }), P({ key: "tp5", kind: "x" }), P({ key: "tp6", version: 0 }), P({ key: "tp7", subjectType: "vital", subjectId: "pulse", unit: "/min" }), P({ key: "tp8", origin: "custom" }), P({ key: "tp9", source: "" }), "nope"]), ctx(), new Set());
  assert.deepEqual(r.counts, { create: 0, skip_exists: 0, invalid: 8 }); assert.match(r.items[0].errors[0], /Drafts only/); assert.match(r.items[1].errors.join(" "), /above the upper/); assert.match(r.items[2].errors[0], /kind/); assert.match(r.items[3].errors[0], /version/); assert.match(r.items[4].errors.join(" "), /age limit/); assert.match(r.items[5].errors[0], /Drafts only/); assert.match(r.items[6].errors.join(" "), /source/i);
  assert.match(PCA.planImport("not json", ctx(), new Set()).fileErrors[0], /not valid JSON/); assert.match(PCA.planImport(JSON.stringify({ format: "other", proposals: [] }), ctx(), new Set()).fileErrors[0], /not a range-proposals file/); assert.match(PCA.planImport("", ctx(), new Set()).fileErrors[0], /empty/);
  assert.match(PCA.planImport(FILE(new Array(301).fill(P({}))), ctx(), new Set()).fileErrors[0], /Too many/); assert.match(PCA.planImport("x".repeat(1000001), ctx(), new Set()).fileErrors[0], /too large/);
});
test("importer: an inclusive maximum age is converted to the exclusive maximum (+1); giving both is refused", () => {
  const r = PCA.planImport(FILE([P({ subjectType: "vital", subjectId: "pulse", unit: "/min", minAgeMonths: 12, maxAgeMonthsInclusive: 59 }), P({ key: "tp2", subjectType: "vital", subjectId: "pulse", unit: "/min", minAgeMonths: 12, maxAgeMonths: 60, maxAgeMonthsInclusive: 59 })]), ctx(), new Set());
  assert.equal(r.items[0].status, "create"); assert.equal(r.items[0].data.maxAgeMonths, 60); assert.equal(r.items[0].data.minAgeMonths, 12); assert.equal(r.items[1].status, "invalid"); assert.match(r.items[1].errors[0], /not both/);
});
test("display helpers: no invented text, links open only for http(s), flags and context read plainly", () => {
  assert.equal(PCA.safeUrl("https://example.invalid/x"), "https://example.invalid/x"); assert.equal(PCA.safeUrl("javascript:alert(1)"), ""); assert.equal(PCA.safeUrl("data:text/html,x"), ""); assert.equal(PCA.safeUrl(""), "");
  assert.equal(PCA.intervalText({ refMin: 1, refMax: 2, unit: "tu" }), "1 to 2 tu"); assert.match(PCA.intervalText({ refText: "TEST text", unit: "tu" }), /no flag is calculated/); assert.equal(PCA.intervalText({ refMax: 2, unit: "tu" }), "up to 2 tu");
  assert.equal(PCA.ruleText({ ruleType: "alert", operator: "gt", value: 5, unit: "/min" }), "Alert: above 5 /min"); assert.match(PCA.ruleText({ ruleType: "screening", operator: "range", min: 3, max: 9, unit: "x" }), /3 up to \(not including\) 9 x/);
  assert.equal(PCA.contextLine({ minAgeMonths: 12, maxAgeMonths: 60, sex: "female", pregnancy: "pregnant", lactation: "lactating", requireFlags: ["flag_a"], setting: "TEST ward" }), "age 12 to under 60 months · female · pregnant · lactating · TEST ward · flag a present");
  assert.equal(PCA.contextLine({ allAges: true }), "all ages"); assert.equal(PCA.contextLine({}), "age not limited"); assert.equal(PCA.origin({ origin: "evidence_proposal" }), "Imported research proposal");
});
