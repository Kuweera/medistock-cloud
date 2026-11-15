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
     PCG.linkFor({q, cat, id})            -> "guidelines.html?q=..." to open the library from any screen */
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
      basedOnKey: f.scope === "facility" && str(f.basedOnKey) ? str(f.basedOnKey) : null
    };
    d.source = composeSource(d);
    if (c.key) { d.guidelineKey = c.key; d.version = c.version || 1; d.id = c.id || idFor(c.key, d.version); }
    return d;
  }

  // doc -> the text for each form field (to edit a draft)
  function toForm(g) {
    var a = g.assessment || {}, w = g.warningSigns || {}, r = g.sectionRefs || {}, j = function (x) { return arr(x).join("\n"); };
    return { title: g.title || "", category: g.category || "", scope: g.scope || "national", symptoms: arr(g.symptoms).join(", "), aliases: arr(g.aliases).join(", "), basedOnKey: g.basedOnKey || "",
      investigations: j(g.investigations), treatment: g.treatment || "",
      aQuestions: j(a.questions), aHistory: j(a.history), aDocument: j(a.document), aExam: j(a.examination),
      wDanger: j(w.danger), wUrgent: j(w.urgent), wReferral: j(w.referral),
      investigationNotes: j(g.investigationNotes), precautions: j(g.precautions), followUp: j(g.followUp), referralAdvice: j(g.referralAdvice),
      refAssessment: r.assessment || "", refWarnings: r.warnings || "", refInvestigations: r.investigations || "", refManagement: r.management || "",
      sourceTitle: g.sourceTitle || "", sourceOrg: g.sourceOrg || "", sourceEdition: g.sourceEdition || "", sourceRef: g.sourceRef || "", jurisdiction: g.jurisdiction || "",
      effectiveDate: g.effectiveDate || "", reviewDate: g.reviewDate || "" };
  }

  function hasContent(g) {
    var a = g.assessment || {}, w = g.warningSigns || {};
    return [g.symptoms, g.investigations, a.questions, a.history, a.document, a.examination, w.danger, w.urgent, w.referral, g.investigationNotes, g.precautions, g.followUp, g.referralAdvice]
      .some(function (x) { return arr(x).length > 0; }) || !!str(g.treatment);
  }

  // minimum needed to save a DRAFT
  function draftProblems(d) {
    var p = [];
    if (!str(d.title)) p.push("Enter the title (the name of the condition or topic).");
    if (!CAT_LABEL[d.category]) p.push("Choose a category.");
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
    if (!validISO(g.effectiveDate)) p.push("Enter the date from which it applies (effective date).");
    if (!validISO(g.reviewDate)) p.push("Enter the date it must be reviewed again.");
    else if (validISO(g.effectiveDate) && g.reviewDate < g.effectiveDate) p.push("The review date cannot be before the effective date.");
    if (!hasContent(g)) p.push("Add at least some clinical information from the source.");
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
    sectionRefs: { assessment: "", warnings: "", investigations: "", management: "" }
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
        effectiveDate: validISO(r.effectiveDate) ? r.effectiveDate : "", reviewDate: validISO(r.reviewDate) ? r.reviewDate : "" };
      var d = buildDoc(form), p = draftProblems(d);
      if (p.length) { out.errors.push(n + ": " + p.join(" ")); return; }
      d._notReady = approvalProblems(d).length;
      out.items.push(d);
    });
    return out;
  }

  var api = {
    SCHEMA: SCHEMA, CATEGORIES: CATEGORIES, SCOPES: SCOPES, STATUS_LABEL: STATUS_LABEL, CONTENT_KEYS: CONTENT_KEYS,
    categoryLabel: categoryLabel, friendlyError: friendlyError, isOfflineError: isOfflineError, PCGError: PCGError,
    todayISO: todayISO, validISO: validISO, norm: norm, lines: lines, list: list, newKey: newKey, idFor: idFor,
    composeSource: composeSource, buildDoc: buildDoc, toForm: toForm, hasContent: hasContent, draftProblems: draftProblems, approvalProblems: approvalProblems,
    byKey: byKey, currentVersion: currentVersion, openDraft: openDraft, nextVersion: nextVersion, currentOnly: currentOnly, planApprove: planApprove,
    reviewOverdue: reviewOverdue, reviewSoon: reviewSoon, notYetEffective: notYetEffective,
    search: search, suggest: suggest, refOf: refOf, refText: refText, linkFor: linkFor, templateJSON: templateJSON, parseImport: parseImport
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCG = api;
})(typeof window !== "undefined" ? window : this);
