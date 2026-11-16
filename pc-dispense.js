/* MediStock Cloud — Phase 5 dispensing engine (Developer 1).
   Pure helpers (no database access) plus ONE transaction function that receives the Firebase tools as an argument,
   so the same code runs in the pharmacy screen and in the Node tests.

   What it does:
   - picks stock batches first-expiry-first-out (the same expiry rules as sales.html: no expiry date = never expires, sorted last)
   - refuses expired stock, negative stock, over-dispensing and repeated submissions
   - writes batch + medicine stock, stock movement, dispensing record, prescription and audit record in ONE transaction
   - keeps a phone-side queue for dispensing started offline (a queued item is NOT a confirmed stock deduction)
   It never writes to pc_treatment_events or pc_mar_records: dispensing is not administration.

   Collections written (names fixed by the team Data Contract): prescriptions, dispense_records.
   Existing collections touched with their EXISTING shape only: drugs.currentStockBase, batches.quantity, stock_transactions, pc_audit_logs. */
(function (root) {
  var SCHEMA = 1;

  // ---------------------------------------------------------------- errors
  function PCDError(code, message, extra) { var e = new Error(message); e.name = "PCDError"; e.pcd = true; e.code = code; if (extra) e.extra = extra; return e; }

  var FRIENDLY = {
    order_missing: "This prescription could not be found.",
    order_inactive: "This prescription has been stopped or replaced, so it cannot be dispensed.",
    not_medicine: "Only medicine orders can be dispensed.",
    wrong_facility: "This prescription belongs to another facility.",
    already_complete: "This prescription has already been dispensed.",
    over_outstanding: "The quantity is more than what is still outstanding on this prescription.",
    bad_quantity: "Enter a quantity greater than zero.",
    no_quantity: "The prescriber did not state a quantity. Enter the quantity to supply.",
    no_drug: "Choose the medicine from your stock list before dispensing.",
    drug_missing: "This medicine is not in your stock list.",
    drug_mismatch: "This is not the medicine that was prescribed (or already dispensed). To give a different one, record a substitution with a reason.",
    sub_reason: "A substitution needs a reason and the name of the person who agreed to it (for example the prescriber).",
    sub_after_dispense: "Medicine was already dispensed on this prescription. Reverse the unused quantity first, then substitute.",
    stock_short: "This medicine is not available in the selected stock.",
    stock_inconsistent: "The stock record for this medicine does not add up. Check Batches and Inventory, then try again.",
    batch_invalid: "The selected batch cannot be used (not found, wrong medicine, empty or expired).",
    batch_expired: "That batch has expired and cannot be dispensed.",
    manual_sum: "The batch quantities you chose do not add up to the quantity being dispensed.",
    unbatched_blocked: "This medicine has no batch record. Confirm that you are dispensing stock without a batch record.",
    not_confirmed: "Confirm the patient and the medicine before dispensing.",
    no_request_id: "This request has no reference number. Please try again."
  };

  function isOfflineError(err) {
    if (!err) return false;
    var m = String(err.message || "");
    return err.code === "unavailable" || /offline|network|failed to fetch|timed out|deadline/i.test(m) || err.code === "deadline-exceeded";
  }

  // short reference code for a denied step, safe to show to anyone ("read dispense_records" -> "read-dispense_records")
  function stepRef(step) { return String(step || "").replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
  // For the owner / support only: which operation was refused
  function technicalDetail(err) {
    if (!err) return "";
    var bits = [];
    if (err.code) bits.push("code: " + err.code);
    if (err.pcdStep) bits.push("step: " + err.pcdStep);
    return bits.join(" · ");
  }

  // plain-language message for any error, including Firebase ones
  function friendlyError(err) {
    if (!err) return "Something went wrong. Please try again.";
    if (err.pcd) return FRIENDLY[err.code] ? (err.code === "stock_short" && err.extra && err.extra.available != null ? FRIENDLY[err.code] + " Available: " + err.extra.available + "." : FRIENDLY[err.code]) : err.message;
    if (err.code === "permission-denied") return "You do not have permission to perform this action." + (err.pcdStep ? " (Ref: " + stepRef(err.pcdStep) + ")" : "");
    if (isOfflineError(err)) return "There is no internet connection, so this could not be confirmed with the server.";
    if (err.code === "aborted" || err.code === "failed-precondition" || /retries|contention/i.test(String(err.message || ""))) return "Stock was changing on another device. Please try again.";
    if (err.code === "invalid-argument") return "Some of the information entered is not valid. Check it and try again.";
    return "This could not be saved. Check your internet connection and try again.";
  }

  // ---------------------------------------------------------------- numbers and dates
  function r4(n) { return Math.round(Number(n) * 10000) / 10000; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function startOfDay(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }

  // SAME rules as sales.html: a batch with no (or unreadable) expiry date never expires and sorts after every dated batch.
  function daysUntil(dateStr, asOf) {
    if (!dateStr) return 36500;
    var today = startOfDay(asOf || new Date());
    var target = new Date(dateStr);
    if (isNaN(target)) return 36500;
    return Math.round((target - today) / 86400000);
  }
  function expiryMs(dateStr) { return dateStr && !isNaN(new Date(dateStr)) ? new Date(dateStr).getTime() : 8.64e15; }
  function isExpired(b, asOf) { return daysUntil(b.expiryDate, asOf) < 0; }
  function sellable(b, asOf) { return num(b.quantity) > 0 && !isExpired(b, asOf); }

  function fefoSort(batches) {
    return batches.slice().sort(function (a, b) {
      var d = expiryMs(a.expiryDate) - expiryMs(b.expiryDate);
      if (d !== 0) return d;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    });
  }

  // ---------------------------------------------------------------- stock plans
  function summarise(batches, asOf) {
    var total = 0, expired = 0, usable = 0;
    batches.forEach(function (b) {
      var q = Math.max(0, num(b.quantity)); total += q;
      if (q > 0 && isExpired(b, asOf)) expired += q; else usable += q;
    });
    return { total: r4(total), expired: r4(expired), usable: r4(usable) };
  }

  // automatic first-expiry-first-out plan. Never uses expired or empty batches.
  function planFefo(batches, qty, asOf) {
    var need = r4(qty), out = [], list = fefoSort(batches.filter(function (b) { return sellable(b, asOf); }));
    for (var i = 0; i < list.length && need > 0; i++) {
      var take = Math.min(need, num(list[i].quantity));
      if (take <= 0) continue;
      out.push({ batchId: list[i].id, batchNumber: list[i].batchNumber || "", expiryDate: list[i].expiryDate || "", qty: r4(take) });
      need = r4(need - take);
    }
    return { allocations: out, short: r4(Math.max(0, need)) };
  }

  // the pharmacist chose the batches: picks = [{ batchId, qty }]
  function planManual(batches, picks, qty, asOf) {
    var byId = {}; batches.forEach(function (b) { byId[b.id] = b; });
    var out = [], sum = 0, seen = {};
    for (var i = 0; i < (picks || []).length; i++) {
      var p = picks[i], q = r4(p.qty);
      if (!(q > 0)) continue;
      var b = byId[p.batchId];
      if (!b || seen[p.batchId]) throw PCDError("batch_invalid", FRIENDLY.batch_invalid);
      seen[p.batchId] = 1;
      if (isExpired(b, asOf)) throw PCDError("batch_expired", FRIENDLY.batch_expired);
      if (q > num(b.quantity)) throw PCDError("stock_short", FRIENDLY.stock_short, { available: r4(num(b.quantity)) });
      out.push({ batchId: b.id, batchNumber: b.batchNumber || "", expiryDate: b.expiryDate || "", qty: q });
      sum = r4(sum + q);
    }
    if (Math.abs(sum - r4(qty)) > 1e-9) throw PCDError("manual_sum", FRIENDLY.manual_sum);
    return { allocations: out, short: 0 };
  }

  // ---------------------------------------------------------------- prescription state
  function statusFor(prescribed, dispensed) {
    prescribed = num(prescribed); dispensed = num(dispensed);
    if (dispensed <= 0) return "pending";
    return dispensed + 1e-9 >= prescribed ? "completed" : "partially_dispensed";
  }
  function doseText(order) {
    var d = order.doseValue; if (d == null || d === "") return "";
    return d + (order.doseUnit ? " " + order.doseUnit : "");
  }
  // quantity state of one queue row. rx = prescriptions doc or null; order = pc_treatment_orders doc
  function qtyState(order, rx) {
    if (rx) return { prescribed: num(rx.qtyPrescribed), dispensed: num(rx.qtyDispensed), outstanding: r4(Math.max(0, num(rx.qtyPrescribed) - num(rx.qtyDispensed))), known: true, setBy: rx.qtySetBy || "prescriber" };
    var q = order && order.quantityPrescribed;
    if (q == null || q === "" || !(Number(q) > 0)) return { prescribed: 0, dispensed: 0, outstanding: 0, known: false, setBy: null };
    return { prescribed: Number(q), dispensed: 0, outstanding: Number(q), known: true, setBy: "prescriber" };
  }
  // what the queue shows. filters: waiting, partial, done, stopped
  function queueGroup(order, rx) {
    var active = order && order.status === "active";
    if (!active) return rx && rx.status === "completed" ? "done" : "stopped";
    if (rx && rx.status === "completed") return "done";
    if (rx && num(rx.qtyDispensed) > 0) return "partial";
    return "waiting";
  }

  // ---------------------------------------------------------------- ids
  function newRequestId() {
    var c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID().replace(/-/g, "");
    var s = ""; for (var i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s + Date.now().toString(16);
  }
  function lineId(requestId, i) { return requestId + "_" + i; }
  function localDay(asOf) { var d = asOf || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function clean(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k] === undefined ? null : o[k]; }); return r; }

  // ---------------------------------------------------------------- THE TRANSACTION
  /* tools: { db, doc, collection, runTransaction, serverTimestamp }  (the same Firebase wrappers every screen already gets from MC.api)
     p: { businessId, facilityId, uid, userName, orderId, drugId, qty, requestId,
          mode: "fefo"|"manual", picks, allowUnbatched, qtyPrescribedOverride, candidateBatchIds, asOf (Date), clientAt (ms),
          source: "online"|"offline_replay", patientConfirmed, medicineConfirmed, localDay }
   Returns { duplicate, lines[], rx{...}, stockTxnIds[] }. Throws PCDError for any business-rule failure. */
  async function runDispense(tools, p) {
    var doc = tools.doc, db = tools.db;
    if (!p.requestId) throw PCDError("no_request_id", FRIENDLY.no_request_id);
    if (!p.patientConfirmed || !p.medicineConfirmed) throw PCDError("not_confirmed", FRIENDLY.not_confirmed);
    var qty = r4(p.qty);
    if (!(qty > 0)) throw PCDError("bad_quantity", FRIENDLY.bad_quantity);
    if (!p.drugId) throw PCDError("no_drug", FRIENDLY.no_drug);
    var asOf = p.asOf || new Date();
    var ids = (p.candidateBatchIds || []).slice();
    var orderRef = doc(db, "pc_treatment_orders", p.orderId);
    var rxRef = doc(db, "prescriptions", p.orderId);
    var drugRef = doc(db, "drugs", p.drugId);
    var firstRecRef = doc(db, "dispense_records", lineId(p.requestId, 0));

    var label = function (step, promise) { return promise.catch(function (e) { if (e && !e.pcdStep && !e.pcd) e.pcdStep = step; throw e; }); };
    var run;
    try {
    run = await tools.runTransaction(db, async function (tx) {
      // ---- all reads first (each one is labelled so a refusal says exactly which document was denied)
      var firstRec = await label("read dispense_records (duplicate check)", tx.get(firstRecRef));
      if (firstRec.exists()) {
        var fr = firstRec.data();
        return { duplicate: true, rxId: p.orderId, group: p.requestId, qty: fr.groupQty != null ? fr.groupQty : fr.qtyDispensed };
      }
      var orderSnap = await label("read pc_treatment_orders", tx.get(orderRef)), rxSnap = await label("read prescriptions", tx.get(rxRef)), drugSnap = await label("read drugs", tx.get(drugRef));
      var batchSnaps = [];
      for (var i = 0; i < ids.length; i++) batchSnaps.push(await label("read batches", tx.get(doc(db, "batches", ids[i]))));
      // optional extension (payment / credit): its reads must also happen before any write
      var hookState = p.hook && p.hook.read ? await p.hook.read(tx, label) : null;

      // ---- the prescription
      if (!orderSnap.exists()) throw PCDError("order_missing", FRIENDLY.order_missing);
      var order = orderSnap.data();
      if (order.businessId !== p.businessId || order.facilityId !== p.facilityId) throw PCDError("wrong_facility", FRIENDLY.wrong_facility);
      if (order.kind !== "medicine") throw PCDError("not_medicine", FRIENDLY.not_medicine);
      var rx = rxSnap.exists() ? rxSnap.data() : null;
      if (order.status !== "active") throw PCDError("order_inactive", FRIENDLY.order_inactive);
      if (rx && (rx.businessId !== p.businessId || rx.facilityId !== p.facilityId)) throw PCDError("wrong_facility", FRIENDLY.wrong_facility);

      // ---- the medicine: must be the actual catalogue record
      if (!drugSnap.exists()) throw PCDError("drug_missing", FRIENDLY.drug_missing);
      var drug = drugSnap.data();
      if (drug.businessId !== p.businessId || drug.shopId !== p.facilityId) throw PCDError("drug_missing", FRIENDLY.drug_missing);
      // v17 substitution: a different stock item than the one prescribed, only with a reason and an authoriser, and only while
      // nothing is dispensed on this prescription (anything already dispensed must be reversed first)
      var subst = null;
      var alreadyForSub = rx ? num(rx.qtyDispensed) : 0;
      var drugChanged = (order.medicineId && order.medicineId !== p.drugId) || (rx && rx.drugId && rx.drugId !== p.drugId);
      if (drugChanged) {
        if (!p.substitution) throw PCDError("drug_mismatch", FRIENDLY.drug_mismatch);
        if (alreadyForSub > 0) throw PCDError("sub_after_dispense", FRIENDLY.sub_after_dispense);
        var sr = String(p.substitution.reason || "").trim(), sa = String(p.substitution.authorisedBy || "").trim();
        if (sr.length < 3 || sa.length < 2) throw PCDError("sub_reason", FRIENDLY.sub_reason);
        subst = { reason: sr, authorisedBy: sa };
      }

      // ---- quantities (all in the medicine's smallest unit, e.g. tablets)
      var prescribed, qtySetBy;
      if (rx) { prescribed = num(rx.qtyPrescribed); qtySetBy = rx.qtySetBy || "prescriber"; }
      else if (order.quantityPrescribed != null && Number(order.quantityPrescribed) > 0) { prescribed = Number(order.quantityPrescribed); qtySetBy = "prescriber"; }
      else if (p.qtyPrescribedOverride != null && Number(p.qtyPrescribedOverride) > 0) { prescribed = Number(p.qtyPrescribedOverride); qtySetBy = "pharmacist"; }
      else throw PCDError("no_quantity", FRIENDLY.no_quantity);
      var already = rx ? num(rx.qtyDispensed) : 0;
      var outstanding = r4(prescribed - already);
      if (outstanding <= 0) throw PCDError("already_complete", FRIENDLY.already_complete);
      if (qty > outstanding + 1e-9) throw PCDError("over_outstanding", FRIENDLY.over_outstanding, { outstanding: outstanding });

      // ---- stock, from fresh reads only
      var batches = [];
      batchSnaps.forEach(function (s) {
        if (!s.exists()) return;
        var b = s.data(); b.id = s.id;
        if (b.businessId === p.businessId && b.shopId === p.facilityId && b.drugId === p.drugId) batches.push(b);
      });
      var drugTotal = num(drug.currentStockBase);
      var plan;
      if (batches.length === 0) {
        // the medicine has no batch record at all (stock imported or counted without batches)
        if (!p.allowUnbatched) throw PCDError("unbatched_blocked", FRIENDLY.unbatched_blocked);
        if (drugTotal + 1e-9 < qty) throw PCDError("stock_short", FRIENDLY.stock_short, { available: r4(Math.max(0, drugTotal)) });
        plan = { allocations: [{ batchId: null, batchNumber: "", expiryDate: "", qty: qty }], short: 0 };
      } else {
        plan = p.mode === "manual" ? planManual(batches, p.picks, qty, asOf) : planFefo(batches, qty, asOf);
        if (plan.short > 0) throw PCDError("stock_short", FRIENDLY.stock_short, { available: r4(qty - plan.short) });
        if (drugTotal + 1e-9 < qty) throw PCDError("stock_inconsistent", FRIENDLY.stock_inconsistent);
      }

      // ---- all writes (one atomic commit)
      var newDispensed = r4(already + qty), newOutstanding = r4(Math.max(0, prescribed - newDispensed));
      var status = statusFor(prescribed, newDispensed);
      var month = (p.localDay || localDay(asOf)).slice(0, 7), day = p.localDay || localDay(asOf);
      var unit = drug.baseUnit || "";
      var stamp = { businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: tools.serverTimestamp(), clientCreatedAt: p.clientAt || Date.now() };
      var byId = {}; batches.forEach(function (b) { byId[b.id] = b; });
      var txnIds = [];

      plan.allocations.forEach(function (a, i) {
        var id = lineId(p.requestId, i);
        if (a.batchId) tx.update(doc(db, "batches", a.batchId), { quantity: r4(num(byId[a.batchId].quantity) - a.qty) });
        var tId = "dsp_" + id; txnIds.push(tId);
        tx.set(doc(db, "stock_transactions", tId), clean({
          businessId: p.businessId, shopId: p.facilityId, drugId: p.drugId, drugName: drug.name, type: "DISPENSE", baseUnitsChange: -a.qty,
          note: "Dispensed to patient — prescription " + p.orderId + (a.batchNumber ? " (batch " + a.batchNumber + ")" : " (no batch record)"),
          batchId: a.batchId, cashier: p.userName || "", createdAt: tools.serverTimestamp(), prescriptionId: p.orderId, dispenseRequestId: p.requestId
        }));
        tx.set(doc(db, "dispense_records", id), clean(Object.assign({}, stamp, {
          id: id, prescriptionId: p.orderId, patientId: order.patientId, drugId: p.drugId, batchId: a.batchId,
          qtyDispensed: a.qty, dispensedBy: p.uid, dispensedAt: tools.serverTimestamp(), isSynced: true,
          // extra fields (additive to the contract)
          requestId: p.requestId, lineNo: i, lines: plan.allocations.length, groupQty: qty, batchNumber: a.batchNumber, expiryDate: a.expiryDate,
          drugName: drug.name, qtyUnit: unit, patientName: order.patientName, encounterId: order.encounterId, dispensedByName: p.userName || "",
          dispensedDay: day, dispensedMonth: month, stockTxnId: tId, source: p.source || "online", batchMode: p.mode === "manual" ? "manual" : "fefo",
          clientDispensedAt: p.clientAt || Date.now()
        })));
      });
      tx.update(drugRef, { currentStockBase: r4(drugTotal - qty) });
      // cost of the stock issued (same costing as sales.html: batch cost, else the drug's wholesale price when there is no batch record)
      var per = num(drug.baseUnitsPerStock) || 1, cogs = 0;
      plan.allocations.forEach(function (a) {
        var b = a.batchId ? byId[a.batchId] : null;
        var c = b ? num(b.purchasePricePerStockUnit || b.costPerStockUnit) : num(drug.wholesale);
        cogs += (a.qty / per) * c;
      });
      cogs = Math.round(cogs * 100) / 100;
      if (p.handedOver) {
        tx.set(doc(db, "dispense_handovers", p.requestId), clean(Object.assign({}, stamp, {
          id: p.requestId, requestId: p.requestId, prescriptionId: p.orderId, patientId: order.patientId, handedOverBy: p.uid, handedOverByName: p.userName || "",
          handedOverAt: tools.serverTimestamp(), note: "handed over when dispensed"
        })));
      }
      if (p.hook && p.hook.write) p.hook.write(tx, hookState, { order: order, drug: drug, plan: plan, qty: qty, stamp: stamp, costOfGoods: cogs, requestId: p.requestId, orderId: p.orderId, unit: unit });

      var rxBase = {
        qtyDispensed: newDispensed, qtyOutstanding: newOutstanding, status: status, lastDispensedAt: tools.serverTimestamp(), lastDispensedBy: p.uid, lastRequestId: p.requestId,
        updatedBy: p.uid, updatedAt: tools.serverTimestamp()
      };
      if (subst) Object.assign(rxBase, { drugId: p.drugId, drugName: drug.name, substitutedForId: order.medicineId || (rx && rx.drugId) || null, substitutedForName: order.medicineName || (rx && rx.drugName) || null,
        substitutionReason: subst.reason, substitutionAuthorisedBy: subst.authorisedBy, substitutedBy: p.uid });
      if (rx) tx.update(rxRef, rxBase);
      else tx.set(rxRef, clean(Object.assign({}, stamp, rxBase, {
        id: p.orderId, orderId: p.orderId, patientId: order.patientId, patientName: order.patientName, encounterId: order.encounterId, encounterNo: order.encounterNo, planId: order.planId,
        drugId: p.drugId, drugName: drug.name, prescribedName: order.medicineName, formulation: order.formulation, strength: order.strength, route: order.route,
        dose: doseText(order), instructions: order.instructions, prescriberId: order.prescriberId, prescriberName: order.prescriberName, prescribedAt: order.prescribedAt,
        qtyPrescribed: prescribed, qtyUnit: unit, qtySetBy: qtySetBy, drugLinkedBy: order.medicineId ? "prescriber" : "pharmacist",
        orderVersion: order.version || 1, supersedes: order.supersedes || null, firstDispensedAt: tools.serverTimestamp(), qtyReturned: 0
      })));
      tx.set(doc(db, "pc_audit_logs", "dispense_" + p.requestId), clean({
        businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: tools.serverTimestamp(), clientCreatedAt: p.clientAt || Date.now(),
        actorUid: p.uid, actorName: p.userName || "", action: subst ? "dispense.substitute" : "dispense.confirm", substitution: subst ? { reason: subst.reason, authorisedBy: subst.authorisedBy, prescribed: order.medicineName || null } : null, handedOver: !!p.handedOver, recordPath: "prescriptions/" + p.orderId, patientId: order.patientId, encounterId: order.encounterId || null,
        orderId: p.orderId, qty: qty, qtyOutstandingAfter: newOutstanding, drugId: p.drugId, batches: plan.allocations.map(function (a) { return a.batchNumber || "(none)"; }), source: p.source || "online", at: tools.serverTimestamp()
      }));

      return { duplicate: false, rxId: p.orderId, group: p.requestId, qty: qty, lines: plan.allocations, status: status, outstanding: newOutstanding, stockTxnIds: txnIds };
    });
    } catch (e) {
      // a refusal with no read label happened when the records were written together (one of the writes was refused)
      if (e && e.code === "permission-denied" && !e.pcdStep) e.pcdStep = "commit (writing stock, record, prescription or audit entry)";
      throw e;
    }
    return run;
  }

  /* Read-only access check (writes nothing). Tells the person which parts of the pharmacy they can and cannot reach.
     ctx: { uid, businessId, facilityId, role, perms, facility }.  Returns [{ name, ok, detail }]. */
  async function diagnose(tools, ctx) {
    var out = [], db = tools.db;
    function add(name, ok, detail) { out.push({ name: name, ok: ok, detail: detail || "" }); }
    var perms = ctx.perms || {}, owner = ctx.role === "owner";
    add("Your role", true, owner ? "Owner" : (ctx.role || "unknown"));
    ["dispense.view", "dispense.perform", "dispense.report"].forEach(function (k) { add("Permission " + k, owner || perms[k] === true, owner ? "owner has every permission" : (perms[k] === true ? "granted" : "not granted on your account")); });
    var fac = ctx.facility || null;
    add("Shop belongs to your business", !!fac && fac.businessId === ctx.businessId, fac ? "" : "shop record not loaded");
    add("Patient Care switched on for this shop", !!fac && Array.isArray(fac.enabledServices) && fac.enabledServices.indexOf("patient_care") >= 0, "");
    async function probe(name, fn, expectMissing) {
      try { var r = await fn(); add(name, true, expectMissing ? (r && r.exists && r.exists() ? "found" : "not there yet (normal)") : "allowed"); }
      catch (e) { add(name, false, e && e.code === "permission-denied" ? "blocked by the security rules" : PCDErrorText(e)); }
    }
    function PCDErrorText(e) { return isOfflineError(e) ? "no internet" : String((e && (e.code || e.message)) || e); }
    var q = tools.query, where = tools.where, lim = tools.limit, getDocs = tools.getDocs, getDoc = tools.getDoc;
    if (getDoc) {
      await probe("Read your account", function () { return getDoc(tools.doc(db, "users", ctx.uid)); });
      await probe("Look for a dispensing record that does not exist yet", function () { return getDoc(tools.doc(db, "dispense_records", "diag_" + ctx.uid + "_0")); }, true);
      await probe("Look for a prescription that does not exist yet", function () { return getDoc(tools.doc(db, "prescriptions", "diag_" + ctx.uid)); }, true);
    }
    if (q && getDocs) {
      var base = function (c, f) { return q(tools.collection(db, c), where("businessId", "==", ctx.businessId), where(f, "==", ctx.facilityId), lim(1)); };
      await probe("Read medicine orders", function () { return getDocs(q(tools.collection(db, "pc_treatment_orders"), where("businessId", "==", ctx.businessId), where("facilityId", "==", ctx.facilityId), where("kind", "==", "medicine"), where("status", "==", "active"), lim(1))); });
      await probe("Read prescriptions", function () { return getDocs(base("prescriptions", "facilityId")); });
      await probe("Read dispensing records", function () { return getDocs(base("dispense_records", "facilityId")); });
      await probe("Read medicines and batches", function () { return getDocs(base("drugs", "shopId")).then(function () { return getDocs(base("batches", "shopId")); }); });
    }
    return out;
  }

  // ---------------------------------------------------------------- phone-side queue for dispensing started offline
  // A queued item is a REQUEST, not a stock deduction. Nothing is deducted until the server confirms it in runDispense.
  function Queue(storage, key) {
    function read() { try { return JSON.parse(storage.getItem(key) || "[]"); } catch (e) { return []; } }
    function write(a) { try { storage.setItem(key, JSON.stringify(a)); return true; } catch (e) { return false; } }
    return {
      list: read,
      add: function (item) { var a = read().filter(function (x) { return x.requestId !== item.requestId; }); a.push(Object.assign({ status: "pending", attempts: 0, message: "" }, item)); return write(a); },
      update: function (requestId, patch) { var a = read(); a.forEach(function (x) { if (x.requestId === requestId) Object.assign(x, patch); }); write(a); },
      remove: function (requestId) { write(read().filter(function (x) { return x.requestId !== requestId; })); },
      count: function () { return read().length; }
    };
  }

  /* Sends queued requests to the server one at a time.
     candidates(item) must return the batch ids to consider (needs the internet). Stops at the first "no internet".
     Returns { done, conflicts, waiting }. */
  async function syncQueue(tools, queue, candidates, hooks) {
    hooks = hooks || {};
    var res = { done: 0, conflicts: 0, waiting: 0 };
    var items = queue.list().filter(function (x) { return x.status !== "conflict"; });
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      try {
        var ids = await candidates(it);
        var rp = Object.assign({}, it.params, { candidateBatchIds: ids, asOf: new Date(it.params.clientAt || Date.now()), source: "offline_replay" });
        if (hooks.makeHook) rp.hook = hooks.makeHook(it.params);      // payment / credit details travel with the queued request as plain data
        var out = await runDispense(tools, rp);
        queue.remove(it.requestId); res.done++;
        if (hooks.onDone) hooks.onDone(it, out);
      } catch (err) {
        if (err && err.pcd) { queue.update(it.requestId, { status: "conflict", message: friendlyError(err), code: err.code, attempts: (it.attempts || 0) + 1 }); res.conflicts++; if (hooks.onConflict) hooks.onConflict(it, err); }
        else if (isOfflineError(err)) { res.waiting += items.length - i; break; }
        else { queue.update(it.requestId, { message: friendlyError(err), attempts: (it.attempts || 0) + 1 }); res.waiting++; if (err && err.code === "permission-denied") break; }
      }
    }
    return res;
  }

  // ---------------------------------------------------------------- reports (computed from loaded rows)
  // prescriptions: prescriptions docs; records: dispense_records docs; orders: medicine orders (optional, for "received")
  function buildReport(prescriptions, records, orders, month) {
    var inMonth = function (r) { return !month || String(r.dispensedMonth || "") === month; };
    var recs = records.filter(inMonth);
    var byOp = {}, byDrug = {}, rxSet = {}, stockOut = 0;
    recs.forEach(function (r) {
      var o = byOp[r.dispensedBy] || (byOp[r.dispensedBy] = { name: r.dispensedByName || r.dispensedBy, lines: 0, prescriptions: {}, qty: 0 });
      o.lines++; o.qty = r4(o.qty + num(r.qtyDispensed)); o.prescriptions[r.prescriptionId] = 1;
      var d = byDrug[r.drugId] || (byDrug[r.drugId] = { name: r.drugName, unit: r.qtyUnit, qty: 0 });
      d.qty = r4(d.qty + num(r.qtyDispensed));
      rxSet[r.prescriptionId] = 1; stockOut = r4(stockOut + num(r.qtyDispensed));
    });
    var inRx = prescriptions.filter(function (x) { return rxSet[x.id]; });
    var received = (orders || []).filter(function (o) {
      if (o.kind !== "medicine" || !o.prescribedAt) return false;
      return !month || localDay(new Date(o.prescribedAt)).slice(0, 7) === month;
    });
    return {
      received: received.length,
      prescriptionsDispensedOn: Object.keys(rxSet).length,
      medicinesDispensed: Object.keys(byDrug).map(function (k) { return { drugId: k, name: byDrug[k].name, unit: byDrug[k].unit, qty: byDrug[k].qty }; }).sort(function (a, b) { return b.qty - a.qty; }),
      partial: inRx.filter(function (x) { return x.status === "partially_dispensed"; }).length,
      completed: inRx.filter(function (x) { return x.status === "completed"; }).length,
      outstanding: inRx.filter(function (x) { return num(x.qtyOutstanding) > 0; }).map(function (x) { return { id: x.id, patientName: x.patientName, drugName: x.drugName, outstanding: x.qtyOutstanding, unit: x.qtyUnit }; }),
      byOperator: Object.keys(byOp).map(function (k) { return { uid: k, name: byOp[k].name, lines: byOp[k].lines, prescriptions: Object.keys(byOp[k].prescriptions).length, qty: byOp[k].qty }; }).sort(function (a, b) { return b.qty - a.qty; }),
      stockDeducted: stockOut
    };
  }

  var api = { SCHEMA: SCHEMA, PCDError: PCDError, FRIENDLY: FRIENDLY, friendlyError: friendlyError, technicalDetail: technicalDetail, stepRef: stepRef, diagnose: diagnose, isOfflineError: isOfflineError,
    daysUntil: daysUntil, expiryMs: expiryMs, isExpired: isExpired, sellable: sellable, fefoSort: fefoSort, summarise: summarise, planFefo: planFefo, planManual: planManual,
    statusFor: statusFor, doseText: doseText, qtyState: qtyState, queueGroup: queueGroup, newRequestId: newRequestId, lineId: lineId, localDay: localDay, r4: r4,
    runDispense: runDispense, Queue: Queue, syncQueue: syncQueue, buildReport: buildReport };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCD = api;
})(typeof window !== "undefined" ? window : this);
