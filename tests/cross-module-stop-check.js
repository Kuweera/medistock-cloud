/* Developer 3: STOP / COMPLETE in the treatment plan must remove the medicines from the pharmacy "Waiting" queue.
   Cross-module check on REAL records: the real encounter.html writes the orders and prescriptions; those exact documents (before and after the stop) are then
   loaded into the real pharmacy.html page, which must move them out of Waiting. The two pages run on separate in-memory stand-ins (NOT real Firebase), so the hand-off
   is done by copying documents. Run: python3 -m http.server 8765 (repo root); node tests/cross-module-stop-check.js */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const mode of ["stop", "complete"]) for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    // ---- clinician side: real encounter.html
    const c1 = await browser.newContext({ viewport: vp }), p1 = await c1.newPage(); let promptText = "Patient improved";
    p1.on("pageerror", e => errors.push(String(e))); p1.on("dialog", d => d.type() === "prompt" ? d.accept(promptText) : d.accept());
    await p1.goto("http://localhost:8765/tests/encounter-harness-rx.html"); const f1 = p1.frameLocator("#f"); await f1.locator("#mainArea:not(.hidden)").waitFor(); await p1.waitForTimeout(400);
    const all1 = c => p1.evaluate(c => window.__db.all(c), c);
    await f1.locator('[data-t="treat"]').click();
    const addMed = async (n, qty) => { await f1.locator("[data-addmed]").first().click(); await f1.locator("#obCard:not(.hidden)").waitFor(); await f1.locator("#obType").selectOption("once"); await f1.locator("#obMed").fill(n); await f1.locator("#obDose").fill("1"); await f1.locator("#obUnit").fill("tablet"); await f1.locator("#obRoute").fill("by mouth"); await f1.locator("#obQty").fill(String(qty)); await f1.locator("#obSaveBtn").click(); await p1.waitForTimeout(450); };
    await addMed("Alpharin", 10); await addMed("Zentelx", 6);
    await f1.locator("[data-addcons]").first().click(); await f1.locator('#cnResults [data-cnpick="sd1"]').click(); await f1.locator("#cnQty").fill("2"); await f1.locator("#cnSaveBtn").click(); await p1.waitForTimeout(450);
    const zid = (await all1("pc_treatment_orders")).find(o => o.medicineName === "Zentelx")._id;
    await p1.evaluate(i => { const d = window.__db.all("prescriptions").find(x => x._id === i); delete d._id; Object.assign(d, { status: "partially_dispensed", qtyDispensed: 3, qtyOutstanding: 3, qtyUnit: "Tablet" }); window.__db.add("prescriptions", i, d); }, zid); await p1.waitForTimeout(300);
    const grab = async () => ({ orders: await all1("pc_treatment_orders"), rx: await all1("prescriptions") });
    const before = await grab();
    // ---- end the WHOLE plan (the reported action)
    if (mode === "stop") { promptText = "Patient improved"; await f1.locator('[data-pstop="pl1"]').first().click(); } else await f1.locator('[data-pdone="pl1"]').first().click();
    await p1.waitForTimeout(700); const after = await grab();
    assert.equal(after.orders.filter(o => o.status === "active").length, 0, mode + ": the treatment screen leaves NO order active");
    assert.equal(after.rx.find(r => r._id === zid).status, "partially_dispensed", "dispensed history kept");
    await c1.close();
    // ---- pharmacy side: real pharmacy.html
    const c2 = await browser.newContext({ viewport: vp }), p2 = await c2.newPage(); p2.on("pageerror", e => errors.push(String(e)));
    await p2.goto("http://localhost:8765/tests/harness-stage6.html"); const f2 = p2.frameLocator("#f"); await f2.locator("#list .rxgroup").first().waitFor(); await p2.waitForTimeout(400);
    const inject = snap => p2.evaluate(s => { s.orders.forEach(o => { const id = o._id, d = Object.assign({}, o); delete d._id; window.__db.put("pc_treatment_orders", id, d); }); s.rx.forEach(r => { const id = r._id, d = Object.assign({}, r); delete d._id; window.__db.put("prescriptions", id, d); }); window.__db.notify(); }, snap);
    await inject(before); await p2.waitForTimeout(500);
    let waiting = await f2.locator("#list").innerText(); for (const n of ["Alpharin", "IV cannula 20G"]) assert.match(waiting, new RegExp(n), n + " is waiting before the plan ends");
    await inject(after); await p2.waitForTimeout(600);
    const names = async () => (await f2.locator("#list").innerText());
    await f2.locator('#filters [data-f="waiting"]').click(); waiting = await names(); if (process.env.DBG) console.log("WAITING TAB (" + mode + ") >>>\n" + waiting.split("\n").filter(l => /Zentelx|Alpharin|IV cannula|Stopped|Waiting|Partly|Cancel|Patient/.test(l)).join("\n"));
    for (const n of ["Alpharin", "Zentelx"]) assert.doesNotMatch(waiting, new RegExp(n), mode + ": " + n + " must NOT stay in Waiting");
    assert.equal(await f2.locator('#list .pt[data-id="' + after.orders.find(o => o.kind === "consumable")._id + '"]').count(), 0, mode + ": the consumable request must NOT stay in Waiting");
    await f2.locator('#filters [data-f="partial"]').click(); const part = await names(); assert.doesNotMatch(part, /Zentelx/, mode + ": the partly dispensed one is not offered for further dispensing either");
    await f2.locator('#filters [data-f="stopped"]').click(); await p2.waitForTimeout(500); const stopped = await names();
    for (const n of ["Alpharin", "Zentelx", "IV cannula 20G"]) assert.match(stopped, new RegExp(n), mode + ": " + n + " is listed as cancelled or stopped");
    await c2.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("CROSS-MODULE STOP/COMPLETE CHECK PASSED (two stand-ins, documents copied, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
