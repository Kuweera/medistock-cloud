/* Drives pharmacy.html in headless Chromium against the in-memory harness.  Run:  node tests/browser-check.js  (needs the repo served on :8765) */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", d => d.accept("Test reason"));
  await page.goto("http://localhost:8765/tests/harness.html");
  const f = page.frameLocator("#f");
  await f.locator("#list .pt").first().waitFor();
  const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]);
  // queue shows waiting items with patient, reg no, medicine, quantities
  const text = await f.locator("#list").innerText();
  assert.match(text, /Test Patient One/); assert.match(text, /P-O-1/); assert.match(text, /Paracetamol 500mg/); assert.match(text, /prescribed/i); assert.match(text, /outstanding/i);
  assert.match(text, /ALLERGY/, "allergy chip for patient two"); assert.match(text, /Not linked to stock list/); assert.match(text, /No quantity stated/);
  assert.equal((text.match(/Test Patient One/g) || []).length, 1, "the stopped order is not in the waiting list");
  await page.screenshot({ path: OUT + "/01-queue-mobile.png" });
  // open order 1
  await f.locator('#list .pt[data-id="o1"]').click();
  await f.locator("#actCard .step").first().waitFor();
  const dis = await f.locator('#actCard [data-act="confirm"]').isDisabled(); assert.equal(dis, true, "confirm disabled until confirmations ticked");
  const act = await f.locator("#actCard").innerText();
  assert.match(act, /P-SOON/); assert.match(act, /expired and cannot be dispensed/); assert.doesNotMatch(act, /P-OLD/, "expired batch is never offered");
  await f.locator("#cPat").check(); await f.locator("#cMed").check();
  await f.locator("#qDo").fill("20");          // 32 usable (12 + 20): FEFO spans two batches
  assert.equal(await f.locator('#actCard [data-act="confirm"]').isDisabled(), true, "confirm needs a payment choice (but any choice, including credit, is allowed)");
  assert.equal(await f.locator("#fPrice").inputValue(), "30", "price defaults to the Sales retail price");
  assert.match(await f.locator("#actCard").innerText(), /Selling prices \(as in Sales\): 30 per Tablet · 300 per Strip · 3,000 per Packet/);
  await f.locator('#actCard [data-act="pay"][data-m="part"]').click(); await f.locator("#fPaid").fill("200");
  assert.match(await f.locator("#actCard").innerText(), /600\s*Total value/i);
  assert.match(await f.locator("#actCard").innerText(), /400[\s\S]*Outstanding \(credit\)/i);
  await page.screenshot({ path: OUT + "/02-dispense-mobile.png", fullPage: true });
  await f.locator('#actCard [data-act="confirm"]').click();
  await f.locator("#actCard .recordtext").waitFor();
  assert.match(await f.locator("#actCard").innerText(), /Confirmed by the server/);
  const ct = await db("all", "credit_transactions"); assert.equal(ct.length, 1); assert.equal(ct[0].balanceChange, 400); assert.equal(ct[0].type, "CREDIT_SALE");
  assert.deepEqual((await db("all", "receipts")).map(r => r.paymentStatus).sort(), ["CREDIT", "PAID"]);
  assert.match(await f.locator("#actCard").innerText(), /Outstanding \(credit\): 400/);
  let rx = await db("get", "prescriptions", "o1"); assert.equal(rx.qtyDispensed, 20); assert.equal(rx.status, "completed");
  assert.equal((await db("get", "batches", "b2")).quantity, 0); assert.equal((await db("get", "batches", "b3")).quantity, 12); assert.equal((await db("get", "batches", "b1")).quantity, 10, "expired batch untouched");
  assert.equal((await db("get", "drugs", "d1")).currentStockBase, 22);
  const writes = await page.evaluate(() => Object.keys(window.__db.store).map(k => k.split("/")[0]));
  assert.ok(!writes.includes("pc_mar_records") && !writes.includes("pc_treatment_events"), "no administration records written");
  await page.screenshot({ path: OUT + "/03-record-mobile.png", fullPage: true });
  await f.locator('#actCard [data-act="close"]').click();
  // fully dispensed filter shows it
  await f.locator('#filters [data-f="done"]').click();
  await page.waitForTimeout(300);
  assert.match(await f.locator("#list").innerText(), /Test Patient One/);
  // stopped filter shows order 3
  await f.locator('#filters [data-f="stopped"]').click(); await page.waitForTimeout(300);
  assert.match(await f.locator("#list").innerText(), /Stopped/);
  await f.locator('#list .pt[data-id="o3"]').click();
  assert.match(await f.locator("#actCard").innerText(), /cannot be dispensed/);
  await f.locator('#actCard [data-act="close"]').click();
  // order 2: not linked, no quantity; pharmacist picks the exact stock item
  await f.locator('#filters [data-f="waiting"]').click();
  await f.locator('#list .pt[data-id="o2"]').click();
  assert.match(await f.locator("#actCard").innerText(), /Allergy warning/);
  assert.match(await f.locator("#actCard").innerText(), /not linked to your stock list/);
  await f.locator('#actCard [data-act="pickdrug"][data-d="d3"]').click();
  await f.locator("#qOver").waitFor(); await f.locator("#qOver").fill("30");
  await f.locator("#cPat").check(); await f.locator("#cMed").check();
  await f.locator("#qDo").fill("12"); await f.locator("#fPrice").fill("100");
  await f.locator('#actCard [data-act="pay"][data-m="credit"]').click();
  assert.match(await f.locator("#actCard").innerText(), /Partial dispensing: 12 now, 18 will stay outstanding/);
  await page.screenshot({ path: OUT + "/04-partial-mobile.png", fullPage: true });
  await f.locator('#actCard [data-act="confirm"]').click();
  await f.locator("#actCard .recordtext").waitFor();
  rx = await db("get", "prescriptions", "o2"); assert.equal(rx.qtyDispensed, 12); assert.equal(rx.qtyOutstanding, 18); assert.equal(rx.status, "partially_dispensed"); assert.equal(rx.qtySetBy, "pharmacist"); assert.equal(rx.drugLinkedBy, "pharmacist");
  await f.locator('#actCard [data-act="close"]').click();
  await f.locator('#filters [data-f="partial"]').click(); await page.waitForTimeout(300);
  assert.match(await f.locator("#list").innerText(), /Test Patient Two/); assert.match(await f.locator("#list").innerText(), /18/);
  // OFFLINE: second dispensing of the same prescription, saved as pending, not deducted; then reconnect
  await f.locator('#list .pt[data-id="o2"]').click();
  await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator("#qDo").fill("8"); await f.locator("#fPrice").fill("100");
  await f.locator('#actCard [data-act="pay"][data-m="credit"]').click();
  await ctx.setOffline(true); await page.waitForTimeout(200);
  assert.match(await f.locator("#actCard").innerText(), /PENDING SYNC/);
  await f.locator('#actCard [data-act="confirm"]').click();
  await f.locator("#actCard .recordtext").waitFor();
  assert.match(await f.locator("#actCard").innerText(), /PENDING SYNC/); assert.match(await f.locator("#actCard").innerText(), /has\s+not\s+confirmed this yet/i);
  assert.equal((await db("get", "drugs", "d3")).currentStockBase, 18, "offline item has NOT deducted stock");
  assert.equal((await db("get", "prescriptions", "o2")).qtyDispensed, 12);
  await page.screenshot({ path: OUT + "/05-pending-mobile.png", fullPage: true });
  await f.locator('#actCard [data-act="close"]').click();
  assert.match(await f.locator("#syncText").innerText(), /1\s*dispensing waiting/);
  await ctx.setOffline(false);
  await page.waitForFunction(() => window.__db.get("prescriptions", "o2").qtyDispensed === 20, null, { timeout: 15000 });
  assert.equal((await db("get", "drugs", "d3")).currentStockBase, 10);
  assert.equal(await f.locator("#syncCard").isVisible(), false, "sync box empties after confirmation");
  const recs = await db("all", "dispense_records"); assert.ok(recs.some(r => r.source === "offline_replay" && r.isSynced === true));
  assert.equal((await db("all", "credit_transactions")).filter(t => t.type === "CREDIT_SALE").length, 3, "queued dispensing also recorded its credit when it synced, exactly once");
  // INJECTION: not handed over, on credit, then reversed because it was not given
  await f.locator('#filters [data-f="waiting"]').click(); await page.waitForTimeout(300);
  await f.locator('#list .pt[data-id="o4"]').click();
  assert.equal(await f.locator("#cHand").isChecked(), false, "injection defaults to NOT handed over");
  await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator('#actCard [data-act="pay"][data-m="credit"]').click();
  await f.locator('#actCard [data-act="confirm"]').click(); await f.locator("#actCard .recordtext").waitFor();
  await f.locator('#actCard [data-act="close"]').click();
  await f.locator('#filters [data-f="done"]').click(); await page.waitForTimeout(400);
  await f.locator('#list .pt[data-id="o4"]').click();
  await f.locator('#actCard [data-rv="qty"]').waitFor();
  await f.locator('#actCard [data-rv="qty"]').fill("3"); await f.locator('#actCard [data-rv="reason"]').fill("Patient declined"); await f.locator("#cBack").check();
  await page.screenshot({ path: OUT + "/09-reverse-mobile.png", fullPage: true });
  await f.locator('#actCard [data-act="reverse"]').click();
  await page.waitForFunction(() => window.__db.get("prescriptions", "o4").qtyDispensed === 1, null, { timeout: 10000 });
  assert.equal((await db("get", "drugs", "d4")).currentStockBase, 9); assert.equal((await db("get", "batches", "b5")).quantity, 9);
  assert.equal((await db("all", "dispense_returns")).length, 1);
  assert.match(await f.locator("#actCard").innerText(), /Credit reduced by 3,000/);
  // hand over the rest: it can no longer be reversed
  await f.locator('#actCard [data-act="handover"]').click(); await page.waitForTimeout(300);
  assert.match(await f.locator("#actCard").innerText(), /Handed over — cannot reverse/);
  await f.locator('#actCard [data-act="close"]').click();
  // consumables are selected, not fixed
  await f.locator('#tabs [data-t="cons"]').click(); await f.locator("#consUseCard table").waitFor();
  await f.locator('[data-cx="bundle"]').click();
  assert.equal(await f.locator('[data-cq="con_syr"]').inputValue(), "1"); await f.locator('[data-cq="con_glv"]').fill("");
  await f.locator('[data-cx="use"]').click(); await page.waitForFunction(() => window.__db.get("consumable_items", "con_syr").qtyOnHand === 19, null, { timeout: 8000 });
  assert.equal((await db("get", "consumable_items", "con_glv")).qtyOnHand, 2, "an item that was not selected is not touched");
  await page.screenshot({ path: OUT + "/10-consumables-mobile.png", fullPage: true });
  await f.locator('#tabs [data-t="queue"]').click();
  // history + reports
  await f.locator('#tabs [data-t="history"]').click(); await page.waitForTimeout(400);
  assert.match(await f.locator("#hList").innerText(), /Paracetamol 500mg/);
  await f.locator("#hList .pt").first().click(); await f.locator("#recCard .recordtext").waitFor();
  assert.match(await f.locator("#recCard").innerText(), /DISPENSING RECORD/);
  await page.screenshot({ path: OUT + "/06-history-mobile.png", fullPage: true });
  await f.locator('#tabs [data-t="reports"]').click(); await page.waitForTimeout(500);
  const rep = await f.locator("#rBody").innerText(); assert.match(rep, /Prescriptions received/); assert.match(rep, /Owner One/); assert.match(rep, /Units deducted from stock/);
  await page.screenshot({ path: OUT + "/07-reports-mobile.png", fullPage: true });
  // desktop layout
  await page.setViewportSize({ width: 1280, height: 800 });
  await f.locator('#tabs [data-t="queue"]').click(); await f.locator('#filters [data-f="waiting"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "/08-queue-desktop.png" });
  const real = errors.filter(e => !/favicon|manifest|Failed to load resource/i.test(e));
  assert.deepEqual(real, [], "no page errors: " + real.join(" | "));
  console.log("BROWSER CHECK PASSED");
  await browser.close();
})().catch(e => { console.error("BROWSER CHECK FAILED:", e.message); process.exit(1); });
