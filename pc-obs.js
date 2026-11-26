/* MediStock Cloud — observation interpretation engine (Developer 4, Stage 3a).
   Pure functions: no database, no page. The one place that turns a measurement + the patient + what was stated at entry into an interpretation.
   Forms must call this and draw what it returns (pc-obs-ui.js, later). They must not carry range or age logic of their own.

   THIS FILE CONTAINS NO CLINICAL VALUES AND NO CLINICAL MESSAGES. Reference intervals come from pc_reference_ranges and thresholds from pc_alert_rules,
   both entered or imported as drafts and then approved by a person with the right permission. The only wording written here is neutral (what a state means).

   Interpretation states (one per measurement):
     normal             inside an approved reference interval                       outside_reference  outside the interval, and no alert threshold reached
     screening_positive a screening threshold was reached (not a diagnosis)         moderate_alert     an alert threshold was reached
     critical_alert     an emergency threshold was reached; needs acknowledgement   invalid            the entry itself is not a valid measurement (never a clinical result)
     not_configured     no approved reference range or rule applies                 context_required   something the rules need was not stated
     conflict           equally specific rules disagree; no interpretation          pending_review     only unapproved proposals exist; none is used
   Rules:
   - Only approved, currently effective rules are used. Drafts (draft, draft_evidence_based, review_required) never alert. Rejected, superseded and retired rules are ignored.
   - A missing reference range is never normal. A normal interval and an alert threshold stay separate and are read from separate rules.
   - A danger is never hidden: if any alert fires it wins over a range conflict, a disagreement between equally specific alert rules, or a missing range. Where a rule might fire but needs context that was not stated, the answer is "context required" and says what it would mean. */
(function (root) {
  "use strict";
  var PCR = root.PCR || (typeof require !== "undefined" ? require("./pc-ranges.js") : null);

  var STATES = ["normal", "screening_positive", "moderate_alert", "critical_alert", "outside_reference", "invalid", "not_configured", "context_required", "conflict", "pending_review", "device_range"];
  var TYPE_LEVEL = { screening: "screening", alert: "moderate", emergency: "critical" };            // ruleType -> level
  var LEVEL_RANK = { screening: 1, moderate: 2, critical: 3 };
  var LEVEL_STATE = { screening: "screening_positive", moderate: "moderate_alert", critical: "critical_alert" };
  var OPS = ["lt", "lte", "gt", "gte", "range"];
  var TONE = { normal: "ok", outside_reference: "amber", screening_positive: "amber", moderate_alert: "amber", critical_alert: "red", invalid: "invalid", not_configured: "grey", context_required: "info", conflict: "amber", pending_review: "grey", device_range: "info" };
  var NOTE = "A reference-range warning never replaces clinical examination.";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function fmt(n) { return String(Math.round(n * 1e6) / 1e6); }
  function same(r, inp) { return r && r.subjectType === inp.subjectType && r.subjectId === inp.subjectId && str(r.paramKey) === str(inp.paramKey); }

  // ---------------------------------------------------------------- 1. the entry itself (never a clinical result)
  /* isBlank(raw): nothing was entered (the form should not interpret it) */
  function isBlank(raw) { return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === ""); }
  /* validateEntry({ raw, unit, expectedUnit, limits: {min, max}, maxDecimals }) -> { ok, value, code, text }
     Checks the number format, the unit and the entry limits. A decimal comma is refused (1,5 could be read as 1500). Entry limits are data-entry sanity limits the form already has; they are not reference ranges. */
  function validateEntry(i) {
    i = i || {}; var raw = i.raw;
    if (isBlank(raw)) return { ok: false, value: null, code: "empty", text: "No value was entered." };
    var v;
    if (typeof raw === "number") v = raw;
    else { var t = String(raw).trim(); if (/,/.test(t)) return { ok: false, value: null, code: "format", text: "Use a decimal point, not a comma, and no thousands separators." }; if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, value: null, code: "format", text: "This is not a valid number." }; v = Number(t); }
    if (!isFinite(v)) return { ok: false, value: null, code: "format", text: "This is not a valid number." };
    if (str(i.unit) && str(i.expectedUnit) && PCR.normUnit(i.unit) !== PCR.normUnit(i.expectedUnit)) return { ok: false, value: v, code: "unit", text: "The unit \"" + str(i.unit) + "\" does not match the unit this measurement is recorded in (" + str(i.expectedUnit) + "). No conversion is attempted." };
    var L = i.limits || {};
    if ((isNum(L.min) && v < L.min) || (isNum(L.max) && v > L.max)) return { ok: false, value: v, code: "limits", text: "This value is outside what can be entered for this measurement (" + (isNum(L.min) ? fmt(L.min) : "…") + " to " + (isNum(L.max) ? fmt(L.max) : "…") + "). Check the reading. This is a data-entry check, not a clinical result." };
    if (isNum(i.maxDecimals)) { var d = String(raw).split(".")[1]; if (d && d.length > i.maxDecimals) return { ok: false, value: v, code: "decimals", text: "Too many decimal places (at most " + i.maxDecimals + ")." }; }
    return { ok: true, value: v, code: "", text: "" };
  }


  // ---------------------------------------------------------------- 2b. device result outside the measuring range (contract section 18, rules v29)
  /* A device can report "below" or "above" its measuring range. That is a STATUS, not a number: it is stored as <measure>Status (below_device_range | above_device_range),
     the unit is kept (<measure>Unit), and the device name is optional (<measure>Device, at most 100 characters). No number is stored, no reference range is looked at, no alert rule is run,
     and NO interpretation is calculated: nothing is written to `interp` for it. Only glucose is enabled today (owner decision); another measurement is added to STATUS_MEASURES only after the owner
     has established which instruments support it AND the contract names its fields. Nothing here is a limit or a threshold. */
  var STATUS_VALUES = ["below_device_range", "above_device_range"];
  var STATUS_MEASURES = { glucose: { label: "Blood glucose", units: ["mg/dL", "mmol/L"] } };
  var STATUS_TEXT = { below_device_range: "below the measuring range of the device", above_device_range: "above the measuring range of the device" };
  /* deviceStatus({ key, status, unit, device, raw }) -> { ok, errors, key, status, state: "device_range", label, unit, device, fields, valueText, statusLine, tone, saveable, requiresAck, alerts, reference, snapshot }
     `fields` is exactly what is merged into the pc_triage document (glucoseStatus, glucoseUnit, glucoseDevice only when given). `glucose` is NOT among them: the number stays absent, never null, never made up.
     `raw` is the number box: it must be blank, because the rules refuse a status and a number together. `snapshot` is null by design: there is no interpretation to keep. */
  function deviceStatus(inp) {
    inp = inp || {}; var key = str(inp.key), M = STATUS_MEASURES[key], e = [];
    var out = { ok: false, errors: e, key: key, status: str(inp.status), state: "device_range", tone: TONE.device_range, label: M ? M.label : key, unit: "", device: "", fields: {}, valueText: "", statusLine: "", saveable: false, requiresAck: false, alerts: [], needs: [], reference: null, value: null, snapshot: null };
    if (!M) { e.push("A device status is not available for this measurement."); return out; }
    if (STATUS_VALUES.indexOf(out.status) < 0) e.push("Choose whether the result was below or above the measuring range of the device.");
    if (!isBlank(inp.raw)) e.push("A device status and a number cannot be recorded together. Clear the number, or clear the status.");
    var u = null; M.units.forEach(function (x) { if (PCR.normUnit(x) === PCR.normUnit(inp.unit) && str(inp.unit) !== "") u = x; });
    if (u === null) e.push("Choose the unit the device reported in (" + M.units.join(" or ") + "). The unit is kept with the status.");
    var dv = inp.device; if (dv !== undefined && dv !== null && typeof dv !== "string") e.push("The device name must be text."); else { dv = str(dv); if (dv.length > 100) e.push("The device name is too long (at most 100 characters)."); }
    if (e.length) return out;
    out.ok = true; out.saveable = true; out.unit = u; out.device = dv;
    out.fields[key + "Status"] = out.status; out.fields[key + "Unit"] = u; if (dv) out.fields[key + "Device"] = dv;
    out.valueText = out.label + ": " + STATUS_TEXT[out.status] + " (" + u + "), no number" + (dv ? ", device " + dv : "");
    out.statusLine = "The device reported a result " + STATUS_TEXT[out.status] + ", so there is no number. No reference range or alert rule is applied and no interpretation is calculated. " + NOTE;
    return out;
  }

  /* statusOfRecord(record, key) -> null, or { status, unit, device, text } for a STORED observation that carries a device status (contract section 18). For history and summary screens:
     it never shows a number, never interprets, and ignores a record whose status or unit is not one the contract allows. An ordinary record gives null. */
  function statusOfRecord(rec, key) {
    var M = STATUS_MEASURES[str(key)]; if (!M || !rec || typeof rec !== "object") return null;
    var st = rec[key + "Status"]; if (STATUS_VALUES.indexOf(st) < 0) return null;
    var u = null; M.units.forEach(function (x) { if (x === rec[key + "Unit"]) u = x; }); if (u === null) return null;
    var dv = typeof rec[key + "Device"] === "string" ? str(rec[key + "Device"]).slice(0, 100) : "";
    return { status: st, unit: u, device: dv, text: M.label + ": " + STATUS_TEXT[st] + " (" + u + "), no number" + (dv ? ", device " + dv : "") };
  }

  // ---------------------------------------------------------------- 2. alert rules
  /* triggered(rule, value) -> boolean.  lt, lte, gt, gte compare with `value`. range: min inclusive up to max exclusive (so a boundary belongs to exactly one band). */
  function triggered(r, v) {
    var x = r.value, lo = r.min, hi = r.max;
    switch (r.operator) {
      case "lt": return isNum(x) && v < x; case "lte": return isNum(x) && v <= x; case "gt": return isNum(x) && v > x; case "gte": return isNum(x) && v >= x;
      case "range": return isNum(lo) && isNum(hi) && v >= lo && v < hi;
      default: return false;
    }
  }
  function opText(r, unit) {
    var u = unit ? " " + unit : "";
    switch (r.operator) {
      case "lt": return "below " + fmt(r.value) + u; case "lte": return fmt(r.value) + u + " or below"; case "gt": return "above " + fmt(r.value) + u; case "gte": return fmt(r.value) + u + " or above";
      case "range": return "from " + fmt(r.min) + " up to, not including, " + fmt(r.max) + u; default: return "";
    }
  }
  function levelOf(r) { return TYPE_LEVEL[r.ruleType] || null; }
  function alertId(r) { return "ar_" + r.ruleKey + "_v" + r.version; }
  function ruleErrors(r) {   // mirrors what the rules would refuse, for the management screen and the importer
    var e = []; r = r || {};
    if (!str(r.ruleKey)) e.push("A rule key is needed."); if (!(r.version >= 1)) e.push("A version of 1 or more is needed.");
    if (!str(r.subjectId)) e.push("Choose the measurement."); if (!str(r.unit)) e.push("Enter the unit.");
    if (!TYPE_LEVEL[r.ruleType]) e.push("Choose the rule type: screening, alert or emergency.");
    if (OPS.indexOf(r.operator) < 0) e.push("Choose how the threshold is compared.");
    else if (r.operator === "range") { if (!isNum(r.min) || !isNum(r.max)) e.push("A range needs a minimum and a maximum."); else if (r.min >= r.max) e.push("The minimum must be below the maximum."); }
    else if (!isNum(r.value)) e.push("Enter the threshold value.");
    if (str(r.message).length < 3) e.push("Write the message the clinician will see (at least 3 characters).");
    if (str(r.message).length > 300) e.push("The message is too long (at most 300 characters).");
    if (r.urgencyText !== undefined && r.urgencyText !== null && (typeof r.urgencyText !== "string" || r.urgencyText.length > 300)) e.push("The urgency text must be text of at most 300 characters.");
    if (r.contextRequired !== undefined && r.contextRequired !== null && (!Array.isArray(r.contextRequired) || r.contextRequired.length > 5)) e.push("The required context must be a list of at most 5 items.");
    if ((r.ruleType === "emergency" || r.level === "critical") && r.requiresAck !== true) e.push("An emergency or critical rule must require acknowledgement.");
    if (r.level !== undefined && ["screening", "moderate", "critical"].indexOf(r.level) < 0) e.push("The level must be screening, moderate or critical.");
    if (str(r.source).length < 3 && str(r.sourceTitle).length < 3) e.push("Name the source of this rule.");
    var base = PCR.validate({ subjectType: r.subjectType || "vital", subjectId: r.subjectId || "x", paramKey: r.paramKey, unit: r.unit || "x", refMin: 0, refMax: 1, minAgeMonths: r.minAgeMonths, maxAgeMonths: r.maxAgeMonths, sex: r.sex || "any", pregnancy: r.pregnancy || "any", lactation: r.lactation, setting: r.setting, requireFlags: r.requireFlags, forbidFlags: r.forbidFlags, boundaryNote: r.boundaryNote, decisionReason: r.decisionReason, reproductive: r.reproductive, allAges: r.allAges, source: "xxx", effectiveDate: r.effectiveDate, reviewDate: r.reviewDate });
    base.forEach(function (m) { if (e.indexOf(m) < 0) e.push(m); });
    return e;
  }

  // ---------------------------------------------------------------- 3. interpret one measurement
  function ruleView(r, v, unit) { return { ruleId: alertId(r), ruleKey: r.ruleKey, version: r.version, level: levelOf(r), ruleType: r.ruleType, group: str(r.group), message: str(r.message), urgencyText: str(r.urgencyText), threshold: opText(r, unit), requiresAck: levelOf(r) === "critical" || r.requiresAck === true, source: sourceView(r) }; }
  function sourceView(r) {
    return { organisation: str(r.sourceOrg), title: str(r.sourceTitle || r.guidelineTitle), version: str(r.sourceVersion), page: str(r.sourcePage), url: str(r.sourceUrl), notes: str(r.notes || r.evidenceNotes), source: str(r.source), approvalStatus: str(r.approvalStatus),
      effectiveDate: str(r.effectiveDate), reviewDate: str(r.reviewDate), approvedByName: str(r.approvedByName), ruleType: str(r.ruleType) || "normal", selfApproved: !!r.selfApproved };
  }

  var GENERIC = { screening: "Screening threshold reached. This is not a diagnosis; further assessment is needed.", moderate: "Alert threshold reached. Reassess the patient.", critical: "Emergency threshold reached. Urgent clinical assessment is needed." };

  /* interpret(input) -> interpretation
     input: { key, label, raw, unit, expectedUnit, limits, maxDecimals, subjectType ("vital"), subjectId (default key), paramKey, patient, ctx: { pregnancy, lactation, method, setting, specimen, labName, flags }, date,
              ranges: [pc_reference_ranges docs], alerts: [pc_alert_rules docs] }
     result: { key, label, state, tone, valueText, referenceLine, statusLine, details, value, unit, saveable, requiresAck, ackItems, alerts, needs, reference, boundary, note, snapshot } */
  function interpret(inp) {
    if (inp && inp.status !== undefined && inp.status !== null && str(inp.status) !== "") return deviceStatus(inp);   // a status is never interpreted: same answer as deviceStatus, no snapshot
    inp = inp || {}; var c = inp.ctx || {}, key = str(inp.key), label = str(inp.label) || ((PCR.VITALS[key] || {}).label) || key;
    var unit = str(inp.expectedUnit) || str((PCR.VITALS[key] || {}).unit) || str(inp.unit);
    var subj = { subjectType: inp.subjectType || "vital", subjectId: str(inp.subjectId) || key, paramKey: str(inp.paramKey) };
    var out = { key: key, label: label, state: "not_configured", tone: "grey", value: null, unit: unit, valueText: "", referenceLine: "", statusLine: "", details: [], saveable: true, requiresAck: false, ackItems: [], alerts: [], needs: [], reference: null, boundary: "", note: NOTE };
    // 1. the entry
    var ve = validateEntry({ raw: inp.raw, unit: inp.unit, expectedUnit: unit || inp.expectedUnit, limits: inp.limits, maxDecimals: inp.maxDecimals });
    out.valueText = label + (ve.value !== null && ve.value !== undefined ? " " + fmt(ve.value) : isBlank(inp.raw) ? "" : " " + str(inp.raw)) + (unit ? " " + unit : "");
    if (!ve.ok) { out.state = "invalid"; out.tone = TONE.invalid; out.saveable = false; out.statusLine = "Not a valid measurement: " + ve.text + " This is not a clinical result."; out.details.push(ve.code); return finish(out, inp, null); }
    var v = ve.value; out.value = v;
    var cx = PCR.contextOf({ unit: unit, patient: inp.patient, pregnancy: c.pregnancy, lactation: c.lactation, specimen: c.specimen, method: c.method, labName: c.labName, setting: c.setting, flags: c.flags, date: inp.date });
    // 2. the reference interval (separate from alerts)
    var rr = PCR.resolve({ subjectType: subj.subjectType, subjectId: subj.subjectId, paramKey: subj.paramKey, unit: unit, patient: inp.patient, pregnancy: c.pregnancy, lactation: c.lactation, specimen: c.specimen, method: c.method, labName: c.labName, setting: c.setting, flags: c.flags, date: inp.date, ranges: inp.ranges || [], legacy: null });
    out.reference = rr; out.referenceLine = PCR.describe(rr);
    // 3. alert rules: applicable ones, the most specific per group, then what fires
    var all = (inp.alerts || []).filter(function (r) { return same(r, subj); }), approved = all.filter(function (r) { return r.approvalStatus === "approved"; }), pendingAlerts = all.some(PCR.isPending);
    var applicable = [], blocked = [];
    approved.forEach(function (r) { var f = PCR.failures(r, cx.ctx); if (!f.length) applicable.push(r); else if (PCR.onlyMissing(f)) blocked.push({ r: r, f: f }); });
    var byGroup = {}, active = [], alertConflict = false;
    applicable.forEach(function (r) { var g = str(r.group); if (!g) active.push(r); else (byGroup[g] = byGroup[g] || []).push(r); });
    Object.keys(byGroup).forEach(function (g) {
      var top = Math.max.apply(null, byGroup[g].map(PCR.specificity)), best = byGroup[g].filter(function (r) { return PCR.specificity(r) === top; });
      var res = best.map(function (r) { return triggered(r, v); }); if (res.some(function (x) { return x; }) && res.some(function (x) { return !x; })) alertConflict = true;
      best.forEach(function (r) { active.push(r); });
    });
    var fired = active.filter(function (r) { return levelOf(r) && triggered(r, v); }).map(function (r) { return ruleView(r, v, unit); });
    fired.sort(function (a, b) { return LEVEL_RANK[b.level] - LEVEL_RANK[a.level]; });
    var possible = [];   // would fire if the missing context turned out to apply: unknown, not safe to ignore
    blocked.forEach(function (b) {
      if (!levelOf(b.r) || !triggered(b.r, v)) return;
      var g = str(b.r.group); if (g && byGroup[g] && byGroup[g].some(function (r) { return PCR.specificity(r) > PCR.specificity(b.r); })) return;
      possible.push(ruleView(b.r, v, unit)); b.f.forEach(function (x) { var n = PCR.needName(x); if (out.needs.indexOf(n) < 0) out.needs.push(n); });
    });
    out.alerts = fired;
    var top1 = fired[0], needRange = rr.contextMissing || [];
    // 4. the state
    if (top1) {
      out.state = LEVEL_STATE[top1.level]; out.tone = TONE[out.state]; out.requiresAck = fired.some(function (a) { return a.requiresAck; });
      out.ackItems = fired.filter(function (a) { return a.requiresAck; }).map(function (a) { return { key: key + "|" + a.ruleId, ruleId: a.ruleId, version: a.version, level: a.level, message: a.message || GENERIC[a.level] }; });
      out.statusLine = fired.filter(function (a) { return a.level === top1.level; }).map(function (a) { return (a.message || GENERIC[a.level]) + (a.urgencyText ? " " + a.urgencyText : ""); }).join(" ");
      out.details.push("Threshold: " + top1.threshold + (top1.source.title || top1.source.source ? " (" + (top1.source.title || top1.source.source) + (top1.source.page ? ", " + top1.source.page : "") + ")" : ""));
      if (rr.state === "conflict") out.details.push("The reference ranges for this measurement also conflict; the alert is shown regardless.");
      if (alertConflict) out.details.push("Equally specific alert rules disagree for this measurement. The alert is shown anyway; ask the clinical reviewer to correct the rules.");
    } else if (possible.length) {
      out.state = "context_required"; var worst = possible.slice().sort(function (a, b) { return LEVEL_RANK[b.level] - LEVEL_RANK[a.level]; })[0]; out.tone = worst.level === "critical" ? "red" : "amber";
      out.statusLine = "More information is needed to interpret this result: state " + out.needs.join(", ") + ". If it applies, this value reaches a " + (worst.level === "critical" ? "emergency" : worst.level === "moderate" ? "alert" : "screening") + " threshold (" + worst.threshold + ")" + (worst.message ? ": " + worst.message : ".");
      out.alerts = possible;
    } else if (rr.state === "conflict") { out.state = "conflict"; out.tone = TONE.conflict; out.statusLine = rr.reasonText; }
    else if (rr.state === "range" && (rr.min !== null || rr.max !== null)) {
      if (needRange.length) { out.state = "context_required"; out.tone = "info"; out.needs = needRange.slice(); out.statusLine = "More information is needed to choose the right reference interval: state " + needRange.join(", ") + ". Until then no interpretation is given."; }
      else if (rr.min !== null && v < rr.min) { out.state = "outside_reference"; out.tone = TONE.outside_reference; out.statusLine = "Below the configured reference interval. No alert threshold is reached. Interpret with clinical examination."; }
      else if (rr.max !== null && v > rr.max) { out.state = "outside_reference"; out.tone = TONE.outside_reference; out.statusLine = "Above the configured reference interval. No alert threshold is reached. Interpret with clinical examination."; }
      else { out.state = "normal"; out.tone = TONE.normal; out.statusLine = "Within configured reference interval."; if (rr.boundaryNote && (v === rr.min || v === rr.max)) { out.boundary = rr.boundaryNote; out.statusLine += " This value is exactly at a limit of the interval: " + rr.boundaryNote; } }
    } else if (rr.state === "range") { out.state = "not_configured"; out.tone = TONE.not_configured; out.statusLine = "The configured reference is text only, so no automatic interpretation is given. " + PCR.describe(rr); }
    else if (isMissingReason(rr.reason)) { out.state = "context_required"; out.tone = "info"; out.needs = needsOfReason(rr, out.needs); out.statusLine = "More information is needed to interpret this result: " + rr.reasonText; }
    else if (rr.pendingExists || pendingAlerts) { out.state = "pending_review"; out.tone = TONE.pending_review; out.statusLine = "A proposed reference range or rule exists but has not been approved. No interpretation is given. The result is recorded as entered."; }
    else { out.state = "not_configured"; out.tone = TONE.not_configured; out.statusLine = (rr.reason && rr.reason !== "no_range" ? "Reference range not configured. " + rr.reasonText : "Reference range not configured. The result is recorded without interpretation."); }
    return finish(out, inp, rr);
  }
  var MISSING = { age_unknown: 1, sex_unknown: 1, pregnancy_not_stated: 1, lactation_not_stated: 1, order_context_missing: 1, setting_not_stated: 1, flag_not_stated: 1 };
  function isMissingReason(r) { return !!MISSING[r]; }
  function needsOfReason(rr, cur) { var m = { age_unknown: "age", sex_unknown: "sex", pregnancy_not_stated: "pregnancy status", lactation_not_stated: "lactation status", order_context_missing: "measurement method", setting_not_stated: "clinical setting", flag_not_stated: "a clinical sign" }; var n = m[rr.reason]; return cur.indexOf(n) < 0 && n ? cur.concat(n) : cur; }

  function finish(out, inp, rr) {
    out.snapshot = snapshotOf(out, inp, rr); return out;
  }
  /* snapshotOf -> plain values stored with the observation at entry (never recalculated later): a flat map plus a list of small maps for alerts. No undefined, no nested arrays. */
  function snapshotOf(out, inp, rr) {
    var cx = PCR.contextOf({ patient: inp && inp.patient, pregnancy: inp && inp.ctx && inp.ctx.pregnancy, lactation: inp && inp.ctx && inp.ctx.lactation, date: inp && inp.date }), c = (inp && inp.ctx) || {};
    return { key: out.key, value: out.value === undefined ? null : out.value, unit: out.unit || "", state: out.state, tone: out.tone, text: out.statusLine, referenceLine: out.referenceLine || "",
      rangeId: rr && rr.rangeId ? rr.rangeId : null, rangeVersion: rr && rr.rangeVersion != null ? rr.rangeVersion : null,
      alerts: out.alerts.map(function (a) { return { ruleId: a.ruleId, version: a.version, level: a.level, ruleType: a.ruleType, group: a.group, message: a.message, threshold: a.threshold, requiresAck: a.requiresAck }; }),
      needs: out.needs.slice(), ageMonths: cx.age.months, ageBasis: cx.age.basis, sex: cx.ctx.sex, pregnancy: cx.ctx.pregnancy, lactation: cx.ctx.lactation, setting: str(c.setting), method: str(c.method),
      resolvedAt: cx.ctx.date, requiresAck: !!out.requiresAck };
  }

  // ---------------------------------------------------------------- 4. acknowledgement of critical alerts
  function validAck(a) { return !!a && typeof a === "object" && str(a.key) !== "" && str(a.by) !== "" && isNum(a.at) && a.at > 0; }
  /* makeAck(item, user, now, note) -> the record stored with the observation. The identity and the time come from the signed-in user and the clock, never from the form. */
  function makeAck(item, user, now, note) {
    if (!item || !str(item.key)) throw new Error("Nothing to acknowledge.");
    if (!user || !str(user.id)) throw new Error("The acknowledging user is not known.");
    var at = typeof now === "number" ? now : Date.now(); if (!(at > 0)) throw new Error("The time is not valid.");
    return { key: item.key, ruleId: item.ruleId, ruleVersion: item.version, by: str(user.id), byName: str(user.name), at: at, note: str(note).slice(0, 500) };
  }
  /* pendingAcks(interpretations, acks) -> items still waiting for an acknowledgement */
  function pendingAcks(list, acks) {
    var done = {}; (acks || []).forEach(function (a) { if (validAck(a)) done[a.key] = true; });
    var out = []; (list || []).forEach(function (i) { (i.ackItems || []).forEach(function (it) { if (!done[it.key]) out.push(it); }); }); return out;
  }
  /* canSave(interpretations, acks) -> { ok, reasons } : an invalid entry cannot be saved; every critical alert needs an acknowledgement first. Anything else can always be saved (clinical staff may record a measurement even when no range is configured). */
  function canSave(list, acks) {
    var reasons = []; (list || []).forEach(function (i) { if (i.state === "invalid") reasons.push((i.label || i.key) + ": " + i.statusLine); });
    pendingAcks(list, acks).forEach(function (it) { reasons.push("Acknowledge the critical alert for " + it.key.split("|")[0] + " before saving."); });
    return { ok: reasons.length === 0, reasons: reasons };
  }

  var api = { STATES: STATES, TONE: TONE, TYPE_LEVEL: TYPE_LEVEL, OPS: OPS, NOTE: NOTE, isBlank: isBlank, validateEntry: validateEntry, triggered: triggered, opText: opText, ruleErrors: ruleErrors, alertId: alertId, levelOf: levelOf,
    deviceStatus: deviceStatus, statusOfRecord: statusOfRecord, STATUS_VALUES: STATUS_VALUES, STATUS_MEASURES: STATUS_MEASURES, sourceView: sourceView, interpret: interpret, snapshotOf: snapshotOf, makeAck: makeAck, validAck: validAck, pendingAcks: pendingAcks, canSave: canSave };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCO = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this));
