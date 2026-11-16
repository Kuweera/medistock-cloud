/* MediStock Cloud — Phase 5 Clinical Guidelines library helpers (Developer 2).
   Pure functions only: no database access, no page access. The same file runs in guidelines.html, in other screens
   (consultation, triage, treatment ...) and in the Node tests.

   This is a verified clinical REFERENCE library. It does not diagnose and it does not prescribe.
   Nothing here contains clinical content: every entry is typed in or imported by the facility from an approved source,
   and is only shown to ordinary staff after an authorised person has approved it.

   Collection written (name fixed by the team Data Contract): guidelines
     contract fields: id, title, category, symptoms, investigations, treatment, source
     everything else is additive (see docs/GUIDELINES_SPEC.md).

   For other screens (read-only use):
     PCG.search(list, "cough")            -> ranked entries
     PCG.suggest(list, {complaints:[], diagnoses:[], medicines:[], tests:[]}) -> entries worth reading (NOT a diagnosis)
     PCG.currentOnly(list)                -> only the approved, current version of every entry
     PCG.refOf(g)                         -> small snapshot to store on a clinical record, so the record keeps the version used
     PCG.linkFor({q, cat, id})            -> "guidelines.html?q=..." to open the library from any screen
   Phase 5b (active guidance):
     PCG.match(list, ctx, {stage})        -> relevant APPROVED guidance for THIS patient and visit, each with the reasons it was matched
     PCG.sectionsFor(g, stage)            -> what to show at triage / consult / dx / tests / treat / followup (warnings kept apart from recommendations)
     PCG.shouldShow(dismissal, item)      -> a dismissed suggestion comes back only if the reasons changed or a new version was approved
     PCG.regimenPrefill(regimen)          -> pattern to pre-fill a treatment order from a guideline regimen (clinician still confirms) */
(function (root) {
  var SCHEMA = 1;

  // ---------------------------------------------------------------- fixed lists (labels only, no clinical content)
  var CATEGORIES = [
    ["general_assessment", "General clinical assessment"],
    ["common_illnesses", "Common illnesses"],
    ["infectious", "Infectious diseases"],
    ["respiratory", "Respiratory conditions"],
    ["gastrointestinal", "Gastrointestinal conditions"],
    ["paediatric", "Paediatric care"],
    ["maternal", "Maternal and reproductive health"],
    ["ncd", "Non-communicable diseases"],
    ["emergency", "Emergency care"],
    ["wound", "Wound management"],
    ["laboratory", "Laboratory investigations"],
    ["medication_safety", "Medication safety"],
    ["followup_referral", "Follow-up and referral"]
  ];
  var CAT_LABEL = {}; CATEGORIES.forEach(function (c) { CAT_LABEL[c[0]] = c[1]; });
  function categoryLabel(k) { return CAT_LABEL[k] || (k ? String(k) : "Uncategorised"); }

  var SCOPES = { national: "National or published guideline", facility: "Our facility's own protocol" };
  var STATUS_LABEL = { draft: "Draft – not yet approved", approved: "Approved", superseded: "Replaced by a newer version", retired: "Retired" };

  // ---------------------------------------------------------------- friendly errors (no raw Firebase codes for staff)
  var FRIENDLY = {
    offline_approve: "Approving needs an internet connection so the approval can be confirmed by the server. Connect and try again.",
    not_ready: "This entry is missing required information, so it cannot be approved yet.",
    not_draft: "Only a draft can be changed. Approved entries are never edited; create a new version instead.",
    newer_exists: "A newer version of this entry has already been approved.",
    draft_exists: "A draft of the next version already exists. Open that draft instead.",
    no_permission: "You do not have permission to perform this action."
  };
  function isOfflineError(err) {
    if (!err) return false; var m = String(err.message || "");
    return err.code === "unavailable" || err.code === "deadline-exceeded" || /offline|network|failed to fetch|timed out|deadline/i.test(m);
  }
  function friendlyError(err) {
    if (!err) return "Something went wrong. Please try again.";
    if (err.pcg) return FRIENDLY[err.code] || err.message;
    if (err.code === "permission-denied") return "You do not have permission to perform this action.";
    if (isOfflineError(err)) return "There is no internet connection, so this could not be confirmed with the server.";
    if (err.code === "invalid-argument") return "Some of the information entered is not valid. Check it and try again.";
    if (err.code === "not-found") return "This entry could not be found. It may have been changed on another device.";
    return "This could not be saved. Check your internet connection and try again.";
  }
  function PCGError(code, message) { var e = new Error(message || FRIENDLY[code] || code); e.name = "PCGError"; e.pcg = true; e.code = code; return e; }

  // ---------------------------------------------------------------- small utilities
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function validISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!m) return false; var d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]; }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function norm(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }
  // one item per line (or comma/semicolon separated when asked); drops bullets and empty lines
  function lines(text) {
    if (Array.isArray(text)) return text.map(str).filter(Boolean);
    return String(text == null ? "" : text).split(/\r?\n/).map(function (l) { return str(l.replace(/^\s*(?:[-•*·]|\d+[.)])\s+/, "")); }).filter(Boolean);
  }
  function list(text) {
    if (Array.isArray(text)) return uniq(text.map(str).filter(Boolean));
    return uniq(String(text == null ? "" : text).split(/[\r\n,;]+/).map(str).filter(Boolean));
  }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = norm(x); if (k && !seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return str(x); }).map(str) : []; }
  function randId(n) { var s = "", c = "abcdefghijklmnopqrstuvwxyz0123456789"; for (var i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
  function newKey() { return "k" + Date.now().toString(36) + randId(4); }
  function idFor(key, version) { return "gl_" + key + "_v" + version; }

  // ---------------------------------------------------------------- the source line (contract field "source")
  function composeSource(g) {
    var head = str(g.sourceTitle) + (str(g.sourceEdition) ? " (" + str(g.sourceEdition) + ")" : "");
    return [head, str(g.sourceOrg), str(g.sourceRef), str(g.jurisdiction)].filter(Boolean).join(" — ");
  }


  // ---------------------------------------------------------------- who an entry applies to, and what makes it relevant (all typed in from the source)
  var STAGES = ["triage", "consult", "dx", "tests", "treat", "followup"];
  var VITALS = { temperature: "temperatureC", temp: "temperatureC", pulse: "pulse", hr: "pulse", heartrate: "pulse", resp: "respRate", rr: "respRate", respiratoryrate: "respRate", resprate: "respRate",
    spo2: "spo2", oxygen: "spo2", sbp: "bpSys", bpsys: "bpSys", systolic: "bpSys", dbp: "bpDia", bpdia: "bpDia", diastolic: "bpDia", glucose: "glucose", weight: "weightKg", pain: "painScore", muac: "muacCm" };
  var VITAL_LABEL = { temperatureC: "Temperature", pulse: "Pulse", respRate: "Breathing rate", spo2: "Oxygen saturation", bpSys: "Blood pressure (upper)", bpDia: "Blood pressure (lower)", glucose: "Glucose", weightKg: "Weight", painScore: "Pain score", muacCm: "MUAC" };
  function numOrNull(v) { if (v === "" || v == null) return null; var n = Number(v); return isFinite(n) && n >= 0 ? n : null; }
  // one trigger per line:  symptom: cough | diagnosis: malaria | test: malaria rdt = positive | medicine: name | vital: spo2 < 94
  function parseTrigger(line) {
    var m = /^\s*(symptom|complaint|diagnosis|test|medicine|vital)\s*[:\-]\s*(.+?)\s*$/i.exec(String(line || ""));
    if (!m) return null;
    var kind = m[1].toLowerCase(), body = m[2]; if (kind === "complaint") kind = "symptom";
    if (kind === "vital") {
      var v = /^([a-z0-9 ]+?)\s*(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(body); if (!v) return null;
      var f = VITALS[v[1].toLowerCase().replace(/[^a-z0-9]/g, "")]; if (!f) return null;
      return { kind: "vital", field: f, op: v[2], value: Number(v[3]), text: line.replace(/^\s*vital\s*[:\-]\s*/i, "").trim() };
    }
    if (kind === "test") { var t = /^(.+?)\s*=\s*(.+)$/.exec(body); return t ? { kind: kind, text: t[1].trim(), result: t[2].trim() } : { kind: kind, text: body }; }
    return { kind: kind, text: body };
  }
  function triggerProblems(lines_) {
    var p = []; arr(lines_).forEach(function (l) { if (!parseTrigger(l)) p.push("“" + l + "” could not be read. Write it like: symptom: cough, diagnosis: name, test: name = positive, medicine: name, or vital: spo2 < 94."); });
    return p;
  }
  function applicabilityOf(f) {
    function months(v, unit) { var n = numOrNull(v); return n == null ? null : Math.round(n * (unit === "years" ? 12 : 1)); }
    return { minAgeMonths: months(f.ageMin, f.ageMinUnit), maxAgeMonths: months(f.ageMax, f.ageMaxUnit), sex: f.sex === "female" || f.sex === "male" ? f.sex : "any", pregnancy: f.pregnancy === "pregnant" ? "pregnant" : "any", minWeightKg: numOrNull(f.wMin), maxWeightKg: numOrNull(f.wMax) };
  }
  function applicabilityForm(a) {
    a = a || {}; function split(m) { return m == null ? ["", "months"] : (m % 12 === 0 && m >= 24 ? [String(m / 12), "years"] : [String(m), "months"]); }
    var lo = split(a.minAgeMonths), hi = split(a.maxAgeMonths);
    return { ageMin: lo[0], ageMinUnit: lo[1], ageMax: hi[0], ageMaxUnit: hi[1], sex: a.sex || "any", pregnancy: a.pregnancy || "any", wMin: a.minWeightKg == null ? "" : String(a.minWeightKg), wMax: a.maxWeightKg == null ? "" : String(a.maxWeightKg) };
  }
  // regimens a guideline lists (entered from the source). frequency types: once | interval | daily | elapsed | prn
  var FREQ = { once: "Once", interval: "Every N hours", daily: "Times a day for a number of days", elapsed: "At exact hours after the start", prn: "Only when needed" };
  function cleanRegimen(r) {
    r = r || {}; var f = r.frequency || {}, type = FREQ[f.type] ? f.type : "once", fr = { type: type };
    if (type === "interval") { fr.everyHours = numOrNull(f.everyHours); fr.count = numOrNull(f.count); }
    if (type === "daily") { fr.timesPerDay = numOrNull(f.timesPerDay); fr.days = numOrNull(f.days); }
    if (type === "elapsed") fr.hours = (Array.isArray(f.hours) ? f.hours : String(f.hours == null ? "" : f.hours).split(/[,;\s]+/)).filter(function (x) { return String(x).trim() !== ""; }).map(Number).filter(function (n) { return isFinite(n) && n >= 0; });
    if (type === "prn") { fr.indication = str(f.indication); fr.minIntervalHours = numOrNull(f.minIntervalHours); fr.maxPerDay = numOrNull(f.maxPerDay); }
    return { label: str(r.label), medicine: str(r.medicine), formulation: str(r.formulation), strength: str(r.strength), doseValue: numOrNull(r.doseValue), doseUnit: str(r.doseUnit), route: str(r.route), frequency: fr,
      minAgeMonths: numOrNull(r.minAgeMonths), maxAgeMonths: numOrNull(r.maxAgeMonths), minWeightKg: numOrNull(r.minWeightKg), maxWeightKg: numOrNull(r.maxWeightKg), instructions: str(r.instructions), page: str(r.page) };
  }
  function isBlankRegimen(r) { return !str(r.label) && !str(r.medicine) && r.doseValue == null && !str(r.doseUnit) && !str(r.route); }
  function regimenProblems(rs) {
    var p = [];
    (rs || []).forEach(function (r, i) {
      var n = "Regimen " + (i + 1) + (r.label ? " (" + r.label + ")" : ""), f = r.frequency || {};
      if (!r.medicine) p.push(n + ": enter the medicine.");
      if (!(r.doseValue > 0)) p.push(n + ": enter the dose exactly as the source states it.");
      if (!r.doseUnit) p.push(n + ": enter the unit of the dose.");
      if (!r.route) p.push(n + ": enter the route.");
      if (f.type === "interval" && !(f.everyHours > 0 && f.count >= 1)) p.push(n + ": enter the hours between doses and the number of doses.");
      if (f.type === "daily" && !(f.timesPerDay >= 1 && f.timesPerDay <= 6 && f.days >= 1)) p.push(n + ": enter how many times a day (1 to 6) and for how many days.");
      if (f.type === "elapsed" && !(f.hours && f.hours.length)) p.push(n + ": enter the hours after the start, for example 0, 12, 24.");
      if (f.type === "prn" && (!f.indication || !(f.maxPerDay >= 1))) p.push(n + ": say what it is for and the most doses in a day.");
    });
    return p;
  }
  // a pattern for the treatment form. Times of day come from `timePresets` (clock times are the clinic's choice, not the guideline's).
  function regimenPrefill(r, timePresets) {
    var f = r.frequency || {}, out = { medicineName: r.medicine, formulation: r.formulation || "", strength: r.strength || "", doseValue: r.doseValue, doseUnit: r.doseUnit, route: r.route, instructions: r.instructions || "" };
    if (f.type === "interval") { out.scheduleType = "interval"; out.sched = { everyHours: f.everyHours, count: f.count }; }
    else if (f.type === "daily") { out.scheduleType = "daily"; var tp = timePresets || {}; out.sched = { times: String(tp[f.timesPerDay] || "").split(/[,\s]+/).filter(Boolean), days: f.days, timesPerDay: f.timesPerDay }; }
    else if (f.type === "elapsed") { out.scheduleType = "elapsed"; out.sched = { hours: (f.hours || []).slice() }; }
    else if (f.type === "prn") { out.scheduleType = "prn"; out.sched = { indication: f.indication || "", minIntervalHours: f.minIntervalHours == null ? 0 : f.minIntervalHours, maxPerDay: f.maxPerDay }; }
    else { out.scheduleType = "once"; out.sched = {}; }
    return out;
  }
  function regimenText(r) {
    var f = r.frequency || {}, when = f.type === "interval" ? "every " + f.everyHours + " h × " + f.count : f.type === "daily" ? f.timesPerDay + " time" + (f.timesPerDay === 1 ? "" : "s") + " a day for " + f.days + " day" + (f.days === 1 ? "" : "s")
      : f.type === "elapsed" ? "at hour " + (f.hours || []).join(", ") : f.type === "prn" ? "only when needed (" + (f.indication || "") + ")" : "once";
    return [r.medicine, r.strength, r.formulation].filter(Boolean).join(" ") + " — " + r.doseValue + " " + r.doseUnit + ", " + r.route + ", " + when;
  }

  // ---------------------------------------------------------------- building and checking an entry
  var CONTENT_KEYS = ["symptoms", "investigations", "treatment", "assessment", "warningSigns", "investigationNotes", "precautions", "followUp", "referralAdvice"];

  // form -> the document stored in Firestore. `form` holds the raw typed text; `ctx` holds who/where/version.
  function buildDoc(form, ctx) {
    var f = form || {}, c = ctx || {};
    var d = {
      title: str(f.title), category: str(f.category), scope: f.scope === "facility" ? "facility" : "national",
      symptoms: list(f.symptoms), aliases: list(f.aliases),
      investigations: lines(f.investigations), treatment: String(f.treatment == null ? "" : f.treatment).trim(),
      assessment: { questions: lines(f.aQuestions), history: lines(f.aHistory), document: lines(f.aDocument), examination: lines(f.aExam) },
      warningSigns: { danger: lines(f.wDanger), urgent: lines(f.wUrgent), referral: lines(f.wReferral) },
      investigationNotes: lines(f.investigationNotes), precautions: lines(f.precautions), followUp: lines(f.followUp), referralAdvice: lines(f.referralAdvice),
      sectionRefs: { assessment: str(f.refAssessment), warnings: str(f.refWarnings), investigations: str(f.refInvestigations), management: str(f.refManagement) },
      sourceTitle: str(f.sourceTitle), sourceOrg: str(f.sourceOrg), sourceEdition: str(f.sourceEdition), sourceRef: str(f.sourceRef), jurisdiction: str(f.jurisdiction),
      effectiveDate: str(f.effectiveDate), reviewDate: str(f.reviewDate),
      basedOnKey: f.scope === "facility" && str(f.basedOnKey) ? str(f.basedOnKey) : null,
      publicationDate: str(f.publicationDate), supportingDoc: str(f.supportingDoc),
      applicability: applicabilityOf(f), triggers: lines(f.triggers),
      regimens: (Array.isArray(f.regimens) ? f.regimens : []).map(cleanRegimen).filter(function (r) { return !isBlankRegimen(r); })
    };
    d.source = composeSource(d);
    if (c.key) { d.guidelineKey = c.key; d.version = c.version || 1; d.id = c.id || idFor(c.key, d.version); }
    return d;
  }

  // doc -> the text for each form field (to edit a draft)
  function toForm(g) {
    var a = g.assessment || {}, w = g.warningSigns || {}, r = g.sectionRefs || {}, j = function (x) { return arr(x).join("\n"); };
    return Object.assign({ title: g.title || "", category: g.category || "", scope: g.scope || "national", symptoms: arr(g.symptoms).join(", "), aliases: arr(g.aliases).join(", "), basedOnKey: g.basedOnKey || "",
      investigations: j(g.investigations), treatment: g.treatment || "",
      aQuestions: j(a.questions), aHistory: j(a.history), aDocument: j(a.document), aExam: j(a.examination),
      wDanger: j(w.danger), wUrgent: j(w.urgent), wReferral: j(w.referral),
      investigationNotes: j(g.investigationNotes), precautions: j(g.precautions), followUp: j(g.followUp), referralAdvice: j(g.referralAdvice),
      refAssessment: r.assessment || "", refWarnings: r.warnings || "", refInvestigations: r.investigations || "", refManagement: r.management || "",
      sourceTitle: g.sourceTitle || "", sourceOrg: g.sourceOrg || "", sourceEdition: g.sourceEdition || "", sourceRef: g.sourceRef || "", jurisdiction: g.jurisdiction || "",
      effectiveDate: g.effectiveDate || "", reviewDate: g.reviewDate || "", publicationDate: g.publicationDate || "", supportingDoc: g.supportingDoc || "",
      triggers: j(g.triggers), regimens: JSON.parse(JSON.stringify(g.regimens || [])) }, applicabilityForm(g.applicability));
  }

  function hasContent(g) {
    var a = g.assessment || {}, w = g.warningSigns || {};
    return [g.symptoms, g.investigations, a.questions, a.history, a.document, a.examination, w.danger, w.urgent, w.referral, g.investigationNotes, g.precautions, g.followUp, g.referralAdvice]
      .some(function (x) { return arr(x).length > 0; }) || !!str(g.treatment) || (g.regimens || []).length > 0;
  }

  // minimum needed to save a DRAFT
  function draftProblems(d) {
    var p = [];
    if (!str(d.title)) p.push("Enter the title (the name of the condition or topic).");
    if (!CAT_LABEL[d.category]) p.push("Choose a category.");
    triggerProblems(d.triggers).forEach(function (x) { p.push(x); });
    var a = d.applicability || {};
    if (a.minAgeMonths != null && a.maxAgeMonths != null && a.minAgeMonths > a.maxAgeMonths) p.push("The youngest age is above the oldest age.");
    if (a.minWeightKg != null && a.maxWeightKg != null && a.minWeightKg > a.maxWeightKg) p.push("The lowest weight is above the highest weight.");
    return p;
  }
  // everything needed before an entry can be approved and shown to ordinary staff
  function approvalProblems(g) {
    var p = draftProblems(g);
    if (!str(g.sourceTitle)) p.push("Enter the name of the guideline or document this comes from.");
    if (!str(g.sourceOrg)) p.push("Enter the organisation that published it.");
    if (!str(g.sourceEdition)) p.push("Enter the edition or year.");
    if (!str(g.sourceRef)) p.push("Enter the chapter, section or page number.");
    if (!str(g.jurisdiction)) p.push("Enter the country or area it applies to.");
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(str(g.publicationDate))) p.push("Enter when the source was published (a year, or year-month-day).");
    if (!validISO(g.effectiveDate)) p.push("Enter the date from which it applies (effective date).");
    if (!validISO(g.reviewDate)) p.push("Enter the date it must be reviewed again.");
    else if (validISO(g.effectiveDate) && g.reviewDate < g.effectiveDate) p.push("The review date cannot be before the effective date.");
    if (!hasContent(g)) p.push("Add at least some clinical information from the source.");
    regimenProblems(g.regimens).forEach(function (x) { p.push(x); });
    return p;
  }

  // ---------------------------------------------------------------- versions
  function byKey(list) {
    var m = {}; (list || []).forEach(function (g) { var k = g.guidelineKey || g.id; (m[k] = m[k] || []).push(g); });
    Object.keys(m).forEach(function (k) { m[k].sort(function (a, b) { return (b.version || 0) - (a.version || 0); }); });
    return m;
  }
  function currentVersion(versions) { for (var i = 0; i < versions.length; i++) if (versions[i].approvalStatus === "approved") return versions[i]; return null; }
  function openDraft(versions) { for (var i = 0; i < versions.length; i++) if (versions[i].approvalStatus === "draft") return versions[i]; return null; }
  function nextVersion(versions) { return versions.reduce(function (m, g) { return Math.max(m, g.version || 0); }, 0) + 1; }
  // the approved, current version of every entry (what ordinary staff see)
  function currentOnly(list) { var m = byKey(list), out = []; Object.keys(m).forEach(function (k) { var c = currentVersion(m[k]); if (c) out.push(c); }); return out; }

  // What must change in the database to approve `g`: g becomes approved; any other approved version of the same entry becomes superseded.
  // Refuses if a newer version is already approved or the entry is not ready.
  function planApprove(g, all, today) {
    if (g.approvalStatus !== "draft") throw PCGError("not_draft");
    var problems = approvalProblems(g);
    if (problems.length) { var e = PCGError("not_ready"); e.problems = problems; throw e; }
    var versions = byKey(all)[g.guidelineKey || g.id] || [], supersede = [];
    versions.forEach(function (v) {
      if (v.id === g.id) return;
      if (v.approvalStatus === "approved") { if ((v.version || 0) > (g.version || 0)) throw PCGError("newer_exists"); supersede.push(v.id); }
    });
    return { approve: g.id, supersede: supersede };
  }

  function reviewOverdue(g, today) { return g.approvalStatus === "approved" && validISO(g.reviewDate) && g.reviewDate < (today || todayISO()); }
  function reviewSoon(g, today, days) {
    if (g.approvalStatus !== "approved" || !validISO(g.reviewDate)) return false; today = today || todayISO();
    var lim = new Date(today + "T00:00:00"); lim.setDate(lim.getDate() + (days || 30)); return g.reviewDate >= today && g.reviewDate <= todayISO(lim);
  }
  function notYetEffective(g, today) { return g.approvalStatus === "approved" && validISO(g.effectiveDate) && g.effectiveDate > (today || todayISO()); }

  // ---------------------------------------------------------------- search
  var STOP = { the: 1, and: 1, for: 1, with: 1, has: 1, had: 1, have: 1, from: 1, this: 1, that: 1, pain: 0, of: 1, in: 1, on: 1, to: 1, a: 1, an: 1, is: 1, are: 1, was: 1, patient: 1, complaint: 1, complaints: 1, history: 0 };
  function tokens(s, minLen) { return norm(s).split(" ").filter(function (t) { return t && t.length >= (minLen || 1) && !STOP[t]; }); }
  function fieldsOf(g) {
    var a = g.assessment || {}, w = g.warningSigns || {};
    return [
      [10, [g.title].concat(arr(g.aliases))],
      [8, arr(g.symptoms)],
      [4, [categoryLabel(g.category)]],
      [3, arr(g.investigations)],
      [2, [g.treatment]],
      [1, [].concat(arr(a.questions), arr(a.history), arr(a.document), arr(a.examination), arr(w.danger), arr(w.urgent), arr(w.referral), arr(g.investigationNotes), arr(g.precautions), arr(g.followUp), arr(g.referralAdvice), [g.source])]
    ].map(function (f) { return [f[0], f[1].map(norm).filter(Boolean)]; });
  }
  function wordHit(text, tok) {
    if (text.indexOf(tok) < 0) return 0;
    var re = " " + text + " ";
    return re.indexOf(" " + tok + " ") >= 0 ? 2 : (re.indexOf(" " + tok) >= 0 ? 1.5 : 1);
  }
  // all words typed must be found somewhere in the entry (partial words allowed); title and symptoms count most
  function scoreEntry(g, toks) {
    if (!toks.length) return 1;
    var F = fieldsOf(g), total = 0;
    for (var i = 0; i < toks.length; i++) {
      var best = 0;
      for (var j = 0; j < F.length; j++) for (var k = 0; k < F[j][1].length; k++) { var h = wordHit(F[j][1][k], toks[i]); if (h) best = Math.max(best, F[j][0] * h); }
      if (!best) return 0; total += best;
    }
    return total;
  }
  function search(list, text, opts) {
    opts = opts || {}; var toks = tokens(text);
    return (list || []).filter(function (g) { return (!opts.category || g.category === opts.category) && (!opts.scope || g.scope === opts.scope); })
      .map(function (g) { return { g: g, score: scoreEntry(g, toks) }; })
      .filter(function (r) { return r.score > 0; })
      .sort(function (a, b) { return b.score - a.score || String(a.g.title).localeCompare(String(b.g.title)); });
  }

  // Entries WORTH READING for what has been recorded. This is retrieval, never a diagnosis or a recommendation.
  function suggest(list, ctx, limit) {
    ctx = ctx || {};
    var phrases = [].concat(arr(ctx.complaints), arr(ctx.diagnoses), arr(ctx.medicines), arr(ctx.tests)).map(norm).filter(function (p) { return p.length >= 3; });
    var res = [];
    (list || []).forEach(function (g) {
      var key = [g.title].concat(arr(g.aliases), arr(g.symptoms)).map(norm).filter(Boolean), matched = [], score = 0;
      phrases.forEach(function (p) {
        var pt = tokens(p, 3), hit = false;
        key.forEach(function (k, idx) {
          if (hit) return;
          var kt = tokens(k, 3);
          if (k === p) { hit = true; score += 10; }
          else if (k.length >= 4 && (" " + p + " ").indexOf(" " + k + " ") >= 0) { hit = true; score += 6; }
          else if (pt.length && pt.every(function (t) { return kt.indexOf(t) >= 0; })) { hit = true; score += 5; }
        });
        if (hit) matched.push(p);
      });
      if (matched.length) res.push({ g: g, score: score, matchedOn: matched });
    });
    // medicines and tests are matched against the treatment / investigation lists as a weaker signal
    var secondary = [].concat(arr(ctx.medicines), arr(ctx.tests)).map(norm).filter(function (p) { return p.length >= 4; });
    if (secondary.length) (list || []).forEach(function (g) {
      if (res.some(function (r) { return r.g.id === g.id; })) return;
      var hay = [norm(g.treatment)].concat(arr(g.investigations).map(norm)), m = secondary.filter(function (p) { return hay.some(function (h) { return (" " + h + " ").indexOf(" " + p + " ") >= 0; }); });
      if (m.length) res.push({ g: g, score: 1, matchedOn: m });
    });
    res.sort(function (a, b) { return b.score - a.score || String(a.g.title).localeCompare(String(b.g.title)); });
    return res.slice(0, limit || 8);
  }

  // ---------------------------------------------------------------- what other screens store on a clinical record
  function refOf(g) {
    return { guidelineId: g.id, guidelineKey: g.guidelineKey || g.id, guidelineVersion: g.version || 1, guidelineTitle: g.title || "", guidelineScope: g.scope || "national", guidelineSource: g.source || composeSource(g) };
  }
  function refText(g) {
    return (g.title || "") + " — " + (g.scope === "facility" ? "Local facility protocol" : "National/published guideline") + ", version " + (g.version || 1) + "\nSource: " + (g.source || composeSource(g)) +
      (g.effectiveDate ? "\nEffective: " + g.effectiveDate : "") + (g.reviewDate ? " · Review due: " + g.reviewDate : "") + (g.approvedByName ? "\nApproved by: " + g.approvedByName : "");
  }
  function linkFor(o) {
    o = o || {}; var q = [];
    ["q", "cat", "id", "scope"].forEach(function (k) { if (o[k]) q.push(k + "=" + encodeURIComponent(o[k])); });
    return "guidelines.html" + (q.length ? "?" + q.join("&") : "");
  }

  // ---------------------------------------------------------------- importing from a file or pasted JSON (always lands as DRAFT)
  var TEMPLATE_ITEM = {
    title: "", category: "common_illnesses", scope: "national",
    symptoms: [], aliases: [],
    sourceTitle: "", sourceOrg: "", sourceEdition: "", sourceRef: "", jurisdiction: "", effectiveDate: "YYYY-MM-DD", reviewDate: "YYYY-MM-DD",
    assessment: { questions: [], history: [], document: [], examination: [] },
    warningSigns: { danger: [], urgent: [], referral: [] },
    investigations: [], investigationNotes: [], treatment: "", precautions: [], followUp: [], referralAdvice: [],
    sectionRefs: { assessment: "", warnings: "", investigations: "", management: "" },
    publicationDate: "YYYY or YYYY-MM-DD", supportingDoc: "",
    applicability: { minAgeMonths: null, maxAgeMonths: null, sex: "any", pregnancy: "any", minWeightKg: null, maxWeightKg: null },
    triggers: [],
    regimens: []
  };
  function templateJSON() {
    return JSON.stringify({ _readme: "Fill ONLY from an approved source (e.g. Uganda Clinical Guidelines, MoH, WHO, or your facility's approved protocol). Do not invent doses or thresholds. Every entry is imported as a DRAFT and must be approved by an authorised person. category must be one of: " + CATEGORIES.map(function (c) { return c[0]; }).join(", ") + ". Dates are YYYY-MM-DD.", entries: [TEMPLATE_ITEM] }, null, 2);
  }
  function pickLines(v) { return Array.isArray(v) ? v.map(str).filter(Boolean) : lines(v); }
  function parseImport(text, maxItems) {
    maxItems = maxItems || 200;
    var out = { items: [], errors: [] }, data;
    try { data = JSON.parse(String(text || "")); } catch (e) { out.errors.push("This is not a valid JSON file. Use the blank template as a starting point."); return out; }
    var raw = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : null);
    if (!raw) { out.errors.push('The file must contain a list called "entries".'); return out; }
    if (raw.length > maxItems) { out.errors.push("Import at most " + maxItems + " entries at a time (this file has " + raw.length + ")."); return out; }
    raw.forEach(function (r, i) {
      var n = "Entry " + (i + 1) + (r && r.title ? " (" + r.title + ")" : ""), a = (r && r.assessment) || {}, w = (r && r.warningSigns) || {}, s = (r && r.sectionRefs) || {};
      if (!r || typeof r !== "object") { out.errors.push(n + ": not an entry."); return; }
      var form = { title: r.title, category: r.category, scope: r.scope === "facility" ? "facility" : "national", symptoms: Array.isArray(r.symptoms) ? r.symptoms.join(",") : r.symptoms, aliases: Array.isArray(r.aliases) ? r.aliases.join(",") : r.aliases,
        investigations: pickLines(r.investigations), treatment: Array.isArray(r.treatment) ? r.treatment.join("\n") : r.treatment,
        aQuestions: pickLines(a.questions), aHistory: pickLines(a.history), aDocument: pickLines(a.document), aExam: pickLines(a.examination),
        wDanger: pickLines(w.danger), wUrgent: pickLines(w.urgent), wReferral: pickLines(w.referral),
        investigationNotes: pickLines(r.investigationNotes), precautions: pickLines(r.precautions), followUp: pickLines(r.followUp), referralAdvice: pickLines(r.referralAdvice),
        refAssessment: s.assessment, refWarnings: s.warnings, refInvestigations: s.investigations, refManagement: s.management,
        sourceTitle: r.sourceTitle, sourceOrg: r.sourceOrg, sourceEdition: r.sourceEdition, sourceRef: r.sourceRef, jurisdiction: r.jurisdiction,
        effectiveDate: validISO(r.effectiveDate) ? r.effectiveDate : "", reviewDate: validISO(r.reviewDate) ? r.reviewDate : "",
        publicationDate: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(str(r.publicationDate)) ? str(r.publicationDate) : "", supportingDoc: r.supportingDoc, triggers: pickLines(r.triggers), regimens: Array.isArray(r.regimens) ? r.regimens : [] };
      var ap = r.applicability || {}; Object.assign(form, { ageMin: ap.minAgeMonths == null ? "" : ap.minAgeMonths, ageMinUnit: "months", ageMax: ap.maxAgeMonths == null ? "" : ap.maxAgeMonths, ageMaxUnit: "months", sex: ap.sex, pregnancy: ap.pregnancy, wMin: ap.minWeightKg, wMax: ap.maxWeightKg });
      var d = buildDoc(form), p = draftProblems(d);
      if (p.length) { out.errors.push(n + ": " + p.join(" ")); return; }
      d._notReady = approvalProblems(d).length;
      out.items.push(d);
    });
    return out;
  }


  // ---------------------------------------------------------------- the matching engine (retrieval only: it never diagnoses and never prescribes)
  // ctx: { ageMonths, sex:"male"|"female"|null, pregnancy:true|false|null, weightKg, complaints:[], findings:[], vitals:{temperatureC,pulse,respRate,spo2,bpSys,bpDia,glucose,weightKg,painScore,muacCm},
  //        diagnoses:[], tests:[{name,result}|"name"], medicines:[] }
  function phraseHit(phrase, cands) {
    var p = norm(phrase); if (p.length < 3) return null; var pt = tokens(p, 3);
    for (var i = 0; i < cands.length; i++) {
      var k = norm(cands[i]); if (!k) continue; var kt = tokens(k, 3);
      if (k === p) return cands[i];
      if (k.length >= 4 && (" " + p + " ").indexOf(" " + k + " ") >= 0) return cands[i];
      if (pt.length && pt.every(function (t) { return kt.indexOf(t) >= 0; })) return cands[i];
    }
    return null;
  }
  function fitCheck(a, ctx, restrictedWord) {
    var notes = [], ok = true; a = a || {};
    if (a.minAgeMonths != null || a.maxAgeMonths != null) {
      if (ctx.ageMonths == null) notes.push("Age is not recorded. This guidance is limited by age, so check it applies.");
      else if ((a.minAgeMonths != null && ctx.ageMonths < a.minAgeMonths) || (a.maxAgeMonths != null && ctx.ageMonths > a.maxAgeMonths)) ok = false;
    }
    if (a.sex && a.sex !== "any") { if (!ctx.sex) notes.push("Sex is not recorded. This guidance is for " + a.sex + " patients."); else if (ctx.sex !== a.sex) ok = false; }
    if (a.pregnancy === "pregnant") {
      if (ctx.pregnancy === true) { /* applies */ } else if (ctx.pregnancy === false || ctx.sex === "male") ok = false; else notes.push("This guidance is for pregnancy. Pregnancy is not recorded for this patient.");
    }
    if (a.minWeightKg != null || a.maxWeightKg != null) {
      if (!(ctx.weightKg > 0)) notes.push("Weight is not recorded. This guidance is limited by weight, so check it applies.");
      else if ((a.minWeightKg != null && ctx.weightKg < a.minWeightKg) || (a.maxWeightKg != null && ctx.weightKg > a.maxWeightKg)) ok = false;
    }
    return { ok: ok, notes: notes };
  }
  function compare(v, op, x) { return op === "<" ? v < x : op === "<=" ? v <= x : op === ">" ? v > x : op === ">=" ? v >= x : v === x; }
  function sectionRef(g, group) { var r = g.sectionRefs || {}; return r[group] || ""; }
  var SECTION_DEFS = [
    // key, title, kind, group (for the page reference), getter
    ["danger", "Danger signs", "warning", "warnings", function (g) { return arr((g.warningSigns || {}).danger); }],
    ["urgent", "Findings needing urgent assessment", "warning", "warnings", function (g) { return arr((g.warningSigns || {}).urgent); }],
    ["referralSigns", "Referral considerations", "warning", "warnings", function (g) { return arr((g.warningSigns || {}).referral); }],
    ["questions", "Questions to ask", "info", "assessment", function (g) { return arr((g.assessment || {}).questions); }],
    ["history", "History to take", "info", "assessment", function (g) { return arr((g.assessment || {}).history); }],
    ["document", "Symptoms to document", "info", "assessment", function (g) { return arr((g.assessment || {}).document); }],
    ["exam", "Examination findings to look for", "info", "assessment", function (g) { return arr((g.assessment || {}).examination); }],
    ["tests", "Tests mentioned in the source", "recommend", "investigations", function (g) { return arr(g.investigations); }],
    ["testNotes", "What the tests are for and how to read them", "info", "investigations", function (g) { return arr(g.investigationNotes); }],
    ["treatment", "Treatment information in the source", "recommend", "management", function (g) { return str(g.treatment) ? [str(g.treatment)] : []; }],
    ["precautions", "Precautions", "warning", "management", function (g) { return arr(g.precautions); }],
    ["followUp", "Follow-up", "recommend", "management", function (g) { return arr(g.followUp); }],
    ["referral", "Referral", "recommend", "management", function (g) { return arr(g.referralAdvice); }]
  ];
  var STAGE_SECTIONS = {
    triage: ["danger", "urgent", "document"],
    consult: ["danger", "urgent", "questions", "history", "document", "exam"],
    dx: ["danger", "urgent", "referralSigns", "tests", "testNotes"],
    tests: ["tests", "testNotes"],
    treat: ["precautions", "danger", "treatment"],
    followup: ["followUp", "referral", "referralSigns"]
  };
  function sectionsFor(g, stage) {
    var keys = STAGE_SECTIONS[stage] || [], out = [];
    SECTION_DEFS.forEach(function (d) { if (keys.indexOf(d[0]) < 0) return; var items = d[4](g); if (items.length) out.push({ key: d[0], title: d[1], kind: d[2], items: items, page: sectionRef(g, d[3]) }); });
    return out;
  }
  function regimenFit(r, ctx) {
    var notes = [], ok = true;
    if (r.minAgeMonths != null || r.maxAgeMonths != null) { if (ctx.ageMonths == null) notes.push("Age is not recorded; this regimen has an age range."); else if ((r.minAgeMonths != null && ctx.ageMonths < r.minAgeMonths) || (r.maxAgeMonths != null && ctx.ageMonths > r.maxAgeMonths)) ok = false; }
    if (r.minWeightKg != null || r.maxWeightKg != null) { if (!(ctx.weightKg > 0)) notes.push("Weight is not recorded; this regimen has a weight range."); else if ((r.minWeightKg != null && ctx.weightKg < r.minWeightKg) || (r.maxWeightKg != null && ctx.weightKg > r.maxWeightKg)) ok = false; }
    return { ok: ok, notes: notes };
  }

  function match(list, ctx, opts) {
    ctx = ctx || {}; opts = opts || {}; var stage = opts.stage || "consult", today = opts.today || todayISO(), out = [];
    var complaints = arr(ctx.complaints), findings = arr(ctx.findings), dxs = arr(ctx.diagnoses), meds = arr(ctx.medicines), vitals = ctx.vitals || {};
    var tests = (ctx.tests || []).map(function (t) { return typeof t === "string" ? { name: t, result: "" } : { name: str(t.name), result: str(t.result) }; });
    currentOnly(list).forEach(function (g) {
      if (notYetEffective(g, today)) return;
      var fit = fitCheck(g.applicability, ctx); if (!fit.ok) return;
      var reasons = [], seen = {};
      function add(kind, key, text, w) { if (seen[key]) return; seen[key] = 1; reasons.push({ kind: kind, key: key, text: text, w: w }); }
      // title / other names against the diagnosis and the complaint; symptoms against complaints and findings
      var names = [g.title].concat(arr(g.aliases));
      dxs.forEach(function (d) { var h = phraseHit(d, names); if (h) add("diagnosis", "dx:" + norm(d) + ">" + norm(h), "Diagnosis recorded: “" + d + "”", 10); });
      complaints.forEach(function (c) { var h = phraseHit(c, names.concat(arr(g.symptoms))); if (h) add("symptom", "sy:" + norm(c) + ">" + norm(h), "Complaint recorded: “" + c + "”", 6); });
      findings.forEach(function (c) { var h = phraseHit(c, arr(g.symptoms)); if (h) add("symptom", "fi:" + norm(c) + ">" + norm(h), "Finding recorded: “" + c + "”", 5); });
      arr(g.triggers).forEach(function (line) {
        var t = parseTrigger(line); if (!t) return;
        if (t.kind === "symptom") complaints.concat(findings).forEach(function (c) { if (phraseHit(c, [t.text])) add("symptom", "ts:" + norm(c) + ">" + norm(t.text), "Complaint or finding recorded: “" + c + "”", 6); });
        else if (t.kind === "diagnosis") dxs.forEach(function (d) { if (phraseHit(d, [t.text])) add("diagnosis", "td:" + norm(d) + ">" + norm(t.text), "Diagnosis recorded: “" + d + "”", 10); });
        else if (t.kind === "medicine") meds.forEach(function (m) { if (phraseHit(m, [t.text])) add("medicine", "tm:" + norm(m) + ">" + norm(t.text), "Medicine recorded: “" + m + "”", 3); });
        else if (t.kind === "test") tests.forEach(function (x) { if (!phraseHit(x.name, [t.text])) return; if (t.result && !(norm(x.result).indexOf(norm(t.result)) >= 0)) return; add("test", "tt:" + norm(x.name) + (t.result ? "=" + norm(t.result) : ""), "Test " + (x.result ? "result" : "requested") + ": " + x.name + (x.result ? " — " + x.result : ""), 6); });
        else if (t.kind === "vital") { var v = vitals[t.field]; if (v != null && v !== "" && isFinite(Number(v)) && compare(Number(v), t.op, t.value)) add("vital", "tv:" + t.field + t.op + t.value, VITAL_LABEL[t.field] + " recorded as " + v + " (the guideline flags " + t.op + " " + t.value + ")", 8); }
      });
      if (!reasons.length) return;
      var sections = sectionsFor(g, stage), regs = [], hidden = 0;
      if (stage === "treat") (g.regimens || []).forEach(function (r, i) { var f = regimenFit(r, ctx); if (f.ok) regs.push({ index: i, r: r, notes: f.notes }); else hidden++; });
      if (!sections.length && !regs.length) return;
      out.push({ id: g.id, key: g.guidelineKey || g.id, g: g, stage: stage, score: reasons.reduce(function (a, r) { return a + r.w; }, 0), reasons: reasons, notes: fit.notes, sections: sections, regimens: regs, regimensHidden: hidden,
        hasWarning: sections.some(function (x) { return x.kind === "warning"; }), overdue: reviewOverdue(g, today) });
    });
    out.sort(function (a, b) { return b.score - a.score || String(a.g.title).localeCompare(String(b.g.title)); });
    return out.slice(0, opts.limit || 6);
  }

  // ---------------------------------------------------------------- dismissing a suggestion
  // A dismissed suggestion stays hidden until something meaningful changes: a NEW reason appears, or a newer version of the guideline is approved.
  function dismissRecord(item) { return { key: item.key, version: item.g.version || 1, reasons: item.reasons.map(function (r) { return r.key; }), at: Date.now() }; }
  function shouldShow(d, item) {
    if (!d) return true;
    if ((item.g.version || 1) !== d.version) return true;
    var had = d.reasons || [];
    return item.reasons.some(function (r) { return had.indexOf(r.key) < 0; });
  }

  var api = {
    SCHEMA: SCHEMA, CATEGORIES: CATEGORIES, SCOPES: SCOPES, STATUS_LABEL: STATUS_LABEL, CONTENT_KEYS: CONTENT_KEYS,
    categoryLabel: categoryLabel, friendlyError: friendlyError, isOfflineError: isOfflineError, PCGError: PCGError,
    todayISO: todayISO, validISO: validISO, norm: norm, lines: lines, list: list, newKey: newKey, idFor: idFor,
    composeSource: composeSource, buildDoc: buildDoc, toForm: toForm, hasContent: hasContent, draftProblems: draftProblems, approvalProblems: approvalProblems,
    byKey: byKey, currentVersion: currentVersion, openDraft: openDraft, nextVersion: nextVersion, currentOnly: currentOnly, planApprove: planApprove,
    reviewOverdue: reviewOverdue, reviewSoon: reviewSoon, notYetEffective: notYetEffective,
    STAGES: STAGES, FREQ: FREQ, VITAL_LABEL: VITAL_LABEL, parseTrigger: parseTrigger, triggerProblems: triggerProblems, applicabilityOf: applicabilityOf, applicabilityForm: applicabilityForm,
    cleanRegimen: cleanRegimen, regimenProblems: regimenProblems, regimenPrefill: regimenPrefill, regimenText: regimenText, sectionsFor: sectionsFor, match: match, dismissRecord: dismissRecord, shouldShow: shouldShow,
    search: search, suggest: suggest, refOf: refOf, refText: refText, linkFor: linkFor, templateJSON: templateJSON, parseImport: parseImport
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCG = api;
})(typeof window !== "undefined" ? window : this);
