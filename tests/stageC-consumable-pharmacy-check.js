/* Developer 3, Stage C: request a consumable from the pharmacy (users with treatment.prescribe), through ONE shared builder (PCD.consumableRequest in pc-dispense.js).
   Real pharmacy.html in headless Chromium at 390px against the in-memory harness, whose create rules are a STAND-IN written from the v23 rules text (NOT the rules engine, NOT real Firebase).
   Run: python3 -m http.server 8765 (repo root), then node tests/stageC-consumable-pharmacy-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict"), fs = require("node:fs");
const OUT = process.argv[2] || ".", H = "http://localhost:8765/tests/harness-stage6.html";

/* ---- one function, two pages: neither page builds the documents itself ---- */
for (const file of ["encounter.html", "pharmacy.html"]) {
  const src = fs.readFileSync(__dirname + "/../" + file, "utf8");
  assert.match(src, /PCD\.consumableRequest\(/, file + " uses the shared builder");
  assert.doesNotMatch(src, /kind: "consumable"/, file + " must not build a consumable order or its audit record itself (a medicine's own pending prescription is Stage 2 and is not this)");
}
assert.match(fs.readFileSync(__dirname + "/../encounter.html", "utf8"), /<script src="pc-dispense\.js"><\/script>/, "the visit page loads pc-dispense.js");

(async () => {
  const browser = await chromium.launch(), errors = [], dialogs = [];
  async function open(as, offline) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => { dialogs.push(d.message()); d.accept("Test reason"); });
    await page.goto(H + (as ? "?as=" + as : "")); const f = page.frameLocator("#f"); await f.locator("#list .rxgroup").first().waitFor(); await page.waitForTimeout(600);
    const fr = await (await page.locator("#f").elementHandle()).contentFrame();
    return { ctx, page, f, fr, db: (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]), batches: () => page.evaluate(() => window.__batches || []), listed: () => f.locator("#list .pt").evaluateAll(n => n.map(x => x.dataset.id)) };
  }
  const msg = async f => (await f.locator("#cnMsg").innerText()).trim();
  const visible = async (f, sel) => (await f.locator(sel).count()) > 0 && await f.locator(sel).isVisible();

  /* ================= permissions: the entry exists only for users who may prescribe ================= */
  { const p = await open("pharm");   // dispense + patient.view, NO treatment.prescribe
    assert.equal(await visible(p.f, "#cnOpenBtn"), false, "no Add consumable button without treatment.prescribe");
    await p.f.locator('#list .pt[data-id="c9"]').click(); await p.f.locator("#cPat").waitFor(); assert.equal(await p.f.locator('[data-act="addcons"]').count(), 0, "no shortcut in the panel either");
    assert.equal(await p.f.locator("#cnCard").evaluate(e => e.classList.contains("hidden")), true); await p.ctx.close(); }
  { const p = await open("pharmrx"); assert.equal(await visible(p.f, "#cnOpenBtn"), true, "button shown with treatment.prescribe"); await p.ctx.close(); }
  { const p = await open(); assert.equal(await visible(p.f, "#cnOpenBtn"), true, "the owner may too"); await p.ctx.close(); }

  /* ================= the main entry ================= */
  const P = await open("pharmrx"), { f, page, fr } = P;
  const waiting0 = (await P.listed()).length, w0n = Number(((await f.locator('#filters [data-f="waiting"]').innerText()).match(/\((\d+)\)/) || [0, 0])[1]);
  await f.locator("#cnOpenBtn").click(); await f.locator("#cnVisitList .cand").first().waitFor();
  const visits = await f.locator("#cnVisitList .cand").allInnerTexts(); for (const n of ["Nine", "Ten", "Twelve"]) assert.ok(visits.some(v => new RegExp("Patient " + n + "\\n").test(v)), "open visit offered: " + n + " in " + JSON.stringify(visits)); assert.ok(!visits.some(v => /Eleven|Thirty Five/.test(v)), "a CLOSED visit is not offered");
  await f.locator("#cnVisitQ").fill("ten"); assert.equal(await f.locator("#cnVisitList .cand").count(), 1); await f.locator("#cnVisitQ").fill("V-12"); assert.equal(await f.locator("#cnVisitList .cand").count(), 1); await f.locator("#cnVisitQ").fill("");
  // a visit with no active plan: cannot save; a way to the visit's treatment tab (the address link)
  await f.locator('[data-cnvisit="e12"]').click(); await f.locator("#cnVisitPicked").waitFor();
  assert.match(await f.locator("#cnVisitPicked").innerText(), /no active treatment plan[\s\S]*Start a plan in the visit first/); assert.equal(await visible(f, "#cnSaveBtn"), false); assert.equal(await visible(f, "#cnItemBox"), false);
  await f.locator("[data-cnopenvisit]").click(); assert.equal(await page.evaluate(() => location.hash), "#encounter.html?id=e12&tab=treatment", "opens the visit's treatment tab");
  await f.locator("#cnChange").click(); await f.locator("#cnVisitList .cand").first().waitFor();
  // a visit with two active plans
  await f.locator('[data-cnvisit="e9"]').click(); await f.locator("#cnPlan").waitFor();
  assert.deepEqual(await f.locator("#cnPlan option").allInnerTexts(), ["Malaria treatment", "Wound care"]); assert.match(await f.locator("#cnPlanNote").innerText(), /more than one active plan/); await f.locator("#cnPlan").selectOption("pl9b");
  // choosing the item: consumable items first, stock shown, nothing outside stock
  assert.equal(await f.locator("#cnOnly").isChecked(), true); const items = await f.locator("#cnResults .cand").allInnerTexts(); assert.ok(items.some(t => /10ml syringe/.test(t)) && items.some(t => /Examination gloves/.test(t)), JSON.stringify(items)); assert.ok(!items.some(t => /Cetirizine|Paracetamol/.test(t)), "only consumable items while the box is ticked");
  await f.locator("#cnOnly").uncheck(); assert.ok((await f.locator("#cnResults .cand").allInnerTexts()).some(t => /Cetirizine/.test(t)), "any stock item when unticked"); await f.locator("#cnSearch").fill("syr"); assert.equal(await f.locator("#cnResults .cand").count(), 1); await f.locator("#cnSearch").fill(""); await f.locator("#cnOnly").check();
  await f.locator('[data-cnpick="d6"]').click(); assert.match(await f.locator("#cnPicked").innerText(), /None in stock now[\s\S]*You can still send the request/);
  await f.locator('[data-cnpick="d5"]').click(); assert.match(await f.locator("#cnPicked").innerText(), /Selected: 10ml syringe[\s\S]*In stock: 40 piece[\s\S]*counted in: piece/);
  // validation: nothing is written for a missing, zero or negative quantity
  for (const q of ["", "0", "-2"]) { await f.locator("#cnQty").fill(q); await f.locator("#cnSaveBtn").click(); assert.match(await msg(f), /more than 0/, "quantity '" + q + "'"); }
  assert.equal((await P.batches()).length, 0, "nothing written yet"); await page.screenshot({ path: OUT + "/stageC-pharmacy-consumable-form-mobile.png" });
  assert.equal(await fr.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, "no sideways scroll at 390px");
  // save: ONE batch of three documents
  const stock0 = (await P.db("get", "drugs", "d5")).currentStockBase, txn0 = (await P.db("all", "stock_transactions")).length, rec0 = (await P.db("all", "dispense_records")).length;
  await f.locator("#cnQty").fill("3"); await f.locator("#cnNote").fill("for the dressing"); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(700);
  let b = await P.batches(); assert.equal(b.length, 1, "one batch"); assert.equal(b[0].length, 3); assert.deepEqual(b[0].map(x => x.split("/")[0]).sort(), ["pc_audit_logs", "pc_treatment_orders", "prescriptions"]);
  const oid = b[0].find(x => x.startsWith("pc_treatment_orders/")).split("/")[1], o = await P.db("get", "pc_treatment_orders", oid), rx = await P.db("get", "prescriptions", oid);
  assert.equal(o.kind, "consumable"); assert.equal(o.planId, "pl9b", "the plan that was chosen"); assert.equal(o.encounterId, "e9"); assert.equal(o.patientId, "p9"); assert.equal(o.medicineId, "d5"); assert.equal(o.quantityPrescribed, 3); assert.equal(o.quantityUnit, "piece"); assert.equal(o.instructions, "for the dressing");
  assert.equal(o.prescriberId, "owner1"); assert.equal(o.status, "active"); assert.equal(o.scheduleType, "once"); assert.equal(o.totalEvents, 0); assert.ok(!("administrationMode" in o)); assert.equal(o.createdBy, "owner1"); assert.equal(o.businessId, "biz1"); assert.equal(o.facilityId, "shop1");
  assert.equal(rx.id, oid); assert.equal(rx.status, "pending"); assert.equal(rx.qtyPrescribed, 3); assert.equal(rx.qtyOutstanding, 3); assert.equal(rx.qtyDispensed, 0); assert.equal(rx.drugId, "d5");
  const audit = (await P.db("all", "pc_audit_logs")).find(a => a.recordPath === "pc_treatment_orders/" + oid); assert.ok(audit, "audit record"); assert.equal(audit.action, "order.add"); assert.equal(audit.actorUid, "owner1"); assert.equal(audit.actorName, "Pharmacist Rex"); assert.equal(o.prescriberName, "Pharmacist Rex");
  // a request is NOT supply: no stock movement, no dispensing record, stock untouched
  assert.equal((await P.db("get", "drugs", "d5")).currentStockBase, stock0, "stock unchanged by a request"); assert.equal((await P.db("all", "stock_transactions")).length, txn0); assert.equal((await P.db("all", "dispense_records")).length, rec0);
  // the card closes, the user is told what happened and what is next; the request is in the queue under its patient
  assert.equal(await f.locator("#cnCard").evaluate(e => e.classList.contains("hidden")), true); assert.match(await f.locator("#cnDone").innerText(), /Consumable requested: 3 piece of 10ml syringe for Test Patient Nine[\s\S]*pending request[\s\S]*Nothing has been supplied yet/);
  await page.waitForTimeout(800); assert.match(await f.locator("#cnDone").innerText(), /Consumable requested: 3 piece/, "still there after the list re-drew"); assert.equal(await f.locator("#cnDone").isVisible(), true);
  assert.ok((await P.listed()).includes(oid), "the new request is in Waiting"); assert.equal((await P.listed()).length, waiting0 + 1);
  assert.equal(Number(((await f.locator('#filters [data-f="waiting"]').innerText()).match(/\((\d+)\)/) || [0, 0])[1]), w0n + 1, "the Waiting count rises by one");
  await f.locator('.pt[data-id="' + oid + '"]').click(); await f.locator("#actCard").waitFor(); assert.match(await f.locator("#actCard").innerText(), /10ml syringe/); await f.locator('#actCard [data-act="close"]').click();
  // a decimal quantity
  await f.locator("#cnOpenBtn").click(); await f.locator('[data-cnvisit="e10"]').click(); await f.locator('[data-cnpick="d5"]').click(); await f.locator("#cnQty").fill("0.5"); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(500);
  b = await P.batches(); const o2 = await P.db("get", "pc_treatment_orders", b[1].find(x => x.startsWith("pc_treatment_orders/")).split("/")[1]); assert.equal(o2.quantityPrescribed, 0.5); assert.equal(o2.planId, "pl10", "a single plan is chosen automatically");

  /* ================= shortcut from an open prescription: visit and plan are known ================= */
  await f.locator('#list .pt[data-id="c9"]').click(); await f.locator("#cPat").waitFor(); await f.locator('[data-act="addcons"]').click(); await f.locator("#cnVisitPicked").waitFor();
  assert.match(await f.locator("#cnVisitPicked").innerText(), /Test Patient Nine/); assert.equal(await f.locator("#cnPlan").inputValue(), "pl9", "the prescription's own plan is selected"); assert.equal(await visible(f, "#cnVisitList"), false, "no visit list: the visit is known");
  await f.locator('[data-cnpick="d5"]').click(); await f.locator("#cnQty").fill("2"); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(500);
  b = await P.batches(); assert.equal((await P.db("get", "pc_treatment_orders", b[2].find(x => x.startsWith("pc_treatment_orders/")).split("/")[1])).planId, "pl9");
  // a prescription of a CLOSED visit (its plan is still active): refused clearly, nothing to save
  await f.locator('#list .pt[data-id="c11"]').click(); await f.locator("#cPat").waitFor(); await f.locator('[data-act="addcons"]').click(); await page.waitForTimeout(400);
  assert.match(await msg(f), /This visit is closed[\s\S]*open visit/); assert.equal(await visible(f, "#cnSaveBtn"), false); const nb = (await P.batches()).length; await f.locator("#cnCancelBtn").click();

  /* ================= refusals ================= */
  // the server refuses (stand-in): clear message, nothing exists, the button works again
  await f.locator("#cnOpenBtn").click(); await f.locator('[data-cnvisit="e9"]').click(); await f.locator('[data-cnpick="d5"]').click(); await f.locator("#cnQty").fill("1");
  await P.page.evaluate(() => { window.__db.refuse = true; }); dialogs.length = 0; await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(600);
  assert.match(await msg(f), /^NOT SAVED\. You do not have permission to request this, or the visit has been closed or the plan has ended\./); assert.ok(dialogs.some(d => /^NOT SAVED/.test(d)), "an alert too, as on the visit page");
  assert.equal((await P.db("all", "pc_treatment_orders")).filter(x => x.quantityPrescribed === 1 && x.medicineId === "d5").length, 0, "nothing was created"); assert.equal(await f.locator("#cnSaveBtn").isDisabled(), false);
  await P.page.evaluate(() => { window.__db.refuse = false; });
  // after a refusal the form starts again from a clean visit chooser with the reason on top (no stale inputs)
  assert.equal(await f.locator("#cnCard").isVisible(), true); await f.locator("#cnVisitList .cand").first().waitFor(); assert.equal(await f.locator("#cnQty").inputValue(), ""); assert.equal(await visible(f, "#cnSaveBtn"), false); assert.match(await msg(f), /^NOT SAVED/);
  // the visit closes while the form is open: the rules refuse it, nothing is created
  await f.locator('[data-cnvisit="e9"]').click(); await f.locator('[data-cnpick="d5"]').click(); await f.locator("#cnQty").fill("1");
  await P.page.evaluate(() => { const v = window.__db.get("pc_encounters", "e9"); v.status = "closed"; window.__db.put("pc_encounters", "e9", v); }); dialogs.length = 0;
  await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(600); assert.match(await msg(f), /^NOT SAVED/); assert.ok(dialogs.some(d => /^NOT SAVED/.test(d))); assert.equal((await P.db("all", "pc_treatment_orders")).filter(x => x.encounterId === "e9" && x.quantityPrescribed === 1).length, 0);
  await P.page.evaluate(() => { const v = window.__db.get("pc_encounters", "e9"); v.status = "open"; window.__db.put("pc_encounters", "e9", v); }); await f.locator("#cnCancelBtn").click();
  // visits cannot be loaded (no connection, nothing cached): a clear message and a retry, no crash
  await P.page.evaluate(() => { window.__failQueries = true; }); await f.locator("#cnOpenBtn").click(); await f.locator("#cnRetry").waitFor(); assert.match(await f.locator("#cnVisitList").innerText(), /open visits could not be loaded/);
  await P.page.evaluate(() => { window.__failQueries = false; }); await f.locator("#cnRetry").click(); await f.locator("#cnVisitList .cand").first().waitFor(); assert.ok((await f.locator("#cnVisitList .cand").count()) >= 3, "loaded after retry"); await f.locator("#cnCancelBtn").click();

  // a user who may prescribe but has no patient access: the rules refuse the reads, and the message says exactly that (not "no connection")
  await P.page.evaluate(() => { window.__denyReads = true; }); await f.locator("#cnOpenBtn").click(); await f.locator("#cnVisitList .warn-box").waitFor(); assert.match(await f.locator("#cnVisitList").innerText(), /need patient access[\s\S]*Patient view permission/); assert.doesNotMatch(await f.locator("#cnVisitList").innerText(), /connection/); assert.equal(await f.locator("#cnRetry").count(), 0);
  await P.page.evaluate(() => { window.__denyReads = false; }); await f.locator("#cnCancelBtn").click(); await f.locator("#cnOpenBtn").click(); await f.locator("#cnVisitList .cand").first().waitFor(); await P.page.evaluate(() => { window.__denyReads = true; }); await f.locator('[data-cnvisit="e10"]').click(); await f.locator("#cnVisitPicked .warn-box").waitFor();
  assert.match(await f.locator("#cnVisitPicked").innerText(), /need patient access to see this patient's treatment plans/); assert.equal(await visible(f, "#cnSaveBtn"), false); await P.page.evaluate(() => { window.__denyReads = false; }); await f.locator("#cnCancelBtn").click();

  /* ================= offline: written on this phone at once; if the server refuses later, the request disappears and the user is told ================= */
  await P.ctx.setOffline(true); await f.locator("#cnOpenBtn").click(); await f.locator('[data-cnvisit="e10"]').click(); await f.locator('[data-cnpick="d5"]').click(); await f.locator("#cnQty").fill("4");
  await P.page.evaluate(() => { window.__db.hold = true; }); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(600);
  assert.match(await f.locator("#cnDone").innerText(), /Saved on this phone; it is sent when the connection returns/); let held = (await P.db("all", "pc_treatment_orders")).find(x => x.quantityPrescribed === 4 && x.medicineId === "d5"); assert.ok(held, "visible on this phone at once"); assert.ok((await P.listed()).includes(held._id), "and in this phone's queue");
  await P.ctx.setOffline(false); dialogs.length = 0; await P.page.evaluate(() => { window.__db.releaseBatches(false); }); await page.waitForTimeout(700);   // the server refuses when the connection returns
  assert.equal((await P.db("all", "pc_treatment_orders")).some(x => x.quantityPrescribed === 4 && x.medicineId === "d5"), false, "the refused request is gone"); assert.ok(!(await P.listed()).includes(held._id));
  assert.ok(dialogs.some(d => /^NOT SAVED/.test(d)), "the user is told"); assert.match(await msg(f), /^NOT SAVED/);
  await P.page.evaluate(() => { window.__db.hold = false; });
  // and the happy sync: accepted when the connection returns
  await f.locator("#cnCancelBtn").click(); await P.ctx.setOffline(true); await f.locator("#cnOpenBtn").click(); await f.locator('[data-cnvisit="e10"]').click(); await f.locator('[data-cnpick="d5"]').click(); await f.locator("#cnQty").fill("6");
  await P.page.evaluate(() => { window.__db.hold = true; }); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(500); await P.ctx.setOffline(false); dialogs.length = 0; await P.page.evaluate(() => { window.__db.releaseBatches(true); }); await page.waitForTimeout(500);
  assert.equal((await P.db("all", "pc_treatment_orders")).filter(x => x.quantityPrescribed === 6 && x.medicineId === "d5").length, 1, "accepted at sync: exactly one order"); assert.equal(dialogs.length, 0, "no alert when the server accepts");
  assert.equal((await P.db("get", "drugs", "d5")).currentStockBase, stock0, "no request ever moved stock");
  assert.equal(errors.length, 0, "no page errors: " + errors.join(" | "));
  await P.ctx.close(); await browser.close(); console.log("stage C: consumable request from the pharmacy: OK (stand-in rules, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
