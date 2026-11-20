/* MediStock Cloud — laboratory reporting profiles, result building, specimen workflow, bills and reports (Developer 4).
   Pure functions only (no Firebase), so they can be tested in Node and used by laboratory.html, investigations.html, encounter.html and lab-reports.html.
   RULES OF THIS FILE:
   - It never supplies a reference range, unit, price, critical limit, local term meaning or interpretation. Everything clinical comes from the facility's own test setup
     (the "profile"), and a profile that has a range or critical limit must also name its source.
   - Terms such as Tr / Trr / Trrk are just text the facility configures. They are never assumed to mean the same thing anywhere else.
   - A flag or "critical" mark is a comparison with what the facility entered. It is never a diagnosis. */
(function (root) {
  function num(v) { if (v === "" || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function uniq(a) { var o = []; (a || []).forEach(function (x) { x = str(x); if (x && o.indexOf(x) < 0) o.push(x); }); return o; }
  function parseList(s) { return Array.isArray(s) ? uniq(s) : uniq(String(s || "").split(/[,\n;]/)); }

  // ---------------------------------------------------------------- result types
  var TYPES = {
    number: { label: "A number (with units)", help: "A measured value such as 12.5. Add the unit and, if you have one, a reference range with its source." },
    qualitative: { label: "Positive / negative type (qualitative)", help: "A named outcome such as Positive, Negative, Reactive, Non-reactive, Detected, Not detected or Invalid. You choose the exact words your procedure uses." },
    semiquant: { label: "Graded scale (semi-quantitative)", help: "A graded result such as Trace, 1+, 2+, 3+. Type the terms in the order your procedure uses and say what each means if your procedure says so. Local terms are never assumed." },
    categorical: { label: "One of a list (categories)", help: "A fixed list of categories, for example blood groups." },
    choice: { label: "One of a list (categories)", help: "A fixed list of categories, for example blood groups." },
    text: { label: "Free text (a report)", help: "A written description by the laboratory professional." },
    multi: { label: "Several parameters in one report (panel)", help: "A test that reports several separate parameters, each with its own result type, unit and reference information." },
    titer: { label: "Titer", help: "A dilution result such as 1:80 (numeric) or a category (for example Positive at a stated dilution), following the test's method." },
    organism: { label: "Organism and antibiotic susceptibility", help: "Organisms found (or no growth) and, for each, the antibiotics tested with the result codes your laboratory uses." }
  };
  var TYPE_ORDER = ["number", "qualitative", "semiquant", "categorical", "text", "multi", "titer", "organism"];
  var PARAM_TYPES = ["number", "qualitative", "semiquant", "categorical", "text"];
  var LEGACY = { number: 1, text: 1, choice: 1 };
  function normType(t) { return t === "choice" ? "categorical" : t; }

  // ---------------------------------------------------------------- profile validation (catalogue)
  function hasRef(o) { return o.refMin != null || o.refMax != null || str(o.refText) !== ""; }
  function validateParam(p, where) {
    var w = where ? where + ": " : "";
    if (str(p.label).length < 1) return w + "Give every parameter a name.";
    var t = normType(p.type);
    if (PARAM_TYPES.indexOf(t) < 0) return w + "Choose how " + p.label + " is reported.";
    if (t === "qualitative" || t === "categorical") { if (!parseList(p.choices).length) return w + p.label + ": add the allowed results."; }
    if (t === "semiquant") { if (!scaleTerms(p.scale).length) return w + p.label + ": add the scale terms your procedure uses."; }
    var min = num(p.refMin), max = num(p.refMax);
    if ((p.refMin != null && p.refMin !== "" && min == null) || (p.refMax != null && p.refMax !== "" && max == null)) return w + p.label + ": the reference range must be numbers.";
    if (min != null && max != null && min > max) return w + p.label + ": the lowest normal value is higher than the highest.";
    if (hasRef({ refMin: min, refMax: max, refText: p.refText }) && str(p.refSource).length < 3) return w + p.label + ": say where the reference information comes from.";
    return "";
  }
  function scaleTerms(scale) {
    return (scale || []).map(function (s) { return typeof s === "string" ? { term: str(s), meaning: "" } : { term: str(s && s.term), meaning: str(s && s.meaning) }; }).filter(function (s) { return s.term; });
  }
  function validateCritical(c, type) {
    if (!c) return "";
    var low = num(c.low), high = num(c.high), vals = parseList(c.values);
    if (low == null && high == null && !vals.length) return "";
    if (str(c.source).length < 3) return "Say where the critical (urgent) limits come from.";
    if ((low != null || high != null) && type !== "number") return "Numeric critical limits only apply to a number result. For other types, list the critical results instead.";
    if (low != null && high != null && low >= high) return "The critical low must be below the critical high.";
    return "";
  }
  /* test: catalogue entry (flat) { name, category, resultType, choices, scale, params, titerMode, antibiotics, resultCodes, critical, units, refMin... } -> "" or the first problem (plain words) */
  function validateTest(t) {
    if (str(t.name).length < 2) return "Enter the test name.";
    if (!t.category) return "Choose a category.";
    var type = normType(t.resultType);
    if (!TYPES[type] && !TYPES[t.resultType]) return "Choose how the result is written.";
    if (t.price != null && t.price !== "" && (num(t.price) == null || num(t.price) < 0)) return "The price must be a number, or leave it empty.";
    if (type === "number") {
      var min = num(t.refMin), max = num(t.refMax);
      if (min != null && max != null && min > max) return "The lowest normal value is higher than the highest.";
    }
    if (type === "qualitative" || type === "categorical") { if (!parseList(t.choices).length) return "Add the allowed results, separated by commas."; }
    if (type === "semiquant" && !scaleTerms(t.scale).length) return "Add the scale terms your procedure uses (for example Trace, 1+, 2+). Nothing is filled in for you.";
    if (type === "titer") {
      if (t.titerMode === "categorical" && !parseList(t.choices).length) return "Add the allowed titer results.";
      if (t.titerMode !== "categorical" && t.titerMode !== "numeric") return "Choose whether the titer is a dilution or a category.";
    }
    if (type === "multi") {
      var ps = t.params || [];
      if (!ps.length) return "Add at least one parameter.";
      var keys = {};
      for (var i = 0; i < ps.length; i++) {
        var k = str(ps[i].key || ps[i].label).toLowerCase();
        if (keys[k]) return "Two parameters have the same name: " + ps[i].label + ".";
        keys[k] = 1;
        var bad = validateParam(ps[i], "Parameter " + (i + 1)); if (bad) return bad;
      }
    }
    if (type === "organism") {
      if (!parseList(t.resultCodes).length) return "Add the susceptibility result codes your laboratory uses (for example the letters or words on your report).";
    }
    var hasR = type === "number" && hasRef({ refMin: num(t.refMin), refMax: num(t.refMax), refText: t.refText });
    if (hasR && str(t.refSource).length < 3) return "Say where the reference range comes from.";
    var cbad = validateCritical(t.critical, type); if (cbad) return cbad;
    return "";
  }

  // ---------------------------------------------------------------- the snapshot copied onto an order when a test is requested
  function profileOf(c) {
    var type = normType(c.resultType);
    var p = { type: type, method: str(c.method), equipment: str(c.equipment), collection: str(c.collection), processing: str(c.processing), interpretation: str(c.interpretation) };
    if (type === "qualitative" || type === "categorical") p.choices = parseList(c.choices);
    if (type === "semiquant") p.scale = scaleTerms(c.scale);
    if (type === "titer") { p.titerMode = c.titerMode; p.choices = parseList(c.choices); }
    if (type === "multi") p.params = (c.params || []).map(function (x) {
      var t = normType(x.type), o = { key: str(x.key) || str(x.label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label: str(x.label), type: t, unit: str(x.unit), refMin: num(x.refMin), refMax: num(x.refMax), refText: str(x.refText), refSource: str(x.refSource) };
      if (t === "qualitative" || t === "categorical") o.choices = parseList(x.choices);
      if (t === "semiquant") o.scale = scaleTerms(x.scale);
      return o;
    });
    if (type === "organism") { p.antibiotics = parseList(c.antibiotics); p.resultCodes = parseList(c.resultCodes); p.organisms = parseList(c.organisms); }
    if (c.critical && (num(c.critical.low) != null || num(c.critical.high) != null || parseList(c.critical.values).length)) p.critical = { low: num(c.critical.low), high: num(c.critical.high), values: parseList(c.critical.values), source: str(c.critical.source) };
    return p;
  }
  /* what an order needs to carry so result entry, display and revenue work without looking the catalogue up again */
  function orderFields(c) {
    var type = normType(c.resultType), legacyKind = LEGACY[c.resultType] ? c.resultType : type;
    var o = { resultType: legacyKind, choices: parseList(c.choices), units: str(c.units), refMin: num(c.refMin), refMax: num(c.refMax), refText: str(c.refText), refSource: str(c.refSource), price: num(c.price),
      specimen: str(c.specimen), profile: profileOf(c) };
    return o;
  }
  /* an order created before profiles existed has no profile: build the equivalent so every order can be handled the same way */
  function profileFromOrder(o) {
    if (o.profile && o.profile.type) return o.profile;
    var t = normType(o.resultType);
    return { type: t, choices: parseList(o.choices), method: "", equipment: "", collection: "", processing: "", interpretation: "" };
  }

  // ---------------------------------------------------------------- building and checking a result
  function flagNumber(v, o) {
    if (v == null) return "none";
    if (o.refMin != null && v < o.refMin) return "low";
    if (o.refMax != null && v > o.refMax) return "high";
    return (o.refMin != null || o.refMax != null) ? "normal" : "none";
  }
  function critNumber(v, c) {
    if (!c || v == null) return false;
    return (c.low != null && v <= c.low) || (c.high != null && v >= c.high);
  }
  function critValue(v, c) { return !!(c && (c.values || []).indexOf(str(v)) >= 0); }
  function unitText(u) { return u ? " " + u : ""; }

  /* order: the order document (resultType, profile, units, refMin...), input: what the person entered.
     Returns { ok, error, value (readable summary, always a string or number so older screens still show something), valueType, values, flag, critical, criticalWhy[] } */
  function buildResult(order, input) {
    var prof = profileFromOrder(order), type = prof.type;
    input = input || {};
    var out = { ok: false, error: "", value: "", valueType: order.resultType || type, values: null, flag: "none", critical: false, criticalWhy: [] };
    function fail(m) { out.error = m; return out; }
    function oneOf(list, v, what) { return list.indexOf(str(v)) >= 0 ? "" : "Choose one of the allowed " + what + "."; }
    if (type === "number") {
      var n = num(input.value); if (str(input.value) === "" || n == null) return fail(str(input.value) === "" ? "Enter the result." : "The result must be a number.");
      out.value = n; out.flag = flagNumber(n, order);
      if (critNumber(n, prof.critical)) { out.critical = true; out.criticalWhy.push("Value " + n + unitText(order.units) + " is at or beyond the critical limit set by this facility."); }
    } else if (type === "qualitative" || type === "categorical") {
      var cv = str(input.value); if (!cv) return fail("Choose the result.");
      var bad = oneOf(parseList(prof.choices.length ? prof.choices : order.choices), cv, "results"); if (bad) return fail(bad);
      out.value = cv; out.valueType = LEGACY[order.resultType] ? order.resultType : type;
      if (critValue(cv, prof.critical)) { out.critical = true; out.criticalWhy.push("\"" + cv + "\" is listed as a critical result for this test."); }
      if (input.flag) out.flag = input.flag;
    } else if (type === "semiquant") {
      var sv = str(input.value); if (!sv) return fail("Choose the result.");
      var terms = (prof.scale || []).map(function (s) { return s.term; });
      var bad2 = oneOf(terms, sv, "scale terms"); if (bad2) return fail(bad2);
      out.value = sv; if (critValue(sv, prof.critical)) { out.critical = true; out.criticalWhy.push("\"" + sv + "\" is listed as a critical result for this test."); }
      if (input.flag) out.flag = input.flag;
    } else if (type === "text") {
      if (str(input.value) === "") return fail("Write the result or report."); out.value = str(input.value);
      if (input.flag) out.flag = input.flag;
    } else if (type === "titer") {
      var tv = str(input.value); if (!tv) return fail("Enter the titer.");
      if (prof.titerMode === "categorical") { var bad3 = oneOf(parseList(prof.choices), tv, "titer results"); if (bad3) return fail(bad3); }
      else if (!/^\d+\s*:\s*\d+$|^1\s*\/\s*\d+$/.test(tv)) return fail("Write the titer as a dilution, for example 1:80.");
      out.value = tv.replace(/\s+/g, "").replace(/^1\//, "1:"); if (critValue(out.value, prof.critical)) { out.critical = true; out.criticalWhy.push("Titer " + out.value + " is listed as critical."); }
      if (input.flag) out.flag = input.flag;
    } else if (type === "multi") {
      var vals = {}, parts = [], worst = "none", given = 0, params = prof.params || [], bag = input.params || {};
      for (var i = 0; i < params.length; i++) {
        var p = params[i], raw = bag[p.key], r = { label: p.label, type: p.type, unit: p.unit || "", value: null, flag: "none" };
        if (raw == null || str(raw) === "") { vals[p.key] = r; if (p.required) return fail("Enter " + p.label + "."); continue; }
        given++;
        if (p.type === "number") { var pn = num(raw); if (pn == null) return fail(p.label + " must be a number."); r.value = pn; r.flag = flagNumber(pn, p); if (p.refMin != null) r.refMin = p.refMin; if (p.refMax != null) r.refMax = p.refMax; }
        else if (p.type === "semiquant") { if ((p.scale || []).map(function (s) { return s.term; }).indexOf(str(raw)) < 0) return fail(p.label + ": choose one of the scale terms."); r.value = str(raw); }
        else if (p.type === "qualitative" || p.type === "categorical") { if ((p.choices || []).indexOf(str(raw)) < 0) return fail(p.label + ": choose one of the allowed results."); r.value = str(raw); }
        else r.value = str(raw);
        if (p.refText) r.refText = p.refText;
        vals[p.key] = r;
        parts.push(p.label + " " + r.value + unitText(p.unit));
        if (r.flag === "low" || r.flag === "high") worst = "abnormal"; else if (r.flag === "normal" && worst === "none") worst = "normal";
      }
      if (!given) return fail("Enter at least one result.");
      out.values = vals; out.value = parts.join("; "); out.flag = worst;
    } else if (type === "organism") {
      var codes = parseList(prof.resultCodes);
      if (input.noGrowth) { out.value = "No growth"; out.values = { noGrowth: true, organisms: [] }; }
      else {
        var orgs = (input.organisms || []).filter(function (o) { return str(o.name); });
        if (!orgs.length) return fail("Add at least one organism, or tick No growth.");
        var res = [], lines = [];
        for (var j = 0; j < orgs.length; j++) {
          var og = orgs[j], sus = {}, keys = Object.keys(og.susceptibility || {});
          for (var k = 0; k < keys.length; k++) {
            var code = str(og.susceptibility[keys[k]]); if (!code) continue;
            if (codes.indexOf(code) < 0) return fail("\"" + code + "\" is not one of the result codes set up for this test.");
            sus[keys[k]] = code;
          }
          res.push({ name: str(og.name), quantity: str(og.quantity), susceptibility: sus, comment: str(og.comment) });
          lines.push(str(og.name) + (Object.keys(sus).length ? " (" + Object.keys(sus).map(function (a) { return a + " " + sus[a]; }).join(", ") + ")" : ""));
        }
        out.values = { noGrowth: false, organisms: res }; out.value = lines.join("; ");
      }
      if (input.flag) out.flag = input.flag;
    } else return fail("This test has a result type this version does not know.");
    // parameters of a multi test may also carry critical limits
    if (type === "multi") {
      (prof.params || []).forEach(function (p) {
        var r = out.values[p.key]; if (!r || r.value == null) return;
        if (p.critical && (p.type === "number" ? critNumber(r.value, p.critical) : critValue(r.value, p.critical))) { out.critical = true; out.criticalWhy.push(p.label + " " + r.value + " is at or beyond the critical limit set by this facility."); }
      });
    }
    out.ok = true; return out;
  }
  function describeResult(r) {
    if (!r) return "";
    return String(r.value) + (r.unit ? " " + r.unit : "");
  }

  // ---------------------------------------------------------------- specimen and result workflow
  /* requested -> collected -> received -> accepted | rejected -> processing -> resulted -> verified -> reviewed.
     "collected -> processing" is kept for older orders and small facilities that do not log receipt (the rules still allow it). */
  var STATUS_LABEL = { requested: "Requested", collected: "Specimen collected", received: "Received by laboratory", accepted: "Specimen accepted", rejected: "Specimen rejected", processing: "Processing", resulted: "Result entered (not verified)", verified: "Verified", reviewed: "Reviewed by doctor", cancelled: "Cancelled" };
  var STEPS = ["requested", "collected", "received", "accepted", "processing", "resulted", "verified", "reviewed"];
  var NEXT = { requested: ["collected", "cancelled"], collected: ["received", "processing", "cancelled"], received: ["accepted", "rejected", "cancelled"], accepted: ["processing", "cancelled"], processing: ["resulted", "cancelled"], resulted: ["verified", "resulted"], verified: ["reviewed", "resulted"], reviewed: ["resulted"], rejected: [], cancelled: [] };
  function canMove(from, to) { return (NEXT[from] || []).indexOf(to) >= 0; }
  var REJECT_REASONS = ["Haemolysed", "Insufficient volume", "Wrong container or additive", "Not labelled", "Labelled incorrectly", "Clotted", "Delayed arrival", "Contaminated", "Leaking or damaged container", "Other (explain)"];
  var OPEN_STATES = ["requested", "collected", "received", "accepted", "processing", "resulted"];

  // ---------------------------------------------------------------- bills (money) for laboratory tests
  var PAY_LABEL = { paid: "Paid", part_paid: "Part paid (rest on credit)", credit: "Not paid (on credit)", waived: "No charge (authorised)", no_charge: "No price set" };
  function r2(n) { return Math.round(Number(n) * 100) / 100; }
  function bill(o) {
    var price = Math.max(0, num(o.price) || 0), paid = Math.min(price, Math.max(0, r2(num(o.amountPaid) || 0)));
    if (o.waived) return { price: price, paid: 0, outstanding: 0, waived: price, status: "waived" };
    var out = r2(price - paid);
    return { price: price, paid: paid, outstanding: out, waived: 0, status: price <= 0 ? "no_charge" : out <= 0 ? "paid" : paid > 0 ? "part_paid" : "credit" };
  }

  // ---------------------------------------------------------------- main ledger (v19, owner decision 2026-11-20)
  /* Cash Position and the Sales reports read the `sales` collection. Laboratory money was only in pc_lab_bills, so the cash drawer could not reconcile.
     These rows mirror what the pharmacy writes: one `sales` row per part (PAID / CREDIT), no stock effect (baseQtyDeducted 0, costOfGoods 0), class "Laboratory".
     Document ids are fixed (labsl_{orderId}_p|_c, labrvsl_{orderId}_p|_c), so a retry or a second phone cannot post them twice. No `receipts` are written on purpose
     (the Returns/Exchange screens work from receipts and would try to restock a medicine that does not exist). createdAt is added by the caller (server time). */
  function saleRow(o, ctx, id, amount, status, note) {
    var key = o.investigationId || o.id;
    var d = { businessId: ctx.businessId, shopId: ctx.shopId, ownerUid: ctx.uid, drugId: "lab_" + key, drugName: o.name || o.testName || "Laboratory test", drugClass: "Laboratory",
      unitLevel: "base", qty: amount < 0 ? -1 : 1, baseQtyDeducted: 0, pricePerUnit: Math.abs(amount), total: amount, costOfGoods: 0, receiptId: null, cashier: ctx.userName || "",
      paymentStatus: status, customerId: status === "CREDIT" ? (ctx.customerId || null) : null, source: "laboratory", labOrderId: o.id };
    if (note) d.note = note;
    return { id: id, data: d };
  }
  function ledgerRows(o, bl, ctx) {
    var rows = [];
    if (bl.paid > 0) rows.push(saleRow(o, ctx, "labsl_" + o.id + "_p", r2(bl.paid), "PAID"));
    if (bl.outstanding > 0) rows.push(saleRow(o, ctx, "labsl_" + o.id + "_c", r2(bl.outstanding), "CREDIT"));
    return rows;
  }
  /* bill: the saved pc_lab_bills document. Returns the negative rows and the cash to hand back (the paid part: the bill was paid, so the drawer must be reduced). */
  function reversalRows(o, bill, ctx, reason) {
    var rows = [], note = "Laboratory bill reversed: " + (reason || "");
    var paid = r2(num(bill.amountPaid) || 0), out = r2(num(bill.amountOutstanding) || 0);
    if (paid > 0) rows.push(saleRow(o, ctx, "labrvsl_" + o.id + "_p", -paid, "PAID", note));
    if (out > 0) rows.push(saleRow(o, Object.assign({}, ctx, { customerId: bill.customerId }), "labrvsl_" + o.id + "_c", -out, "CREDIT", note));
    return { rows: rows, cashToReturn: paid };
  }

  // ---------------------------------------------------------------- reports
  function dayOf(ms) { var d = new Date(ms || 0); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function ms(ts) { return ts && ts.toDate ? ts.toDate().getTime() : (ts && ts.seconds ? ts.seconds * 1000 : (typeof ts === "number" ? ts : 0)); }
  /* orders, results, bills: arrays of documents. range: {from:"YYYY-MM-DD", to:"YYYY-MM-DD"} by the day the test was requested. */
  function report(orders, results, bills, range) {
    var inR = function (o) { var d = o.requestedDay || dayOf(o.requestedAt); return (!range || !range.from || d >= range.from) && (!range || !range.to || d <= range.to); };
    var os = orders.filter(inR), by = {}, i;
    os.forEach(function (o) { (by[o.status] = by[o.status] || []).push(o); });
    var ids = {}; os.forEach(function (o) { ids[o.id] = 1; });
    var billMap = {}; (bills || []).forEach(function (b) { billMap[b.orderId || b.id] = b; });
    var rs = (results || []).filter(function (r) { return ids[r.orderId]; });
    var corrected = rs.filter(function (r) { return r.amends; });
    var volume = {}; os.forEach(function (o) { if (o.status !== "cancelled") volume[o.name] = (volume[o.name] || 0) + 1; });
    var rev = { billed: 0, collected: 0, outstanding: 0, waived: 0, billedCount: 0, notBilled: 0, notBilledValue: 0 };
    os.forEach(function (o) {
      if (o.status === "cancelled" || o.status === "rejected") return;
      var b = billMap[o.id];
      if (b && b.status !== "reversed") { rev.billed += num(b.price) || 0; rev.collected += num(b.amountPaid) || 0; rev.outstanding += num(b.amountOutstanding) || 0; rev.waived += num(b.amountWaived) || 0; rev.billedCount++; }
      else { rev.notBilled++; rev.notBilledValue += num(o.price) || 0; }
    });
    ["billed", "collected", "outstanding", "waived", "notBilledValue"].forEach(function (k) { rev[k] = r2(rev[k]); });
    var turn = os.filter(function (o) { return ms(o.verifiedAt) && o.requestedAt; }).map(function (o) { return ms(o.verifiedAt) - o.requestedAt; });
    return {
      total: os.length,
      pending: os.filter(function (o) { return o.status === "requested"; }),
      uncollectedOrNotReceived: os.filter(function (o) { return o.status === "requested" || o.status === "collected"; }),
      processing: os.filter(function (o) { return o.status === "received" || o.status === "accepted" || o.status === "processing"; }),
      awaitingVerification: os.filter(function (o) { return o.status === "resulted"; }),
      verified: os.filter(function (o) { return o.status === "verified" || o.status === "reviewed"; }),
      rejected: os.filter(function (o) { return o.status === "rejected"; }),
      cancelled: os.filter(function (o) { return o.status === "cancelled"; }),
      correctedResults: corrected,
      volume: Object.keys(volume).map(function (k) { return { name: k, count: volume[k] }; }).sort(function (a, b) { return b.count - a.count; }),
      revenue: rev,
      averageTurnaroundMinutes: turn.length ? Math.round(turn.reduce(function (a, b) { return a + b; }, 0) / turn.length / 60000) : null,
      byStatus: Object.keys(by).reduce(function (m, k) { m[k] = by[k].length; return m; }, {})
    };
  }

  // ---------------------------------------------------------------- starter structures (NO ranges, units, prices, limits, scales or meanings are supplied)
  var TEMPLATES = [
    { id: "t_rdt", name: "Malaria rapid test", category: "malaria", specimen: "Blood", resultType: "qualitative", choices: ["Positive", "Negative", "Invalid"], note: "Confirm these words match your kit's instructions." },
    { id: "t_preg", name: "Pregnancy test", category: "pregnancy", specimen: "Urine", resultType: "qualitative", choices: ["Positive", "Negative", "Invalid"], note: "Confirm these words match your kit's instructions." },
    { id: "t_hiv", name: "HIV rapid test", category: "other", specimen: "Blood", resultType: "qualitative", choices: ["Reactive", "Non-reactive", "Invalid"], note: "Use the terms and algorithm of your approved procedure." },
    { id: "t_abo", name: "Blood group", category: "haematology", specimen: "Blood", resultType: "multi", params: [{ label: "ABO group", type: "categorical", choices: ["A", "B", "AB", "O"] }, { label: "Rhesus", type: "categorical", choices: ["Positive", "Negative"] }] },
    { id: "t_urine", name: "Urinalysis dipstick", category: "urinalysis", specimen: "Urine", resultType: "multi", params: [{ label: "Protein", type: "semiquant", scale: [] }, { label: "Glucose", type: "semiquant", scale: [] }, { label: "Ketones", type: "semiquant", scale: [] }, { label: "Blood", type: "semiquant", scale: [] }, { label: "Leucocytes", type: "semiquant", scale: [] }, { label: "Nitrite", type: "qualitative", choices: [] }], note: "The scale terms are left empty on purpose: type the terms your procedure uses (for example Trace, 1+ ... or your local abbreviations)." },
    { id: "t_fbc", name: "Full blood count", category: "haematology", specimen: "Whole blood (EDTA)", resultType: "multi", params: [{ label: "Haemoglobin", type: "number" }, { label: "White cell count", type: "number" }, { label: "Platelets", type: "number" }], note: "Add the units and reference ranges from your analyser or reference, with their source." },
    { id: "t_titer", name: "Widal test", category: "other", specimen: "Serum", resultType: "titer", titerMode: "numeric" },
    { id: "t_cs", name: "Culture and sensitivity", category: "microbiology", specimen: "", resultType: "organism", antibiotics: [], resultCodes: [], note: "Add the antibiotics you test and the result codes your laboratory reports." },
    { id: "t_glu", name: "Blood glucose", category: "biochemistry", specimen: "Blood", resultType: "number", note: "Add the unit and, if you use one, a reference range with its source." },
    { id: "t_stool", name: "Stool microscopy", category: "stool", specimen: "Stool", resultType: "text" }
  ];

  var api = { TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, PARAM_TYPES: PARAM_TYPES, normType: normType, parseList: parseList, scaleTerms: scaleTerms, validateTest: validateTest, validateParam: validateParam, validateCritical: validateCritical,
    profileOf: profileOf, orderFields: orderFields, profileFromOrder: profileFromOrder, buildResult: buildResult, describeResult: describeResult, flagNumber: flagNumber,
    STATUS_LABEL: STATUS_LABEL, STEPS: STEPS, NEXT: NEXT, canMove: canMove, REJECT_REASONS: REJECT_REASONS, OPEN_STATES: OPEN_STATES, PAY_LABEL: PAY_LABEL, bill: bill, ledgerRows: ledgerRows, reversalRows: reversalRows, report: report, dayOf: dayOf, TEMPLATES: TEMPLATES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCL = api;
})(typeof window !== "undefined" ? window : this);
