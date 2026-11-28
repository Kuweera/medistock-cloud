/* Developer 3, Stage D: close a TAKE-HOME-ONLY visit from the pharmacy (users with encounter.close), with the normal close write built by ONE shared function (PCD.closeVisitWrites).
   Also covers the visit page's own close, which had no browser test before this refactor. Real pages, headless Chromium at 390px, in-memory harnesses whose rules are STAND-INS written from the rules text
   (NOT the rules engine, NOT real Firebase). Run: python3 -m http.server 8765 (repo root), then node tests/stageD-close-visit-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict"), fs = require("node:fs");
const OUT = process.argv[2] || ".", PH = "http://localhost:8765/tests/harness-stage6.html", EH = "http://localhost:8765/tests/encounter-harness.html";
const ALLOWED = ["status", "closedAt", "closedBy", "closeNote", "cancelReason", "journey", "updatedAt", "updatedBy"];

for (const file of ["encounter.html", "pharmacy.html"]) {
  const src = fs.readFileSync(__dirname + "/../" + file, "utf8");
  assert.match(src, /PCD\.closeVisitWrites\(/, file + " uses the shared close builder");
  assert.doesNotMatch(src, /status: "closed", closedAt/, file + " must not build the close itself");
}

(async () => {
  const browser = await chromium.launch(), errors = [];
  // answer(n): say NO to the nth question of the next click (0 = say yes to all)
  async function open(url, state) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(), dialogs = []; let dismissAt = 0, seen = 0;
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => { dialogs.push(d.message()); seen++; if (seen === dismissAt) d.dismiss(); else d.accept("Test reason"); });
    await page.goto(url); const f = page.frameLocator("#f"); await page.waitForTimeout(900);
    return { ctx, page, f, dialogs, answer: n => { dismissAt = n; seen = 0; dialogs.length = 0; }, db: (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]), batches: () => page.evaluate(() => window.__batches || []) };
  }

  /* ================= the visit page's own close (refactored to the shared builder) ================= */
  { const p = await open(EH); const vf = p.f; await vf.locator("#mainArea:not(.hidden)").waitFor(); await vf.locator('[data-t="close"]').click();
    const before = (await p.db("all", "pc_encounters")).find(x => x._id === "e1"); assert.equal(before.status, "open"); const audits0 = (await p.db("all", "pc_audit_logs")).length;
    await vf.locator("#xNote").fill("  Treated and sent home  "); await vf.locator("#xCloseBtn").click(); await p.page.waitForTimeout(500);
    const after = (await p.db("all", "pc_encounters")).find(x => x._id === "e1");
    assert.equal(after.status, "closed"); assert.equal(after.closedBy, "owner1"); assert.equal(after.closeNote, "Treated and sent home", "note trimmed"); assert.equal(after.updatedBy, "owner1"); assert.ok(after.closedAt && after.updatedAt, "server times set");
    const changed = Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])); assert.ok(changed.length > 0 && changed.every(k => ALLOWED.indexOf(k) >= 0), "only allowed keys changed: " + changed.join(","));
    const audits = await p.db("all", "pc_audit_logs"); assert.equal(audits.length, audits0 + 1); const a = audits[audits.length - 1]; assert.equal(a.action, "encounter.close"); assert.equal(a.recordPath, "pc_encounters/e1"); assert.equal(a.actorUid, "owner1"); assert.equal(a.encounterId, "e1"); assert.equal(a.patientId, before.patientId);
    assert.match(await vf.locator("body").innerText(), /Visit closed on this phone\./); await p.ctx.close(); }

  /* ================= the pharmacy: who sees the button ================= */
  for (const as of ["pharm", "pharmrx"]) { const p = await open(PH + "?as=" + as); await p.f.locator("#list .rxgroup").first().waitFor(); await p.f.locator('#filters [data-f="done"]').click(); await p.page.waitForTimeout(400);
    assert.equal(await p.f.locator("[data-closevisit]").count(), 0, as + ": no Close visit button without encounter.close"); await p.ctx.close(); }

  const P = await open(PH + "?as=pharmclose"), f = P.f, page = P.page; await f.locator("#list .rxgroup").first().waitFor();
  const tab = async k => { await f.locator('#filters [data-f="' + k + '"]').click(); await page.waitForTimeout(500); };
  const btn = e => f.locator('[data-closevisit="' + e + '"]'); const msgOf = async sel => (await f.locator(sel).innerText()).replace(/\s+/g, " ").trim();
  // the quick look: take-home / consumable only
  await tab("done");
  assert.ok(await btn("e30").count() >= 1, "V-30: every item take-home: button"); assert.equal(await btn("e33").count(), 0, "V-33 has a facility-given medicine in view: no button"); assert.equal(await btn("e34").count(), 0, "V-34 an older order with no care mode: no button");
  assert.ok(await btn("e32").count() >= 1, "V-32 looks take-home from here (its procedure is not loaded in the pharmacy): the real check decides"); assert.ok(await btn("e35").count() >= 1, "V-35 (closed) cannot be told apart from here: the real check decides");

  /* ---- the happy path: V-30, everything supplied ---- */
  const stock0 = JSON.stringify((await P.db("all", "drugs")).map(d => [d._id, d.currentStockBase])), txn0 = (await P.db("all", "stock_transactions")).length, rec0 = (await P.db("all", "dispense_records")).length;
  await btn("e30").first().click(); await f.locator("#clGo").waitFor();
  const t30 = await msgOf("#clBody"); assert.match(t30, /Test Patient Thirty[\s\S]*V-30/); assert.match(t30, /take-home medicines and supplies only/); assert.match(t30, /Amoxicillin 500mg · Fully supplied/); assert.match(t30, /Cetirizine 10mg · Fully supplied/); assert.equal(await f.locator("#clBody .warn-box").count(), 0, "nothing to warn about");
  await f.locator("#clNote").fill("  Medicines collected  "); P.answer(0); await f.locator("#clGo").click(); await page.waitForTimeout(600); assert.equal(P.dialogs.length, 0, "no questions when there is nothing outstanding");
  let b = await P.batches(); assert.equal(b.length, 1, "one batch"); assert.deepEqual(b[0].map(x => x.split("/")[0]).sort(), ["pc_audit_logs", "pc_encounters"]); assert.ok(b[0].includes("pc_encounters/e30"));
  const e30 = await P.db("get", "pc_encounters", "e30"); assert.equal(e30.status, "closed"); assert.equal(e30.closedBy, "owner1"); assert.equal(e30.closeNote, "Medicines collected"); assert.equal(e30.updatedBy, "owner1"); assert.ok(e30.closedAt && e30.updatedAt);
  assert.equal(e30.patientName, "Test Patient Thirty", "the rest of the visit is untouched"); assert.equal(e30.type, "pharmacy"); assert.equal(e30.stage, "in_consultation");
  const au = (await P.db("all", "pc_audit_logs")).find(a => a.recordPath === "pc_encounters/e30"); assert.ok(au); assert.equal(au.action, "encounter.close"); assert.equal(au.actorName, "Pharmacist Cleo"); assert.equal(au.actorUid, "owner1"); assert.equal(au.patientId, "p30"); assert.equal(au.encounterId, "e30");
  // closing is not dispensing, and not completing the plan or the orders
  assert.equal(JSON.stringify((await P.db("all", "drugs")).map(d => [d._id, d.currentStockBase])), stock0, "stock untouched"); assert.equal((await P.db("all", "stock_transactions")).length, txn0); assert.equal((await P.db("all", "dispense_records")).length, rec0);
  assert.equal((await P.db("get", "pc_treatment_plans", "ple30")).status, "active", "the plan is NOT changed (it may continue over later visits)"); assert.equal((await P.db("get", "pc_treatment_orders", "t30a")).status, "active"); assert.equal((await P.db("get", "prescriptions", "t30a")).status, "completed");
  assert.equal(await f.locator("#clCard").evaluate(e => e.classList.contains("hidden")), true); assert.match(await msgOf("#clDone"), /^Visit V-30 closed for Test Patient Thirty\.$/); assert.equal(await btn("e30").count(), 0, "its button is gone at once");

  /* ---- outstanding items, a draft note and a test with no verified result: the same questions as the visit page ---- */
  await tab("waiting"); await btn("e31").first().click(); await f.locator("#clGo").waitFor();
  const t31 = await msgOf("#clBody"); assert.match(t31, /Amoxicillin 500mg · Partly supplied: 4 Tablet not supplied/); assert.match(t31, /Cetirizine 10mg · Not supplied yet: 10 Tablet not supplied/); assert.match(t31, /2 item\(s\) are not fully supplied\. They stay in the pharmacy queue\./); assert.match(t31, /1 note\(s\) are still drafts\./); assert.match(t31, /1 test\(s\) have no verified result yet\. The laboratory can still finish them\./, "a verified test is not counted");
  await page.screenshot({ path: OUT + "/stageD-pharmacy-close-visit-mobile.png" });
  const fr = await (await page.locator("#f").elementHandle()).contentFrame(); assert.equal(await fr.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, "no sideways scroll at 390px");
  // saying NO to any one of the three questions writes nothing and keeps the card open
  const nb = (await P.batches()).length;
  for (const n of [1, 2, 3]) { P.answer(n); await f.locator("#clGo").click(); await page.waitForTimeout(300); assert.equal(P.dialogs.length, n, "stopped at question " + n); assert.equal((await P.batches()).length, nb, "nothing written after saying no to question " + n); assert.equal(await f.locator("#clGo").count(), 1, "the card is still open"); }
  P.answer(0); await f.locator("#clGo").click(); await page.waitForTimeout(600);
  assert.deepEqual(P.dialogs.map(d => d.replace(/^\d+ /, "")), ["note(s) are still drafts. Close the visit anyway?", "test(s) have no verified result yet. Close the visit anyway? The laboratory can still finish them.", "item(s) are not fully supplied. Close the visit anyway? They stay in the pharmacy queue."], "the three questions, in this order, all accepted");
  b = await P.batches(); assert.equal(b.length, nb + 1, "closed after all three were accepted"); const e31 = await P.db("get", "pc_encounters", "e31"); assert.equal(e31.status, "closed"); assert.equal(e31.closeNote, "", "no note: an empty string, as the visit page does");
  assert.equal((await P.db("get", "prescriptions", "t31a")).status, "partially_dispensed", "the prescriptions are untouched: they stay in the queue"); assert.equal((await P.db("get", "prescriptions", "t31b")).qtyOutstanding, 10);

  /* ---- a visit that needs staff: the pharmacy does not close it ---- */
  await tab("done"); await btn("e32").first().click(); await f.locator("#clCancel").waitFor(); const t32 = await msgOf("#clBody");
  assert.match(t32, /still has treatment that staff give: Wound dressing\. It cannot be closed from the pharmacy\. It is closed from the visit\./); assert.equal(await f.locator("#clGo").count(), 0, "no close button");
  const nb2 = (await P.batches()).length; await f.locator("[data-clopenvisit]").click(); assert.equal(await page.evaluate(() => location.hash), "#encounter.html?id=e32&tab=close", "the address link to the visit's Close tab"); assert.equal((await P.batches()).length, nb2); await f.locator("#clCancel").click();
  // already closed
  await btn("e35").first().click(); await f.locator("#clCancel").waitFor(); assert.match(await msgOf("#clBody"), /This visit is already closed\./); assert.equal(await f.locator("#clGo").count(), 0); await f.locator("#clCancel").click();

  /* ---- refusals: a visit closed by someone else meanwhile, a server refusal ---- */
  await btn("e36").first().click(); await f.locator("#clGo").waitFor();
  await page.evaluate(() => { const v = window.__db.get("pc_encounters", "e36"); v.status = "closed"; v.closeNote = "closed by another user"; window.__db.put("pc_encounters", "e36", v); }); P.dialogs.length = 0;
  await f.locator("#clGo").click(); await page.waitForTimeout(600); assert.match(await msgOf("#clDone"), /^NOT SAVED\. You do not have permission to close this visit, or it has already been closed\./); assert.ok(P.dialogs.some(d => /^NOT SAVED/.test(d)));
  assert.equal((await P.db("get", "pc_encounters", "e36")).closeNote, "closed by another user", "the other user's close is not overwritten"); assert.ok(await btn("e36").count() >= 1, "the button is back after a refusal");
  await page.evaluate(() => { const v = window.__db.get("pc_encounters", "e36"); v.status = "open"; v.closeNote = undefined; window.__db.put("pc_encounters", "e36", v); window.__db.refuse = true; });
  await btn("e36").first().click(); await f.locator("#clGo").waitFor(); P.dialogs.length = 0; await f.locator("#clGo").click(); await page.waitForTimeout(600); assert.match(await msgOf("#clDone"), /^NOT SAVED\./); assert.equal((await P.db("get", "pc_encounters", "e36")).status, "open", "still open"); await page.evaluate(() => { window.__db.refuse = false; });
  // cannot be checked (no connection, nothing cached) / no patient access
  await page.evaluate(() => { window.__failQueries = true; }); await btn("e36").first().click(); await f.locator("[data-closevisit]", { hasText: "Try again" }).waitFor(); assert.match(await msgOf("#clBody"), /could not be checked \(no connection and nothing saved on this phone\)/); assert.equal(await f.locator("#clGo").count(), 0);
  await page.evaluate(() => { window.__failQueries = false; }); await f.locator("[data-closevisit]", { hasText: "Try again" }).click(); await f.locator("#clGo").waitFor(); await f.locator("#clCancel").click();
  await page.evaluate(() => { window.__denyReads = true; }); await btn("e36").first().click(); await f.locator("#clBody .warn-box").waitFor(); assert.match(await msgOf("#clBody"), /You need patient access to check this visit[\s\S]*Patient view permission/); assert.doesNotMatch(await msgOf("#clBody"), /connection/); assert.equal(await f.locator("#clGo").count(), 0); await page.evaluate(() => { window.__denyReads = false; }); await f.locator("#clCancel").click();

  /* ---- offline: closed on this phone at once; refused at sync -> it is open again and the user is told; accepted at sync -> closed once ---- */
  await P.ctx.setOffline(true); await btn("e36").first().click(); await f.locator("#clGo").waitFor(); await page.evaluate(() => { window.__db.hold = true; }); await f.locator("#clGo").click(); await page.waitForTimeout(500);
  assert.match(await msgOf("#clDone"), /Closed on this phone; it is sent when the connection returns/); assert.equal((await P.db("get", "pc_encounters", "e36")).status, "closed", "closed on this phone at once"); assert.equal(await btn("e36").count(), 0);
  await P.ctx.setOffline(false); P.dialogs.length = 0; await page.evaluate(() => { window.__db.releaseBatches(false); }); await page.waitForTimeout(600);
  assert.equal((await P.db("get", "pc_encounters", "e36")).status, "open", "refused at sync: the visit is open again"); assert.ok(P.dialogs.some(d => /^NOT SAVED/.test(d)), "the user is told"); assert.ok(await btn("e36").count() >= 1, "and can try again"); await page.evaluate(() => { window.__db.hold = false; });
  await P.ctx.setOffline(true); await btn("e36").first().click(); await f.locator("#clGo").waitFor(); await page.evaluate(() => { window.__db.hold = true; }); await f.locator("#clGo").click(); await page.waitForTimeout(400); await P.ctx.setOffline(false); P.dialogs.length = 0;
  const auditsBefore = (await P.db("all", "pc_audit_logs")).filter(a => a.recordPath === "pc_encounters/e36").length; await page.evaluate(() => { window.__db.releaseBatches(true); }); await page.waitForTimeout(500);
  assert.equal((await P.db("get", "pc_encounters", "e36")).status, "closed"); assert.equal(P.dialogs.length, 0, "no alert when the server accepts"); assert.equal((await P.db("all", "pc_audit_logs")).filter(a => a.recordPath === "pc_encounters/e36").length, auditsBefore, "the audit record was written once, with the close");
  assert.equal(errors.length, 0, "no page errors: " + errors.join(" | "));
  await P.ctx.close(); await browser.close(); console.log("stage D: close a take-home visit from the pharmacy: OK (stand-in rules, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
