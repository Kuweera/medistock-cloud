/* Developer 3, Stage 4: the treatment plan list in the real encounter.html: readable details per medicine, actions only when opened,
   pharmacy status as information. Chromium, in-memory stand-in (NOT real Firebase). Run: python3 -m http.server 8765 (repo root), node tests/stage4-treatment-ui-check.js [folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness-rx.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); let promptText = "Rash";
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.type() === "prompt" ? d.accept(promptText) : d.accept());
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(400);
    const all = c => page.evaluate(c => window.__db.all(c), c);
    await page.evaluate(() => { const p = window.__db.all("pc_treatment_plans").find(x => x._id === "pl1"); const id = p._id; delete p._id; p.careSetting = "inpatient"; window.__db.add("pc_treatment_plans", id, p); });
    await f.locator('[data-t="treat"]').click(); await page.waitForTimeout(300);
    await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
    await f.locator("#obType").selectOption("interval"); await f.locator("#obMed").fill("Amoxil"); await f.locator("#obStrength").fill("500 mg"); await f.locator("#obDose").fill("1"); await f.locator("#obUnit").fill("capsule"); await f.locator("#obRoute").fill("by mouth");
    await f.locator("#obEvery").fill("8"); await f.locator("#obCount").fill("6"); await f.locator("#obQty").fill("18"); await f.locator("#obSaveBtn").click(); await page.waitForTimeout(500);
    const id = (await all("pc_treatment_orders"))[0]._id, card = () => f.locator('.ord:has([data-oxp="' + id + '"])');
    // 1. every detail is readable on the main list without opening anything
    let t = await card().innerText();
    for (const w of [/Amoxil 500 mg/, /DOSE\s+1 capsule/i, /ROUTE\s+by mouth/i, /FREQUENCY\s+Every 8 hours, 6 doses/i, /DURATION\s+3 days/i, /STARTS\s+\d\d\/\d\d\/\d{4}/i, /ENDS\s+\d\d\/\d\d\/\d{4}/i, /CARE SETTING\s+Inpatient/i, /STATUS\s+Active/i, /At pharmacy: not dispensed yet/]) assert.match(t, w, String(w));
    // 2. actions are hidden until the medicine is opened
    for (const a of ["ostop", "odone", "ochg", "oplan", "oext"]) assert.equal(await f.locator("[data-" + a + "]").count(), 0, a + " hidden while collapsed");
    await f.locator('[data-oxp="' + id + '"]').click();
    for (const a of ["ostop", "odone", "ochg", "oplan"]) assert.equal(await f.locator("[data-" + a + '="' + id + '"]').count(), 1, a + " shown when opened");
    t = await card().innerText(); assert.match(t, /Stop \(discontinue early\)/); assert.match(t, /Complete \(course finished\)/); assert.match(t, /Planned 6 · written 6/); assert.match(t, /Sent to the pharmacy\. Nothing has been dispensed yet/); assert.match(t, /Dispensing is not the same as giving the dose/);
    await f.locator('[data-oplan="' + id + '"]').click(); assert.match(await card().innerText(), /Hide planned times/); assert.match(await card().innerText(), /Pending/);
    await f.locator('[data-oxp="' + id + '"]').click(); assert.equal(await f.locator("[data-ostop]").count(), 0, "collapsing hides the actions again");
    // 3. pharmacy status follows the prescription (information only)
    const setRx = patch => page.evaluate(([i, pt]) => { const d = window.__db.all("prescriptions").find(x => x._id === i); delete d._id; Object.assign(d, pt); window.__db.add("prescriptions", i, d); }, [id, patch]);
    await setRx({ status: "partially_dispensed", qtyDispensed: 4, qtyOutstanding: 14, qtyUnit: "Capsule" }); await page.waitForTimeout(300); assert.match(await card().innerText(), /Partly dispensed 4\/18/);
    await setRx({ status: "completed", qtyDispensed: 18, qtyOutstanding: 0 }); await page.waitForTimeout(300); assert.match(await card().innerText(), /Fully dispensed/);
    assert.equal((await all("pc_mar_records")).length, 0, "dispensing never creates an administration record");
    assert.equal((await all("pc_treatment_events")).filter(e => e.status === "administered").length, 0);
    // 4. a procedure shows type and responsible instead of dose and route
    await f.locator("[data-addproc]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor(); await f.locator("#obType").selectOption("once"); await f.locator("#obProc").fill("Wound dressing"); await f.locator("#obWho").fill("Nurse Joy"); await f.locator("#obSaveBtn").click(); await page.waitForTimeout(500);
    const pid = (await all("pc_treatment_orders")).find(o => o.kind === "procedure")._id; const pt = await f.locator('.ord:has([data-oxp="' + pid + '"])').innerText();
    assert.match(pt, /Wound dressing/); assert.match(pt, /RESPONSIBLE\s+Nurse Joy/i); assert.match(pt, /DURATION\s+Single dose/i); assert.doesNotMatch(pt, /ROUTE/i);
    // 5. a stopped order keeps its history readable and offers no stop/complete
    await f.locator('[data-oxp="' + id + '"]').click(); await setRx({ status: "pending", qtyDispensed: 0, qtyOutstanding: 18 }); await page.waitForTimeout(300);
    await f.locator('[data-ostop="' + id + '"]').click(); await page.waitForTimeout(500);
    t = await card().innerText(); assert.match(t, /STATUS\s+Stopped/i); assert.match(t, /ENDED\s+\d\d\/\d\d\/\d{4}/i); assert.match(t, /Stopped by Dr Owner: Rash/);
    assert.equal(await f.locator('[data-ostop="' + id + '"], [data-odone="' + id + '"], [data-ochg="' + id + '"]').count(), 0, "no stop/complete/change on an ended order");
    // 6. layout
    assert.equal(await f.locator("#planList").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, vp.width + ": no sideways scroll");
    await page.screenshot({ path: OUT + "/stage4-treatment-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" });
    await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("STAGE 4 TREATMENT UI CHECK PASSED (stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
