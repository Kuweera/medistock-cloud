/* MediStock Cloud — Phase 5 dispensing extension (Developer 1): money, returns, consumables.
   Loaded after pc-dispense.js (needs PCD). Same style as PCD: pure helpers + transactions that receive the Firebase tools.

   1. BILLING: the dispensing form shows the selling price of the medicine (the same retail prices Sales uses, editable per line).
      Dispensing never waits for payment. Whatever is not paid is CREDIT, written in the SAME shapes sales.html already uses
      (receipts, sales, credit_accounts, credit_transactions CREDIT_SALE). These records are written inside the dispensing
      transaction and never change stock again (dispensing already did).
   2. RETURNS / REVERSALS: allowed only for stock that has NOT been handed over and NOT been administered (e.g. an injection
      not yet given). Capped per dispense record, one-time per request id, append-only audit, stock restored exactly once.
   3. CONSUMABLES: a separate inventory (consumable_items). Nothing is fixed: the person picks what was actually used.
      Bundles are only suggestions that pre-tick a list. Medicines and consumables never share stock records. */
(function (root) {
  var D = root.PCD || (typeof require !== "undefined" ? require("./pc-dispense.js") : null);
  var SCHEMA = 1;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round(Number(n) * 100) / 100; }
  function r4(n) { return Math.round(Number(n) * 10000) / 10000; }
  function clean(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k] === undefined ? null : o[k]; }); return r; }
  function E(code, message, extra) { var e = D.PCDError(code, message, extra); return e; }

  // ============================================================ 1. PRICES AND BILL
  // Same fields and fallback as sales.html priceFor(). Dispensing is entered in the smallest unit, so the default is retailBase.
  function unitPrices(drug) {
    drug = drug || {};
    return { base: num(drug.retailBase), intermediate: num(drug.retailIntermediate), stock: num(drug.retailStock),
      baseUnit: drug.baseUnit || "", intermediateUnit: drug.hasIntermediate ? (drug.intermediateUnit || "") : "", stockUnit: drug.stockUnit || "" };
  }
  function defaultUnitPrice(drug) {
    var p = unitPrices(drug);
    if (p.base > 0) return p.base;
    // no per-unit price entered in Inventory: derive it from the next level up so the form is not blank
    var per = num(drug && drug.baseUnitsPerStock) || 0;
    if (p.stock > 0 && per > 0) return r2(p.stock / per);
    return 0;
  }
  /* bill({ qty, unitPrice, amountPaid }) -> { total, paid, outstanding, status }
     status: "no_charge" (price 0) | "paid" | "part_paid" | "credit".  Unpaid money is always CREDIT; nothing blocks dispensing. */
  function bill(o) {
    var qty = num(o.qty), price = Math.max(0, num(o.unitPrice));
    var total = r2(qty * price);
    var paid = Math.min(total, Math.max(0, r2(num(o.amountPaid))));
    var outstanding = r2(total - paid);
    var status = total <= 0 ? "no_charge" : outstanding <= 0 ? "paid" : paid > 0 ? "part_paid" : "credit";
    return { qty: qty, unitPrice: price, total: total, paid: paid, outstanding: outstanding, status: status };
  }
  var PAY_LABEL = { no_charge: "No charge", paid: "Paid", part_paid: "Part paid (rest on credit)", credit: "Not paid (on credit)" };
  var METHODS = ["Cash", "Mobile money", "Card", "Insurance", "Other"];

  /* hook for PCD.runDispense: PCD.runDispense(tools, { ..., hook: PCX.financeHook(tools, f) }). f: { qty, drugId, db-free } plus { unitPrice, amountPaid, method, customerName, customerPhone, customerId, dueDate, creditLimit, businessId, facilityId, uid, userName, patientId } */
  function financeHook(tools, f) {
    var b = bill({ qty: f.qty, unitPrice: f.unitPrice, amountPaid: f.amountPaid });
    return {
      bill: b,
      read: async function (tx, label) {
        if (b.outstanding <= 0) return { acct: null };
        var id = f.customerId || ("dspca_" + f.patientId);
        var snap = await label("read credit_accounts", tx.get(tools.doc(tools.db, "credit_accounts", id)));
        if (snap.exists()) { var a = snap.data(); if (a.businessId !== f.businessId || a.shopId !== f.facilityId) throw E("credit_account_other", "That credit account belongs to another shop."); }
        return { acct: { id: id, exists: snap.exists() } };
      },
      write: function (tx, st, c) {
        var doc = tools.doc, db = tools.db, ts = tools.serverTimestamp, rid = c.requestId, drug = c.drug, per = num(drug.baseUnitsPerStock) || 1;
        var money = { businessId: f.businessId, shopId: f.facilityId };
        var patientName = c.order.patientName || "";
        var custName = (f.customerName || patientName || "").trim();
        var credId = null, receiptIds = [], saleIds = [], creditTxnId = null;
        var parts = [];
        if (b.paid > 0) parts.push({ kind: "PAID", amount: b.paid, sfx: "p" });
        if (b.outstanding > 0) parts.push({ kind: "CREDIT", amount: b.outstanding, sfx: "c" });
        if (b.outstanding > 0) {
          credId = st.acct.id;
          if (!st.acct.exists) tx.set(doc(db, "credit_accounts", credId), clean(Object.assign({}, money, { name: custName, phone: f.customerPhone || null, creditLimit: 0, createdAt: ts(), source: "dispensing", patientId: f.patientId })));
          else if (f.customerPhone) tx.update(doc(db, "credit_accounts", credId), { phone: f.customerPhone });
        }
        var number = "D-" + String(rid).slice(0, 6).toUpperCase();
        parts.forEach(function (pt) {
          var frac = b.total > 0 ? pt.amount / b.total : 0;
          var q = r4(b.qty * frac);
          var rcId = "dsprc_" + rid + "_" + pt.sfx, slId = "dspsl_" + rid + "_" + pt.sfx;
          receiptIds.push(rcId); saleIds.push(slId);
          tx.set(doc(db, "receipts", rcId), clean(Object.assign({}, money, {
            type: "SALE", displayNumber: number + (parts.length > 1 ? "-" + pt.sfx.toUpperCase() : ""), createdAt: ts(), cashier: f.userName || "",
            itemCount: 1, totalAmount: pt.amount, paymentStatus: pt.kind, customerId: pt.kind === "CREDIT" ? credId : null, customerName: pt.kind === "CREDIT" ? custName : "",
            items: [{ drugId: f.drugId, drugName: drug.name, qty: q, unitLabel: drug.baseUnit || "", unitLevel: "base", pricePerUnit: b.unitPrice, total: pt.amount,
              baseQtyNeeded: q, stockUnit: drug.stockUnit || "", intermediateUnit: drug.intermediateUnit || "", baseUnit: drug.baseUnit || "",
              baseUnitsPerStock: drug.baseUnitsPerStock || null, basePerIntermediate: drug.basePerIntermediate || null }]
          })));
          tx.set(doc(db, "sales", slId), clean(Object.assign({}, money, {
            ownerUid: f.uid, drugId: f.drugId, drugName: drug.name, drugClass: drug.drugClass || "", unitLevel: "base", qty: q, baseQtyDeducted: q,
            pricePerUnit: b.unitPrice, total: pt.amount, costOfGoods: r2(c.costOfGoods * frac), receiptId: rcId, cashier: f.userName || "", paymentStatus: pt.kind,
            customerId: pt.kind === "CREDIT" ? credId : null, createdAt: ts()
          })));
          if (pt.kind === "CREDIT") {
            creditTxnId = "dspct_" + rid;
            tx.set(doc(db, "credit_transactions", creditTxnId), clean(Object.assign({}, money, {
              customerId: credId, customerName: custName, type: "CREDIT_SALE", amount: pt.amount, paidAmount: 0, balanceChange: pt.amount, dueDate: f.dueDate || null,
              receiptId: rcId, description: "Credit sale receipt " + number + " (dispensing)", createdAt: ts()
            })));
          }
        });
        // the bill itself: one document per dispensing request, linked to the records above
        tx.set(doc(db, "dispense_bills", rid), clean({
          id: rid, requestId: rid, businessId: f.businessId, facilityId: f.facilityId, schemaVersion: SCHEMA, createdBy: f.uid, createdAt: ts(), clientCreatedAt: Date.now(),
          prescriptionId: c.orderId, patientId: c.order.patientId, patientName: patientName, drugId: f.drugId, drugName: drug.name, qty: b.qty, qtyUnit: c.unit,
          unitPrice: b.unitPrice, listPrice: defaultUnitPrice(drug), total: b.total, amountPaid: b.paid, amountOutstanding: b.outstanding, paymentStatus: b.status,
          paymentMethod: b.paid > 0 ? (f.method || "Cash") : null, customerId: credId, customerName: b.outstanding > 0 ? custName : null,
          receiptIds: receiptIds, saleIds: saleIds, creditTxnId: creditTxnId, costOfGoods: c.costOfGoods, qtyReturned: 0, valueReturned: 0, creditReturned: 0, status: "active"
        }));
      }
    };
  }

  // ============================================================ 2. RETURNS / REVERSALS
  var ZFR = {
    no_reason: "Give a reason for the reversal (at least 3 letters).",
    not_back: "Confirm that the medicine is physically back and unused.",
    nothing_to_return: "Nothing on this prescription can be reversed. Medicine that was handed over, or already administered, cannot be taken back into stock here.",
    handed_over: "That medicine was handed over to the patient or ward, so it cannot be put back into stock automatically. Use a stock adjustment with a reason if it really came back.",
    administered: "A dose of this medicine has already been recorded as given, so it cannot be reversed or substituted. Nothing was changed.",
    mar_unchecked: "Could not confirm whether any dose was already given (no internet?). Nothing was changed. Try again when online.",
    over_returnable: "That is more than can still be reversed.",
    too_many_lines: "This dispensing used too many batches to reverse in one step. Reverse a smaller quantity.",
    batch_gone: "A batch used for this dispensing no longer exists, so the stock cannot be put back there. Ask the stock manager to adjust it.",
    rx_missing: "This prescription has no dispensing to reverse."
  };
  Object.keys(ZFR).forEach(function (k) { D.FRIENDLY[k] = ZFR[k]; });

  /* Has a dose been recorded as GIVEN for this order? Fail closed: if the question cannot be answered, the reversal is refused.
     (A rule or a transaction cannot query, so this is checked just before the transaction. The "handed over" marker, which IS read inside
     the transaction, covers take-home medicine; this covers injections and ward doses.) */
  async function administeredCount(tools, p) {
    try {
      var snap = await tools.getDocs(tools.query.apply(null, [tools.collection(tools.db, "pc_mar_records"),
        tools.where("businessId", "==", p.businessId), tools.where("facilityId", "==", p.facilityId), tools.where("orderId", "==", p.orderId)].concat(tools.limit ? [tools.limit(2000)] : [])));
      var n = 0; snap.docs.forEach(function (d) { var m = d.data(); if (m.outcome === "administered" && m.status !== "entered_in_error") n++; });
      return n;
    } catch (e) { throw E("mar_unchecked", ZFR.mar_unchecked); }
  }

  /* One reversal. p: { businessId, facilityId, uid, userName, orderId, requestId (new, fixed per attempt), qty, reason, confirmedBack,
        records: [{id}] newest first (the dispense_records of this prescription), asOf, clientAt }
     Never queued offline. Idempotent on requestId. */
  async function runReturn(tools, p) {
    var doc = tools.doc, db = tools.db;
    if (!p.requestId) throw E("no_request_id", D.FRIENDLY.no_request_id);
    var qty = r4(p.qty);
    if (!(qty > 0)) throw E("bad_quantity", D.FRIENDLY.bad_quantity);
    if (String(p.reason || "").trim().length < 3) throw E("no_reason", ZFR.no_reason);
    if (!p.confirmedBack) throw E("not_back", ZFR.not_back);
    var recIds = (p.records || []).map(function (r) { return r.id; });
    if (recIds.length === 0) throw E("rx_missing", ZFR.rx_missing);
    if (recIds.length > 3) throw E("too_many_lines", ZFR.too_many_lines);
    var rid = "drt_" + p.requestId;
    var nAdmin = await administeredCount(tools, p);
    if (nAdmin > 0) throw E("administered", ZFR.administered, { doses: nAdmin });

    var label = function (step, promise) { return promise.catch(function (e) { if (e && !e.pcdStep && !e.pcd) e.pcdStep = step; throw e; }); };
    var rxRef = doc(db, "prescriptions", p.orderId);
    return tools.runTransaction(db, async function (tx) {
      var dup = await label("read dispense_returns (duplicate check)", tx.get(doc(db, "dispense_returns", rid)));
      if (dup.exists()) { var d0 = dup.data(); return { duplicate: true, qty: d0.qty, valueReturned: d0.valueReturned, refundDue: d0.cashPart }; }
      var rxSnap = await label("read prescriptions", tx.get(rxRef));
      if (!rxSnap.exists()) throw E("rx_missing", ZFR.rx_missing);
      var rx = rxSnap.data();
      if (rx.businessId !== p.businessId || rx.facilityId !== p.facilityId) throw E("wrong_facility", D.FRIENDLY.wrong_facility);
      var drugRef = doc(db, "drugs", rx.drugId);
      var drugSnap = await label("read drugs", tx.get(drugRef));
      var recs = [];
      for (var i = 0; i < recIds.length; i++) {
        var rs = await label("read dispense_records", tx.get(doc(db, "dispense_records", recIds[i])));
        if (!rs.exists()) continue;
        var r = rs.data(); if (r.prescriptionId !== p.orderId || r.businessId !== p.businessId) continue;
        var led = await label("read dispense_return_ledger", tx.get(doc(db, "dispense_return_ledger", recIds[i])));
        var hand = await label("read dispense_handovers", tx.get(doc(db, "dispense_handovers", r.requestId)));
        var bl = await label("read dispense_bills", tx.get(doc(db, "dispense_bills", r.requestId)));
        var bt = r.batchId ? await label("read batches", tx.get(doc(db, "batches", r.batchId))) : null;
        recs.push({ id: recIds[i], rec: r, returned: led.exists() ? num(led.data().qtyReturned) : 0, ledgerExists: led.exists(), handed: hand.exists(), bill: bl.exists() ? bl.data() : null, batch: bt && bt.exists() ? bt.data() : null, batchMissing: !!r.batchId && !(bt && bt.exists()) });
      }
      if (!drugSnap.exists()) throw E("drug_missing", D.FRIENDLY.drug_missing);
      var drug = drugSnap.data();
      var avail = 0, handedQty = 0;
      recs.forEach(function (x) { var left = r4(num(x.rec.qtyDispensed) - x.returned); if (x.handed) handedQty += left; else avail += left; });
      if (avail <= 0) throw E(handedQty > 0 ? "handed_over" : "nothing_to_return", handedQty > 0 ? ZFR.handed_over : ZFR.nothing_to_return);
      if (qty > avail + 1e-9) throw E("over_returnable", ZFR.over_returnable + " Can still be reversed: " + r4(avail) + ".", { available: avail });
      if (qty > num(rx.qtyDispensed) + 1e-9) throw E("over_returnable", ZFR.over_returnable, { available: num(rx.qtyDispensed) });

      var left = qty, allocs = [];
      for (var k = 0; k < recs.length && left > 1e-9; k++) {
        var x = recs[k]; if (x.handed) continue;
        var room = r4(num(x.rec.qtyDispensed) - x.returned); if (room <= 0) continue;
        if (x.batchMissing) throw E("batch_gone", ZFR.batch_gone);
        var take = Math.min(room, left); left = r4(left - take);
        allocs.push({ x: x, take: take });
      }
      var per = num(drug.baseUnitsPerStock) || 1;
      var ts = tools.serverTimestamp, stamp = { businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: ts(), clientCreatedAt: p.clientAt || Date.now() };
      var totalValue = 0, creditPart = 0, cashPart = 0, outAllocs = [], billState = {};
      allocs.forEach(function (a, n) {
        var x = a.x, take = a.take, r = x.rec;
        if (r.batchId) tx.update(doc(db, "batches", r.batchId), { quantity: r4(num(x.batch.quantity) + take) });
        tx.set(doc(db, "stock_transactions", rid + "_" + n), clean({
          businessId: p.businessId, shopId: p.facilityId, drugId: rx.drugId, drugName: drug.name, type: "RETURN", baseUnitsChange: take,
          note: "Dispensing reversed (not given) — prescription " + p.orderId + ": " + String(p.reason).trim(), batchId: r.batchId || null, cashier: p.userName || "", createdAt: ts(),
          prescriptionId: p.orderId, returnRequestId: p.requestId
        }));
        if (x.ledgerExists) tx.update(doc(db, "dispense_return_ledger", x.id), { qtyReturned: r4(x.returned + take), lastReturnRequestId: p.requestId, updatedBy: p.uid, updatedAt: ts() });
        else tx.set(doc(db, "dispense_return_ledger", x.id), clean({ id: x.id, recordId: x.id, prescriptionId: p.orderId, businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA,
          qtyReturned: r4(take), lastReturnRequestId: p.requestId, createdBy: p.uid, createdAt: ts(), updatedBy: p.uid, updatedAt: ts() }));
        var cost = r2((take / per) * (x.batch ? num(x.batch.purchasePricePerStockUnit || x.batch.costPerStockUnit) : num(drug.wholesale)));
        var bl = billState[r.requestId] || (billState[r.requestId] = { bill: x.bill, qty: 0, value: 0, credit: 0 });
        var value = 0, cPart = 0, kPart = 0;
        if (x.bill && num(x.bill.total) > 0) {
          value = r2(take * num(x.bill.unitPrice));
          var creditLeft = r2(num(x.bill.amountOutstanding) - num(x.bill.creditReturned) - bl.credit);
          cPart = Math.max(0, Math.min(value, creditLeft)); kPart = r2(value - cPart);
        }
        bl.qty = r4(bl.qty + take); bl.value = r2(bl.value + value); bl.credit = r2(bl.credit + cPart);
        totalValue = r2(totalValue + value); creditPart = r2(creditPart + cPart); cashPart = r2(cashPart + kPart);
        var money = { businessId: p.businessId, shopId: p.facilityId };
        [["c", cPart, "CREDIT"], ["p", kPart, "PAID"]].forEach(function (g) {
          if (!(g[1] > 0)) return;
          var f = value > 0 ? g[1] / value : 0;
          tx.set(doc(db, "sales", "drtsl_" + p.requestId + "_" + n + "_" + g[0]), clean(Object.assign({}, money, {
            ownerUid: p.uid, drugId: rx.drugId, drugName: drug.name, drugClass: drug.drugClass || "", unitLevel: "base", qty: -r4(take * f), baseQtyDeducted: -r4(take * f),
            pricePerUnit: x.bill.unitPrice, total: -g[1], costOfGoods: -r2(cost * f), receiptId: (x.bill.receiptIds || [])[g[0] === "c" ? (x.bill.receiptIds.length - 1) : 0] || null,
            cashier: p.userName || "", paymentStatus: g[2], customerId: g[2] === "CREDIT" ? x.bill.customerId : null,
            note: "Dispensing reversed against " + r.requestId, createdAt: ts()
          })));
        });
        if (cPart > 0) tx.set(doc(db, "credit_transactions", "drtct_" + p.requestId + "_" + n), clean(Object.assign({}, money, {
          customerId: x.bill.customerId, customerName: x.bill.customerName || "", type: "CORRECTION", amount: cPart, paidAmount: 0, balanceChange: -cPart,
          receiptId: (x.bill.receiptIds || [])[x.bill.receiptIds.length - 1] || null, description: "Dispensing reversed: " + take + " " + (r.qtyUnit || "") + " " + (drug.name || ""), cashier: p.userName || "", createdAt: ts()
        })));
        outAllocs.push({ recordId: x.id, batchId: r.batchId || null, qty: take, requestId: r.requestId });
      });
      Object.keys(billState).forEach(function (reqId) {
        var bs = billState[reqId]; if (!bs.bill) return;
        tx.update(doc(db, "dispense_bills", reqId), { qtyReturned: r4(num(bs.bill.qtyReturned) + bs.qty), valueReturned: r2(num(bs.bill.valueReturned) + bs.value),
          creditReturned: r2(num(bs.bill.creditReturned) + bs.credit), lastReturnRequestId: p.requestId, updatedBy: p.uid, updatedAt: ts() });
      });
      tx.update(drugRef, { currentStockBase: r4(num(drug.currentStockBase) + qty) });
      var newDisp = r4(num(rx.qtyDispensed) - qty), newOut = r4(Math.max(0, num(rx.qtyPrescribed) - newDisp));
      tx.update(rxRef, { qtyDispensed: newDisp, qtyOutstanding: newOut, status: newDisp <= 0 ? "pending" : D.statusFor(num(rx.qtyPrescribed), newDisp),
        qtyReturned: r4(num(rx.qtyReturned) + qty), lastReturnRequestId: p.requestId, lastReturnedBy: p.uid, lastReturnedAt: ts(), updatedBy: p.uid, updatedAt: ts() });
      tx.set(doc(db, "dispense_returns", rid), clean(Object.assign({}, stamp, {
        id: rid, requestId: p.requestId, prescriptionId: p.orderId, patientId: rx.patientId, patientName: rx.patientName, drugId: rx.drugId, drugName: drug.name, qty: qty, qtyUnit: rx.qtyUnit || drug.baseUnit || "",
        reason: String(p.reason).trim(), allocations: outAllocs, valueReturned: totalValue, creditPart: creditPart, cashPart: cashPart, returnedBy: p.uid, returnedByName: p.userName || "", returnedAt: ts(),
        confirmedBack: true, administeredDosesSeen: 0
      })));
      tx.set(doc(db, "pc_audit_logs", "dispense_return_" + p.requestId), clean({
        businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: ts(), clientCreatedAt: p.clientAt || Date.now(),
        actorUid: p.uid, actorName: p.userName || "", action: "dispense.reverse", recordPath: "prescriptions/" + p.orderId, patientId: rx.patientId, orderId: p.orderId,
        qty: qty, reason: String(p.reason).trim(), valueReturned: totalValue, refundDue: cashPart, drugId: rx.drugId, at: ts()
      }));
      return { duplicate: false, qty: qty, valueReturned: totalValue, creditReduced: creditPart, refundDue: cashPart, allocations: outAllocs, qtyDispensedAfter: newDisp };
    });
  }

  /* Mark a dispensing as handed over (to the patient or ward). After this it can no longer be reversed. Idempotent. */
  async function runHandover(tools, p) {
    var doc = tools.doc, db = tools.db;
    return tools.runTransaction(db, async function (tx) {
      var ref = doc(db, "dispense_handovers", p.requestId);
      var s = await tx.get(ref); if (s.exists()) return { duplicate: true };
      var rec = await tx.get(doc(db, "dispense_records", p.requestId + "_0"));
      if (!rec.exists()) throw E("rx_missing", ZFR.rx_missing);
      var r = rec.data(); if (r.businessId !== p.businessId || r.facilityId !== p.facilityId) throw E("wrong_facility", D.FRIENDLY.wrong_facility);
      tx.set(ref, clean({ id: p.requestId, requestId: p.requestId, prescriptionId: r.prescriptionId, patientId: r.patientId, businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA,
        createdBy: p.uid, createdAt: tools.serverTimestamp(), clientCreatedAt: p.clientAt || Date.now(), handedOverBy: p.uid, handedOverByName: p.userName || "", handedOverAt: tools.serverTimestamp(), note: p.note || "" }));
      return { duplicate: false };
    });
  }

  // ============================================================ 3. CONSUMABLES (separate inventory, selected not fixed)
  var CF = {
    c_no_items: "Choose at least one consumable and a quantity.",
    c_bad_qty: "Each consumable needs a quantity greater than zero.",
    c_missing: "One of these consumables is not in the consumables list.",
    c_short: "Not enough of this consumable in stock.",
    c_inactive: "This consumable is switched off.",
    c_reason: "Give a reason (at least 3 letters).",
    c_dup_item: "The same consumable is listed twice. Combine the quantities.",
    c_other_shop: "That consumable belongs to another shop."
  };
  Object.keys(CF).forEach(function (k) { D.FRIENDLY[k] = CF[k]; });

  /* Record the consumables actually used. p: { businessId, facilityId, uid, userName, requestId, items:[{itemId, qty}], patientId, patientName, encounterId, orderId, procedure, dispenseRequestId, clientAt }
     The list is whatever the person selected. Nothing is added automatically. */
  async function runConsumableUse(tools, p) {
    var doc = tools.doc, db = tools.db, items = (p.items || []).filter(function (i) { return i && i.itemId; });
    if (!p.requestId) throw E("no_request_id", D.FRIENDLY.no_request_id);
    if (items.length === 0) throw E("c_no_items", CF.c_no_items);
    var seen = {};
    items.forEach(function (i) { if (!(num(i.qty) > 0)) throw E("c_bad_qty", CF.c_bad_qty); if (seen[i.itemId]) throw E("c_dup_item", CF.c_dup_item); seen[i.itemId] = 1; });
    var label = function (step, promise) { return promise.catch(function (e) { if (e && !e.pcdStep && !e.pcd) e.pcdStep = step; throw e; }); };
    return tools.runTransaction(db, async function (tx) {
      var first = await label("read consumable_movements (duplicate check)", tx.get(doc(db, "consumable_movements", p.requestId + "_0")));
      if (first.exists()) return { duplicate: true, lines: first.data().lines };
      var snaps = [];
      for (var i = 0; i < items.length; i++) snaps.push(await label("read consumable_items", tx.get(doc(db, "consumable_items", items[i].itemId))));
      var ts = tools.serverTimestamp, out = [];
      snaps.forEach(function (s, n) {
        if (!s.exists()) throw E("c_missing", CF.c_missing);
        var it = s.data(); if (it.businessId !== p.businessId || it.facilityId !== p.facilityId) throw E("c_other_shop", CF.c_other_shop);
        if (it.active === false) throw E("c_inactive", CF.c_inactive + " (" + it.name + ")");
        var q = r4(items[n].qty), cur = num(it.qtyOnHand);
        if (cur + 1e-9 < q) throw E("c_short", CF.c_short + " " + it.name + ": " + cur + " " + (it.unit || "") + " left.", { available: cur });
        var mid = p.requestId + "_" + n, after = r4(cur - q);
        tx.update(doc(db, "consumable_items", items[n].itemId), { qtyOnHand: after, lastMovementId: mid, updatedBy: p.uid, updatedAt: ts() });
        tx.set(doc(db, "consumable_movements", mid), clean({
          id: mid, requestId: p.requestId, lineNo: n, lines: items.length, businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: ts(), clientCreatedAt: p.clientAt || Date.now(),
          itemId: items[n].itemId, itemName: it.name, unit: it.unit || "", type: "use", qtyChange: -q, qtyAfter: after, reason: p.procedure || "Used", procedure: p.procedure || null,
          patientId: p.patientId || null, patientName: p.patientName || null, encounterId: p.encounterId || null, orderId: p.orderId || null, dispenseRequestId: p.dispenseRequestId || null,
          byName: p.userName || ""
        }));
        out.push({ itemId: items[n].itemId, name: it.name, qty: q, unit: it.unit || "", after: after });
      });
      tx.set(doc(db, "pc_audit_logs", "consumable_use_" + p.requestId), clean({
        businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: ts(), clientCreatedAt: p.clientAt || Date.now(),
        actorUid: p.uid, actorName: p.userName || "", action: "consumable.use", recordPath: "consumable_movements/" + p.requestId + "_0", patientId: p.patientId || null, orderId: p.orderId || null,
        items: out.map(function (o) { return o.name + " x" + o.qty; }), at: ts()
      }));
      return { duplicate: false, lines: out };
    });
  }

  /* Add stock / correct a count / take back unopened items. kind: "receive" | "adjust" | "return". reason is required for adjust and return.
     qty: positive for receive and return; for adjust, the signed change (negative = loss, breakage, expiry). */
  async function runConsumableAdjust(tools, p) {
    var doc = tools.doc, db = tools.db;
    if (!p.requestId) throw E("no_request_id", D.FRIENDLY.no_request_id);
    var kind = p.kind, q = r4(p.qty);
    if (["receive", "adjust", "return"].indexOf(kind) < 0) throw E("c_bad_qty", CF.c_bad_qty);
    if (!(q !== 0 && isFinite(q)) || ((kind === "receive" || kind === "return") && q <= 0)) throw E("c_bad_qty", CF.c_bad_qty);
    if ((kind === "adjust" || kind === "return") && String(p.reason || "").trim().length < 3) throw E("c_reason", CF.c_reason);
    var label = function (step, promise) { return promise.catch(function (e) { if (e && !e.pcdStep && !e.pcd) e.pcdStep = step; throw e; }); };
    return tools.runTransaction(db, async function (tx) {
      var mid = p.requestId + "_0";
      var dup = await label("read consumable_movements (duplicate check)", tx.get(doc(db, "consumable_movements", mid)));
      if (dup.exists()) return { duplicate: true };
      var s = await label("read consumable_items", tx.get(doc(db, "consumable_items", p.itemId)));
      if (!s.exists()) throw E("c_missing", CF.c_missing);
      var it = s.data(); if (it.businessId !== p.businessId || it.facilityId !== p.facilityId) throw E("c_other_shop", CF.c_other_shop);
      var after = r4(num(it.qtyOnHand) + q);
      if (after < 0) throw E("c_short", CF.c_short + " " + it.name + ": " + num(it.qtyOnHand) + " " + (it.unit || "") + " counted.", { available: num(it.qtyOnHand) });
      var ts = tools.serverTimestamp;
      tx.update(doc(db, "consumable_items", p.itemId), { qtyOnHand: after, lastMovementId: mid, updatedBy: p.uid, updatedAt: ts() });
      tx.set(doc(db, "consumable_movements", mid), clean({
        id: mid, requestId: p.requestId, lineNo: 0, lines: 1, businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: ts(), clientCreatedAt: p.clientAt || Date.now(),
        itemId: p.itemId, itemName: it.name, unit: it.unit || "", type: kind, qtyChange: q, qtyAfter: after, reason: String(p.reason || (kind === "receive" ? "Stock received" : "")).trim(), byName: p.userName || ""
      }));
      return { duplicate: false, after: after };
    });
  }

  /* New consumable (opening quantity is added afterwards with "receive", so every unit of stock has a movement behind it). */
  async function createConsumable(tools, p) {
    var name = String(p.name || "").trim();
    if (name.length < 2) throw E("c_bad_qty", "Enter the consumable's name.");
    var id = "con_" + (p.id || D.newRequestId().slice(0, 12));
    var doc = tools.doc, db = tools.db;
    return tools.runTransaction(db, async function (tx) {
      var s = await tx.get(doc(db, "consumable_items", id)); if (s.exists()) return { id: id, duplicate: true };
      tx.set(doc(db, "consumable_items", id), clean({ id: id, businessId: p.businessId, facilityId: p.facilityId, schemaVersion: SCHEMA, createdBy: p.uid, createdAt: tools.serverTimestamp(), clientCreatedAt: Date.now(),
        name: name, unit: String(p.unit || "piece").trim(), category: p.category || "", qtyOnHand: 0, reorderLevel: Math.max(0, num(p.reorderLevel)), active: true, lastMovementId: null }));
      return { id: id, duplicate: false };
    });
  }

  // Bundles are SUGGESTIONS: they only pre-fill the picker; the person can change, remove or add. Returns [{itemId, qty, name, unit}]
  function suggestFromBundle(bundle, items) {
    var byId = {}; (items || []).forEach(function (i) { byId[i.id] = i; });
    return ((bundle && bundle.items) || []).filter(function (b) { return byId[b.itemId] && byId[b.itemId].active !== false; })
      .map(function (b) { return { itemId: b.itemId, qty: num(b.qty) > 0 ? num(b.qty) : 1, name: byId[b.itemId].name, unit: byId[b.itemId].unit || "" }; });
  }
  function lowStock(items) {
    return (items || []).filter(function (i) { return i.active !== false && num(i.qtyOnHand) <= num(i.reorderLevel); })
      .map(function (i) { return { id: i.id, name: i.name, unit: i.unit, qtyOnHand: num(i.qtyOnHand), reorderLevel: num(i.reorderLevel), out: num(i.qtyOnHand) <= 0 }; });
  }

  var api = { SCHEMA: SCHEMA, unitPrices: unitPrices, defaultUnitPrice: defaultUnitPrice, bill: bill, PAY_LABEL: PAY_LABEL, METHODS: METHODS, financeHook: financeHook,
    administeredCount: administeredCount, runReturn: runReturn, runHandover: runHandover, runConsumableUse: runConsumableUse, runConsumableAdjust: runConsumableAdjust,
    createConsumable: createConsumable, suggestFromBundle: suggestFromBundle, lowStock: lowStock };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCX = api;
})(typeof window !== "undefined" ? window : this);
