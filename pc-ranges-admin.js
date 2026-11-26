/* MediStock Cloud — Developer 4, Stage 3B: management of reference ranges and alert rules (pure logic, no Firebase, no clinical values).
   The screen (investigations.html) calls these functions; they build the exact documents and patches the Firestore rules v28 accept, and refuse
   in advance what the rules would refuse. Every document written goes through PCR.cleanForWrite; every approval through PCR.approvalStampErrors.
   Nothing here contains a clinical number. TEST data in the tests is invented. */
(function (root) {
  "use strict";
  var PCR = root.PCR || (typeof require !== "undefined" ? require("./pc-ranges.js") : null);
  var PCO = root.PCO || (typeof require !== "undefined" ? require("./pc-obs.js") : null);

  var KINDS = { range: { coll: "pc_reference_ranges", prefix: "rr_", key: "rangeKey", label: "Reference range" },
                rule: { coll: "pc_alert_rules", prefix: "ar_", key: "ruleKey", label: "Alert rule" } };
  var LEVEL_OF = { screening: "screening", alert: "moderate", emergency: "critical" };
  var STATUS_LABEL = { draft: "Draft (not in use)", approved: "Approved (in use)", rejected: "Rejected", superseded: "Replaced by a newer version", retired: "Retired" };
  var MAX_IMPORT_ITEMS = 300, MAX_IMPORT_BYTES = 1000000;

  function str(v) { return v == null ? "" : String(v).trim(); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function copy(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { r[k] = o[k]; }); return r; }
  function plain(o) { return JSON.parse(JSON.stringify(o)); }
  function docId(kind, key, version) { return KINDS[kind].prefix + key + "_v" + version; }
  function keyOk(k) { return /^[a-z0-9][a-z0-9_]{1,59}$/.test(k || ""); }
  function validate(kind, d) { return kind === "range" ? PCR.validate(d) : PCO.ruleErrors(d); }

  /* ---- form text -> typed fields. A blank box means "not set". A decimal comma is refused (1,5 could be read as 1500). */
  function num(raw, label, errors) {
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return undefined;
    if (typeof raw === "number") { if (!isFinite(raw)) { errors.push(label + " is not a valid number."); return undefined; } return raw; }
    var t = String(raw).trim(); if (/,/.test(t) || !/^-?\d+(\.\d+)?$/.test(t)) { errors.push(label + " must be a number written with a decimal point."); return undefined; }
    return Number(t);
  }
  function list(raw) { if (Array.isArray(raw)) return raw.map(str).filter(Boolean); return str(raw) === "" ? [] : String(raw).split(",").map(function (x) { return x.trim().toLowerCase().replace(/\s+/g, "_"); }).filter(Boolean); }
  var COMMON_TEXT = ["source", "sourceOrg", "sourceTitle", "sourceType", "sourcePage", "sourceVersion", "sourceUrl", "notes", "boundaryNote", "decisionReason", "changeReason", "specimen", "method", "labName", "setting", "effectiveDate", "reviewDate", "paramKey", "unit"];

  /* normalise(kind, form) -> { fields, errors }. `form` holds the raw values of the screen or of an import item. */
  function normalise(kind, form) {
    var f = form || {}, o = {}, errors = [];
    o.subjectType = str(f.subjectType); o.subjectId = str(f.subjectId);
    COMMON_TEXT.forEach(function (k) { if (f[k] !== undefined && f[k] !== null && str(f[k]) !== "") o[k] = str(f[k]); });
    if (o.paramKey === undefined) o.paramKey = "";
    var ages = [["minAgeMonths", "The lowest age"], ["maxAgeMonths", "The highest age"]];
    ages.forEach(function (a) { var v = num(f[a[0]], a[1], errors); if (v !== undefined) o[a[0]] = v; });
    if (f.allAges === true) o.allAges = true;
    o.sex = str(f.sex) || "any"; o.pregnancy = str(f.pregnancy) || "any"; o.lactation = str(f.lactation) || "any";
    var rf = list(f.requireFlags), ff = list(f.forbidFlags); if (rf.length) o.requireFlags = rf; if (ff.length) o.forbidFlags = ff;
    if (kind === "range") {
      var a = num(f.refMin, "The lower limit", errors), b = num(f.refMax, "The upper limit", errors);
      if (a !== undefined) o.refMin = a; if (b !== undefined) o.refMax = b; if (str(f.refText)) o.refText = str(f.refText);
    } else {
      o.ruleType = str(f.ruleType); o.level = LEVEL_OF[o.ruleType] || undefined; if (o.level === undefined) delete o.level;
      o.operator = str(f.operator);
      var v = num(f.value, "The threshold value", errors), mn = num(f.min, "The minimum", errors), mx = num(f.max, "The maximum", errors);
      if (o.operator === "range") { if (mn !== undefined) o.min = mn; if (mx !== undefined) o.max = mx; } else if (v !== undefined) o.value = v;
      o.message = str(f.message); if (str(f.urgencyText)) o.urgencyText = str(f.urgencyText); if (str(f.group)) o.group = str(f.group);
      o.requiresAck = f.requiresAck === true || o.ruleType === "emergency";
      var cr = list(f.contextRequired); if (cr.length) o.contextRequired = cr;
    }
    return { fields: o, errors: errors };
  }
  function stampOf(ctx) { return { businessId: ctx.businessId, facilityId: ctx.facilityId, schemaVersion: 1, createdBy: ctx.uid, createdAt: ctx.ts, clientCreatedAt: ctx.now || Date.now() }; }

  /* buildDraft(kind, form, ctx, opts) -> { ok, errors, id, data }. opts: { key, version, origin, proposal }.  ctx: { businessId, facilityId, uid, name, ts, now } (ts = serverTimestamp()). */
  function buildDraft(kind, form, ctx, opts) {
    opts = opts || {}; var n = normalise(kind, form), K = KINDS[kind], errors = n.errors.slice(), key = opts.key || PCR.newRangeKey(), version = opts.version === undefined ? 1 : opts.version;
    if (!keyOk(key)) errors.push("The key may only use lower-case letters, digits and underscores (2 to 60 characters).");
    if (!(version >= 1) || Math.floor(version) !== version) errors.push("A version of 1 or more is needed.");
    var d = n.fields; d[K.key] = key; d.version = version;
    validate(kind, d).forEach(function (m) { if (errors.indexOf(m) < 0) errors.push(m); });
    if (kind === "range" && !errors.length && ["lab_test", "lab_param", "vital"].indexOf(d.subjectType) < 0) errors.push("Choose what the range is for.");
    var data = Object.assign(copy(d), stampOf(ctx), { approvalStatus: "draft", origin: opts.origin || "custom" });
    if (opts.proposal) data.proposal = opts.proposal;
    data = PCR.cleanForWrite(data);
    return { ok: errors.length === 0, errors: errors, id: docId(kind, key, version), data: data };
  }

  /* editDraft(kind, existing, form, ctx) -> a FULL replacement document for a draft (so a cleared box really disappears; null is never written).
     Identity, scope, creator, origin and the original proposal are carried over unchanged, as the rules require. */
  function editDraft(kind, existing, form, ctx) {
    var K = KINDS[kind], errors = [];
    if (!existing || existing.approvalStatus !== "draft") return { ok: false, errors: ["Only a draft can be edited. Make a new version instead."], data: null };
    var n = normalise(kind, Object.assign({}, form, { subjectType: existing.subjectType, subjectId: existing.subjectId })); errors = n.errors.slice();
    var d = n.fields; if (kind === "range" || existing.paramKey) d.paramKey = existing.paramKey || ""; d[K.key] = existing[K.key]; d.version = existing.version;
    validate(kind, d).forEach(function (m) { if (errors.indexOf(m) < 0) errors.push(m); });
    var keep = {}; ["businessId", "facilityId", "schemaVersion", "createdBy", "createdAt", "clientCreatedAt", "origin", "proposal"].forEach(function (k) { if (existing[k] !== undefined) keep[k] = existing[k]; });
    var data = PCR.cleanForWrite(Object.assign(d, keep, { approvalStatus: "draft", updatedAt: ctx.ts, updatedBy: ctx.uid }));
    return { ok: errors.length === 0, errors: errors, data: data };
  }

  /* a new draft version above an existing one (same key, version = highest known + 1), prefilled from it. The old one stays in use until the new one is approved. */
  function nextVersion(kind, existing, all) {
    var K = KINDS[kind], hi = 0; (all || []).forEach(function (r) { if (r[K.key] === existing[K.key] && r.version > hi) hi = r.version; });
    return Math.max(hi, existing.version) + 1;
  }
  function formOf(kind, r) {
    var f = {}; COMMON_TEXT.concat(["subjectType", "subjectId", "sex", "pregnancy", "lactation", "minAgeMonths", "maxAgeMonths", "refMin", "refMax", "refText", "ruleType", "operator", "value", "min", "max", "message", "urgencyText", "group"]).forEach(function (k) { if (r && r[k] !== undefined && r[k] !== null) f[k] = r[k]; });
    f.requireFlags = ((r && r.requireFlags) || []).join(", "); f.forbidFlags = ((r && r.forbidFlags) || []).join(", "); f.contextRequired = ((r && r.contextRequired) || []).join(", ");
    f.allAges = !!(r && r.allAges); f.requiresAck = !!(r && r.requiresAck); return f;
  }

  /* ---- reviewer actions. Each returns { ok, errors, patch } (patch = fields for updateDoc) or, for approve, { ops } so a replaced version changes in the SAME commit. */
  function who(ctx) { return { updatedAt: ctx.ts, updatedBy: ctx.uid }; }
  function needReason(reason, what) { return str(reason).length >= 3 ? [] : ["Write the reason for " + what + " (at least 3 characters)."]; }
  function reject(existing, reason, ctx) {
    var e = needReason(reason, "rejecting"); if (!existing || existing.approvalStatus !== "draft") e.push("Only a draft can be rejected.");
    return { ok: !e.length, errors: e, patch: e.length ? null : Object.assign({ approvalStatus: "rejected", rejectedReason: str(reason), rejectedBy: ctx.uid, rejectedByName: ctx.name || "", rejectedAt: ctx.ts }, who(ctx)) };
  }
  function retire(existing, reason, ctx) {
    var e = needReason(reason, "retiring"); if (!existing || ["draft", "approved"].indexOf(existing.approvalStatus) < 0) e.push("Only a draft or an approved item can be retired.");
    return { ok: !e.length, errors: e, patch: e.length ? null : Object.assign({ approvalStatus: "retired", retiredReason: str(reason), retiredBy: ctx.uid, retiredByName: ctx.name || "", retiredAt: ctx.ts }, who(ctx)) };
  }
  /* approve(kind, existing, stamp, all, ctx) -> { ok, errors, warnings, selfApproved, ops:[{id, patch}] }. The previous approved version of the same key (lower version) is replaced in the same commit.
     Self-approval is NOT blocked: it is recorded (selfApproved) and shown with a clear label. */
  function approve(kind, existing, stamp, all, ctx) {
    var K = KINDS[kind], e = [], warnings = [];
    if (!existing || existing.approvalStatus !== "draft") return { ok: false, errors: ["Only a draft can be approved."], warnings: [], ops: [] };
    validate(kind, existing).forEach(function (m) { e.push(m); });
    if (!PCR.isIso(str(existing.effectiveDate))) e.push("An effective date is needed to approve.");   // approvalErrors() is for ranges only; the rules need this for both
    PCR.approvalStampErrors(stamp).forEach(function (m) { e.push(m); });
    var prev = null;
    (all || []).forEach(function (r) {
      if (r.approvalStatus !== "approved" || r[K.key] !== existing[K.key]) return;
      if (r.version > existing.version) e.push("A newer version is already approved. Make a new version above it."); else if (!prev || r.version > prev.version) prev = r;
    });
    (all || []).forEach(function (r) {
      if (r.approvalStatus !== "approved" || r === prev || r[K.key] === existing[K.key] || r.subjectType !== existing.subjectType || r.subjectId !== existing.subjectId || str(r.paramKey) !== str(existing.paramKey)) return;
      if (kind === "range" && PCR.conflictRisk(existing, r)) warnings.push("This may overlap the approved " + (r.sourceTitle || r.source || "range") + ". Two equally specific ranges give a visible conflict and no flag. Check the age, sex and context.");
    });
    var self = existing.createdBy === ctx.uid;
    if (e.length) return { ok: false, errors: e, warnings: warnings, selfApproved: self, replaces: prev ? docId(kind, prev[K.key], prev.version) : "", ops: [] };
    var  patch = Object.assign({ approvalStatus: "approved", approvedBy: ctx.uid, approvedByName: ctx.name || "", approvedAt: ctx.ts, selfApproved: self, reviewerCredential: str(stamp.reviewerCredential) }, who(ctx));
    if (str(stamp.approvalNote)) patch.approvalNote = str(stamp.approvalNote);
    var id = docId(kind, existing[K.key], existing.version), ops = [{ id: id, patch: patch }];
    if (prev) ops.push({ id: docId(kind, prev[K.key], prev.version), patch: Object.assign({ approvalStatus: "superseded", supersededBy: id }, who(ctx)) });
    return { ok: true, errors: [], warnings: warnings, selfApproved: self, replaces: prev ? docId(kind, prev[K.key], prev.version) : "", ops: ops };
  }

  /* ---- list lines (plain text; the screen escapes them) */
  function ageText(r) { var a = isNum(r.minAgeMonths) ? r.minAgeMonths : null, b = isNum(r.maxAgeMonths) ? r.maxAgeMonths : null; if (a === null && b === null) return r.allAges ? "all ages" : "age not limited"; return "age " + (a === null ? "0" : a) + (b === null ? " months and above" : " to under " + b + " months"); }
  function contextLine(r) {
    var p = [ageText(r)]; if (r.sex && r.sex !== "any") p.push(r.sex); if (r.pregnancy && r.pregnancy !== "any") p.push(r.pregnancy.replace("_", " ")); if (r.lactation && r.lactation !== "any") p.push(r.lactation.replace("_", " "));
    ["specimen", "method", "labName", "setting"].forEach(function (k) { if (str(r[k])) p.push(k === "labName" ? "lab " + r[k] : r[k]); });
    (r.requireFlags || []).forEach(function (k) { p.push(k.replace(/_/g, " ") + " present"); }); (r.forbidFlags || []).forEach(function (k) { p.push(k.replace(/_/g, " ") + " absent"); }); return p.join(" · ");
  }
  function intervalText(r) {
    var u = str(r.unit), a = isNum(r.refMin), b = isNum(r.refMax);
    if (a && b) return r.refMin + " to " + r.refMax + " " + u; if (a) return r.refMin + " " + u + " or more"; if (b) return "up to " + r.refMax + " " + u; return str(r.refText) ? str(r.refText) + " (text only: no flag is calculated)" : "no interval";
  }
  var OPS = { lt: "below", lte: "at or below", gt: "above", gte: "at or above" };
  function ruleText(r) {
    var u = str(r.unit), t = { screening: "Screening", alert: "Alert", emergency: "Emergency" }[r.ruleType] || "Rule";
    return t + ": " + (r.operator === "range" ? r.min + " up to (not including) " + r.max + " " + u : (OPS[r.operator] || r.operator) + " " + r.value + " " + u);
  }
  function origin(r) { return r.origin === "evidence_proposal" ? "Imported research proposal" : r.origin === "custom" ? "Entered by this facility" : ""; }
  function safeUrl(u) { var s = str(u); return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : ""; }
  function approvalLabel(r) {
    if (r.approvalStatus !== "approved" && r.approvalStatus !== "superseded") return "";
    return (r.selfApproved ? "Approved by the same person who created it (self-approved). A second person should check." : "Approved by a second person.") + (str(r.reviewerCredential) ? " Reviewer: " + r.reviewerCredential + "." : "");
  }
  function needsDecision(r) { return !!(r && r.proposal && r.proposal.reviewRequired === true) && r.approvalStatus === "draft"; }

  /* ---- importer: drafts only. File format (JSON):
     { "format": "medistock-range-proposals", "formatVersion": 1, "proposals": [ { "kind": "range"|"alert_rule", "key": "...", "version": 1, <the same fields as the screen>, "reviewRequired": true|false,
        "maxAgeMonthsInclusive": n (optional; converted to the exclusive maximum +1) } ] }
     Ids are deterministic (rr_<key>_v<version> / ar_<key>_v<version>). An id that already exists in ANY status is skipped (a re-import never overwrites an edit, approval or rejection).
     Approval fields in the file are refused. Every document is origin "evidence_proposal" with the values as imported kept in `proposal`. */
  var FORBIDDEN = ["approvalStatus", "approvedBy", "approvedAt", "approvedByName", "selfApproved", "reviewerCredential", "approvalNote", "supersededBy", "retiredReason", "rejectedReason", "createdBy", "createdAt", "businessId", "facilityId", "origin", "proposal"];
  function planImport(text, ctx, existingIds) {
    var out = { ok: false, fileErrors: [], items: [], counts: { create: 0, skip_exists: 0, invalid: 0 } }, j;
    if (typeof text !== "string" || !text.trim()) { out.fileErrors.push("The file is empty."); return out; }
    if (text.length > MAX_IMPORT_BYTES) { out.fileErrors.push("The file is too large (over 1 MB)."); return out; }
    try { j = JSON.parse(text); } catch (x) { out.fileErrors.push("The file is not valid JSON, so nothing was read."); return out; }
    if (!j || j.format !== "medistock-range-proposals" || j.formatVersion !== 1 || !Array.isArray(j.proposals)) { out.fileErrors.push("This is not a range-proposals file (format \"medistock-range-proposals\", version 1)."); return out; }
    if (j.proposals.length > MAX_IMPORT_ITEMS) { out.fileErrors.push("Too many items (at most " + MAX_IMPORT_ITEMS + " per file)."); return out; }
    var seen = {}, exists = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
    j.proposals.forEach(function (p, i) {
      var it = { index: i + 1, kind: "", id: "", label: "", status: "invalid", errors: [], data: null };
      out.items.push(it);
      if (!p || typeof p !== "object" || Array.isArray(p)) { it.errors.push("This entry is not an object."); return; }
      var kind = p.kind === "range" ? "range" : p.kind === "alert_rule" ? "rule" : ""; it.kind = kind; it.label = str(p.key) + " v" + str(p.version);
      if (!kind) { it.errors.push("The kind must be \"range\" or \"alert_rule\"."); return; }
      var bad = FORBIDDEN.filter(function (k) { return p[k] !== undefined; }); if (bad.length) { it.errors.push("Drafts only: these fields are not accepted in a file: " + bad.join(", ") + "."); return; }
      var form = copy(p); if (p.maxAgeMonthsInclusive !== undefined) { if (p.maxAgeMonths !== undefined) { it.errors.push("Give maxAgeMonths or maxAgeMonthsInclusive, not both."); return; } if (!isNum(p.maxAgeMonthsInclusive)) { it.errors.push("maxAgeMonthsInclusive must be a number."); return; } form.maxAgeMonths = p.maxAgeMonthsInclusive + 1; }
      if (!Number.isInteger(p.version) || p.version < 1) { it.errors.push("A whole version number of 1 or more is needed."); return; }
      var proposal = plain(p); delete proposal.kind; var b = buildDraft(kind, form, ctx, { key: str(p.key), version: p.version, origin: "evidence_proposal", proposal: Object.assign(proposal, { reviewRequired: p.reviewRequired === true }) });
      it.id = b.id; it.data = b.data; it.errors = b.errors.slice();
      if (it.errors.length) return;
      var full = KINDS[kind].coll + "/" + b.id;
      if (seen[full]) { it.errors.push("The same key and version appear twice in the file."); it.data = null; return; } seen[full] = true;
      if (exists.has(full)) { it.status = "skip_exists"; it.data = null; return; }
      it.status = "create";
    });
    out.items.forEach(function (it) { out.counts[it.status]++; it.coll = it.kind ? KINDS[it.kind].coll : ""; });
    out.ok = true; return out;
  }

  var api = { KINDS: KINDS, STATUS_LABEL: STATUS_LABEL, LEVEL_OF: LEVEL_OF, normalise: normalise, buildDraft: buildDraft, editDraft: editDraft, nextVersion: nextVersion, formOf: formOf, reject: reject, retire: retire, approve: approve,
    contextLine: contextLine, intervalText: intervalText, ruleText: ruleText, origin: origin, safeUrl: safeUrl, approvalLabel: approvalLabel, needsDecision: needsDecision, planImport: planImport, docId: docId, ageText: ageText };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCA = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this));
