/* Developer 3, Stage 6: the clinician requests a consumable FROM THE MAIN STOCK LIST in the real encounter.html. Chromium, in-memory stand-in with a mirror of
   the v23 consumable rules (NOT the real rules engine, NOT real Firebase). Run: python3 -m http.server 8765 (repo root); node tests/stage6-consumable-check.js [folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness-rx.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); let promptText = "Not needed";
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.type() === "prompt" ? d.accept(promptText) : d.accept());
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(400);
    const all = c => page.evaluate(c => window.__db.all(c), c); const msg = async () => (await f.locator("#cnMsg").innerText()).trim(); const done = async () => (await f.locator("#doneMsg").innerText()).trim();
    await f.locator('[data-t="treat"]').click(); await page.waitForTimeout(300);
    // 1. search works like selling: name, generic, class; "only consumables" filter
    await f.locator("[data-addcons]").first().click(); await f.locator("#cnCard:not(.hidden)").waitFor();
    assert.equal(await f.locator("#cnOnly").isChecked(), true, "starts on consumables because the stock list has some");
    let t = await f.locator("#cnResults").innerText(); assert.match(t, /IV cannula 20G/); assert.match(t, /In stock: 40 Piece/); assert.match(t, /Gauze swab/); assert.match(t, /None in stock now/); assert.doesNotMatch(t, /Paracetamol/);
    await f.locator("#cnOnly").uncheck(); await f.locator("#cnSearch").fill("paracetamol"); t = await f.locator("#cnResults").innerText(); assert.match(t, /Paracetamol 500mg/); assert.doesNotMatch(t, /cannula/);
    await f.locator("#cnSearch").fill("first aid"); await f.locator("#cnOnly").uncheck(); t = await f.locator("#cnResults").innerText(); assert.match(t, /cannula/, "searching by class works");
    // 2. validation: nothing picked, then no quantity
    await f.locator("#cnSearch").fill(""); await f.locator("#cnSaveBtn").click(); assert.match(await msg(), /Pick an item from your stock/);
    await f.locator('#cnResults [data-cnpick="sd1"]').click(); assert.match(await f.locator("#cnPicked").innerText(), /Selected: IV cannula 20G/); await f.locator("#cnSaveBtn").click(); assert.match(await msg(), /Enter how many/);
    // 3. send: ONE batch = consumable order + pending prescription; no dose events; the item is the stock item
    await f.locator("#cnQty").fill("2"); await f.locator("#cnNote").fill("For the drip"); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(500);
    const o = (await all("pc_treatment_orders")).find(x => x.kind === "consumable"), rx = (await all("prescriptions")).find(x => x._id === o._id);
    assert.equal(o.medicineId, "sd1"); assert.equal(o.medicineName, "IV cannula 20G"); assert.equal(o.quantityPrescribed, 2); assert.equal(o.scheduleType, "once"); assert.equal(o.totalEvents, 0); assert.equal(o.status, "active"); assert.equal(o.prescriberId, "owner1"); assert.equal(o.instructions, "For the drip");
    assert.equal((await all("pc_treatment_events")).filter(e => e.orderId === o._id).length, 0); assert.equal(rx.status, "pending"); assert.equal(rx.drugId, "sd1"); assert.equal(rx.qtyPrescribed, 2); assert.equal(rx.qtyUnit, "Piece"); assert.equal(rx.lastRequestId, null);
    const b = await page.evaluate(() => window.__batches.filter(x => x.some(s => /pc_treatment_orders/.test(s))).pop()); assert.ok(b.includes("set prescriptions/" + o._id), "order and prescription in one batch");
    assert.equal((await all("consumable_items")).length, 0, "the old consumable store is not used"); assert.match(await done(), /Consumable requested: 2 Piece of IV cannula 20G/); assert.match(await done(), /Nothing has been supplied yet/);
    // 4. the plan line: item, quantity, consumable chip, supply status; opening it offers only Cancel
    const card = f.locator('.ord:has([data-oxp="' + o._id + '"])'); t = await card.innerText(); assert.match(t, /Consumable/); assert.match(t, /ITEM\s+IV cannula 20G/i); assert.match(t, /QUANTITY\s+2 Piece/i); assert.match(t, /At supplies: not issued yet/);
    await f.locator('[data-oxp="' + o._id + '"]').click(); assert.equal(await f.locator('[data-ostop="' + o._id + '"]').count(), 1); assert.match(await card.innerText(), /Cancel request \(not needed\)/);
    for (const a of ["ochg", "odone", "oplan", "oext"]) assert.equal(await f.locator("[data-" + a + '="' + o._id + '"]').count(), 0, a + " does not apply to a consumable");
    // 5. out of stock can still be requested (the supplier sees the stock); partly supplied status is shown
    await f.locator("[data-addcons]").first().click(); await f.locator('#cnResults [data-cnpick="sd2"]').click(); assert.match(await f.locator("#cnPicked").innerText(), /You can still send the request/); await f.locator("#cnQty").fill("1"); await f.locator("#cnSaveBtn").click(); await page.waitForTimeout(400);
    await page.evaluate(i => { const d = window.__db.all("prescriptions").find(x => x._id === i); delete d._id; Object.assign(d, { status: "partially_dispensed", qtyDispensed: 1, qtyOutstanding: 1 }); window.__db.add("prescriptions", i, d); }, o._id); await page.waitForTimeout(300);
    assert.match(await card.innerText(), /Partly supplied 1\/2/);
    // 6. cancel while partly supplied: the order is cancelled, the supplied quantity and prescription are kept
    promptText = "Patient went home"; await f.locator('[data-ostop="' + o._id + '"]').click(); await page.waitForTimeout(500);
    const o2 = (await all("pc_treatment_orders")).find(x => x._id === o._id); assert.equal(o2.status, "stopped"); assert.equal(o2.endReason, "Patient went home"); assert.equal((await all("prescriptions")).find(x => x._id === o._id).status, "partially_dispensed");
    assert.match(await done(), /^CANCELLED, no longer needed: IV cannula 20G/); assert.match(await done(), /1 Piece of 2 had already been dispensed/);
    // 7. cancelling an unsupplied request cancels its pending prescription
    const o3 = (await all("pc_treatment_orders")).find(x => x.kind === "consumable" && x.medicineId === "sd2"); await f.locator('[data-oxp="' + o3._id + '"]').click(); await f.locator('[data-ostop="' + o3._id + '"]').click(); await page.waitForTimeout(500);
    assert.equal((await all("pc_treatment_orders")).find(x => x._id === o3._id).status, "stopped"); assert.equal((await all("prescriptions")).find(x => x._id === o3._id).status, "cancelled"); assert.match(await done(), /pharmacy prescription is cancelled/);
    // 8. mirrored rules never refused a write; layout
    assert.deepEqual(await page.evaluate(() => window.__denied || []), [], "no write refused by the mirrored v23 rules");
    await f.locator("[data-addcons]").first().click(); await f.locator("#cnCard:not(.hidden)").waitFor(); assert.equal(await f.locator("#cnCard").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, vp.width + ": consumable form fits");
    await page.screenshot({ path: OUT + "/stage6-consumable-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" }); await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("STAGE 6 CONSUMABLE CHECK PASSED (stand-in with mirrored v23 rules, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
