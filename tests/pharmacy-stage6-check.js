/* Developer 3, Stage 6: a consumable request is supplied from the pharmacy queue through the SAME engine: stock (batches, drugs, stock_transactions), money
   (sales/receipts/credit), prescription status, partial supply and reversal. Real pharmacy.html in Chromium; in-memory stand-in (NOT real Firebase).
   Run: python3 -m http.server 8765 (repo root), node tests/pharmacy-stage6-check.js [folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept("Test reason"));
    await page.goto("http://localhost:8765/tests/harness-stage6.html"); const f = page.frameLocator("#f"); await f.locator("#list .rxgroup").first().waitFor(); await page.waitForTimeout(400);
    const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]);
    // 1. the consumable sits in the SAME visit header as the medicine, with a Consumable chip and its own status
    const head = await f.locator('#list .rxgroup:has(.pt[data-id="c9"])').innerText();
    assert.match(head, /Test Patient Nine/); assert.match(head, /2 items/); assert.match(head, /IV cannula 20G/); assert.match(head, /Paracetamol 500mg/); assert.equal((head.match(/Test Patient Nine/g) || []).length, 1);
    const line = await f.locator('#list .pt[data-id="c9"]').innerText(); assert.match(line, /Consumable/); assert.match(line, /Waiting/); assert.match(line, /5\s+PRESCRIBED/i); assert.doesNotMatch(line, /Dose:/);
    // 2. partial supply of 3 of 5 with a price: stock, batch, stock movement, sale and credit move once
    await f.locator('#list .pt[data-id="c9"]').click(); await f.locator("#cPat").waitFor(); await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator("#qDo").fill("3");
    await f.locator('#actCard [data-act="pay"][data-m="credit"]').click(); await f.locator('#actCard [data-act="confirm"]').click(); await f.locator("#actCard .recordtext").waitFor();
    let rx = await db("get", "prescriptions", "c9"); assert.equal(rx.status, "partially_dispensed"); assert.equal(rx.qtyDispensed, 3); assert.equal(rx.qtyOutstanding, 2); assert.equal(rx.drugId, "d9");
    assert.equal((await db("get", "drugs", "d9")).currentStockBase, 27); assert.equal((await db("get", "batches", "b9")).quantity, 27);
    const st = (await db("all", "stock_transactions")).filter(t => t.drugId === "d9"); assert.equal(st.length, 1); assert.equal(st[0].type, "DISPENSE"); assert.equal(st[0].baseUnitsChange, -3);
    const sales = (await db("all", "sales")).filter(x => x.patientId === "p9" || /cannula/i.test(JSON.stringify(x))); assert.equal(sales.length >= 1, true, "a sale is recorded through the existing path");
    assert.equal((await db("all", "dispense_records")).filter(r => r.prescriptionId === "c9").length, 1);
    const writes = await page.evaluate(() => Object.keys(window.__db.store).map(k => k.split("/")[0])); assert.ok(!writes.includes("pc_mar_records") && !writes.includes("pc_treatment_events"), "supplying a consumable is not an administration");
    assert.ok(!writes.includes("consumable_items") && !writes.includes("consumable_movements"), "the old consumable store is not touched");
    // 3. the queue now shows partly supplied with the outstanding quantity; the same header still holds the medicine
    await f.locator('#actCard [data-act="close"]').click(); await f.locator('#filters [data-f="partial"]').click(); await page.waitForTimeout(300);
    const t = await f.locator('#list .pt[data-id="c9"]').innerText(); assert.match(t, /Partly dispensed/); assert.match(t, /2\s+OUTSTANDING/i);
    // 4. supply the rest: completed; stock goes to 25; no duplicate movements
    await f.locator('#list .pt[data-id="c9"]').click(); await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator('#actCard [data-act="pay"][data-m="credit"]').click(); await f.locator('#actCard [data-act="confirm"]').click(); await f.locator("#actCard .recordtext").waitFor();
    rx = await db("get", "prescriptions", "c9"); assert.equal(rx.status, "completed"); assert.equal((await db("get", "drugs", "d9")).currentStockBase, 25); assert.equal((await db("all", "stock_transactions")).filter(t => t.drugId === "d9").length, 2);
    assert.equal(await f.locator("#list").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, vp.width + ": no sideways scroll");
    await page.screenshot({ path: OUT + "/stage6-pharmacy-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" });
    // 5. the old consumables tab is marked legacy
    await f.locator("#tabCons").click(); assert.match(await f.locator("#consUseCard").innerText(), /Legacy screen/);
    await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("PHARMACY STAGE 6 CHECK PASSED (stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
