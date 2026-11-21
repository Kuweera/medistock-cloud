/* Developer 3, Stage 2: pending prescription written with the order; STOP vs COMPLETE are different; plan end; change (new version).
   Real encounter.html in Chromium against an in-memory stand-in with a MIRROR of the prescription rules (not the real rules engine, not real Firebase).
   Run: python3 -m http.server 8765 (repo root), then node tests/stage2-prescription-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness-rx.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
    let promptText = "Patient had a rash", dialogs = [];
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => { dialogs.push(d.type() + ": " + d.message()); d.type() === "prompt" ? d.accept(promptText) : d.accept(); });
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(400);
    const all = c => page.evaluate(c => window.__db.all(c), c);
    const done = async () => (await f.locator("#doneMsg").innerText()).trim();
    const addMed = async (name, qty, mode) => {
      await f.locator('[data-t="treat"]').click(); await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
      await f.locator("#obType").selectOption("once"); await f.locator("#obMed").fill(name); await f.locator("#obDose").fill("1"); await f.locator("#obUnit").fill("tablet"); await f.locator("#obRoute").fill("by mouth");
      if (qty != null) await f.locator("#obQty").fill(String(qty));
      await f.locator("#obSaveBtn").click(); await page.waitForTimeout(500);
    };
    const expand = async id => { const b = f.locator('[data-oxp="' + id + '"]'); if ((await b.getAttribute("aria-expanded")) !== "true") await b.click(); };
    const orderId = async n => (await all("pc_treatment_orders")).find(o => o.medicineName === n)._id;
    const rx = async id => (await all("prescriptions")).find(r => r._id === id);

    // 1. A medicine order writes a PENDING prescription in the same batch (same id); quantity given
    await addMed("Amoxil", 20); let id = await orderId("Amoxil"), r = await rx(id);
    assert.ok(r, "prescription exists"); assert.equal(r.status, "pending"); assert.equal(r.qtyPrescribed, 20); assert.equal(r.qtyDispensed, 0); assert.equal(r.qtyOutstanding, 20); assert.equal(r.qtyUnknown, false);
    assert.equal(r.orderId, id); assert.equal(r.patientId, "p1"); assert.equal(r.encounterId, "e1"); assert.equal(r.planId, "pl1"); assert.equal(r.prescriberId, "owner1"); assert.equal(r.lastRequestId, null); assert.equal(r.qtySetBy, "prescriber");
    const b = await page.evaluate(() => window.__batches.filter(x => x.some(s => /pc_treatment_orders/.test(s))).pop()); assert.ok(b.some(s => s === "set prescriptions/" + id), "order and prescription are in ONE batch");
    assert.match(await done(), /pending prescription/); assert.match(await done(), /Nothing has been dispensed yet/);
    // 2. No quantity given: qtyUnknown, quantity 0, the pharmacy states it later
    await addMed("Zentel"); const idB = await orderId("Zentel"), rB = await rx(idB); assert.equal(rB.qtyUnknown, true); assert.equal(rB.qtyPrescribed, 0); assert.equal(rB.status, "pending");
    // 3. STOP needs a reason, cancels the undispensed prescription and says STOPPED
    promptText = ""; dialogs = []; await expand(id); await f.locator('[data-ostop="' + id + '"]').click(); await page.waitForTimeout(300);
    assert.equal((await all("pc_treatment_orders")).find(o => o._id === id).status, "active", "no reason: nothing changes");
    promptText = "Patient had a rash"; await expand(id); await f.locator('[data-ostop="' + id + '"]').click(); await page.waitForTimeout(500);
    let o = (await all("pc_treatment_orders")).find(x => x._id === id), r2 = await rx(id);
    assert.equal(o.status, "stopped"); assert.equal(o.endReason, "Patient had a rash"); assert.equal(o.endedBy, "owner1"); assert.equal(r2.status, "cancelled"); assert.equal(r2.endReason, "Patient had a rash"); assert.equal(r2.qtyDispensed, 0);
    const stopMsg = await done(); assert.match(stopMsg, /^STOPPED before the course finished/); assert.match(stopMsg, /pharmacy prescription is cancelled/); assert.doesNotMatch(stopMsg, /COMPLETED/);
    // 4. COMPLETE has a different message and states what it means; a single medicine does not complete the plan
    await expand(idB); await f.locator('[data-odone="' + idB + '"]').click(); await page.waitForTimeout(500);
    assert.ok(dialogs.some(m => /COMPLETED.*intended course has finished/s.test(m) && /does not complete the whole plan/.test(m) && /Nothing has been dispensed/.test(m)), "complete confirm text");
    const oB = (await all("pc_treatment_orders")).find(x => x._id === idB); assert.equal(oB.status, "completed"); assert.equal((await rx(idB)).status, "cancelled");
    const doneMsg = await done(); assert.match(doneMsg, /^COMPLETED, the course has finished/); assert.notEqual(doneMsg.split(".")[0], stopMsg.split(".")[0]);
    assert.equal((await all("pc_treatment_plans")).find(p => p._id === "pl1").status, "active", "plan still active");
    // 5. STOP after PARTIAL dispensing: the order stops, the prescription and dispensed quantity are kept, message says so
    await addMed("Cefix", 10); const idC = await orderId("Cefix");
    await page.evaluate(i => { const d = window.__db.all("prescriptions").find(x => x._id === i); delete d._id; Object.assign(d, { status: "partially_dispensed", qtyDispensed: 4, qtyOutstanding: 6, lastRequestId: "req1", qtyUnit: "Tablet" }); window.__db.add("prescriptions", i, d); }, idC);
    await page.waitForTimeout(300); promptText = "Allergic reaction"; await expand(idC); await f.locator('[data-ostop="' + idC + '"]').click(); await page.waitForTimeout(500);
    const rC = await rx(idC); assert.equal(rC.status, "partially_dispensed"); assert.equal(rC.qtyDispensed, 4); assert.equal((await all("pc_treatment_orders")).find(x => x._id === idC).status, "stopped");
    assert.match(await done(), /4 Tablet of 10 had already been dispensed/); assert.match(await done(), /stopped, do not dispense/);
    // 6. The pharmacy started dispensing in the meantime (server refuses the prescription update): the order is STILL stopped (retry without it)
    await addMed("Doxyfel", 8); const idD = await orderId("Doxyfel"); await page.evaluate(() => { window.__denyRxUpdate = true; });
    promptText = "Wrong drug"; await expand(idD); await f.locator('[data-ostop="' + idD + '"]').click(); await page.waitForTimeout(800);
    assert.equal((await all("pc_treatment_orders")).find(x => x._id === idD).status, "stopped"); assert.equal((await rx(idD)).status, "pending", "prescription left for the pharmacy");
    assert.match(await done(), /pharmacy had already started dispensing/); assert.ok(!/NOT SAVED/.test(await done())); await page.evaluate(() => { window.__denyRxUpdate = false; });
    // 7. CHANGE (new version): the old pending prescription is superseded, the new one is pending, one batch
    await addMed("Loratex", 6); const idE = await orderId("Loratex");
    await expand(idE); await f.locator('[data-ochg="' + idE + '"]').click(); await f.locator("#obCard:not(.hidden)").waitFor(); await f.locator("#obQty").fill("12"); await f.locator("#obChangeReason").fill("Dose too low"); await f.locator("#obSaveBtn").click(); await page.waitForTimeout(600);
    const orders = await all("pc_treatment_orders"), newE = orders.find(x => x.supersedes === idE); assert.ok(newE, "new version"); assert.equal(orders.find(x => x._id === idE).status, "superseded");
    assert.equal((await rx(idE)).status, "superseded"); assert.equal((await rx(idE)).supersededBy, newE._id); const rN = await rx(newE._id); assert.equal(rN.status, "pending"); assert.equal(rN.qtyPrescribed, 12);
    // 8. PLAN complete vs plan stop: different words, counts, undispensed prescriptions cancelled, dispensed kept
    await addMed("Metrozol", 5); const idF = await orderId("Metrozol");
    await f.locator('[data-pdone="pl1"]').first().click(); await page.waitForTimeout(600);
    assert.ok(dialogs.some(m => /Complete the whole plan/.test(m) && /NOT been dispensed yet/.test(m)), "plan complete confirm");
    assert.match(await done(), /^PLAN COMPLETED, the treatment has finished: TEST plan/); assert.match(await done(), /undispensed pharmacy prescription/); assert.match(await done(), /Nothing was deleted/);
    assert.equal((await all("pc_treatment_plans")).find(p => p._id === "pl1").status, "completed"); assert.equal((await rx(idF)).status, "cancelled");
    assert.equal((await all("pc_treatment_orders")).filter(x => x.status === "active").length, 0, "no order left active");
    assert.equal((await all("prescriptions")).find(x => x._id === idC).status, "partially_dispensed", "dispensed history untouched");
    assert.equal((await page.evaluate(() => window.__denied || [])).length, 1, "only the simulated refusal was denied");
    await page.screenshot({ path: OUT + "/stage2-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" });
    await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("STAGE 2 PRESCRIPTION CHECK PASSED (stand-in with mirrored rules, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
