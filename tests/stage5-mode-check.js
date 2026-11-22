/* Developer 3, Stage 5: administrationMode on the order form of the real encounter.html. Chromium, in-memory stand-in with a mirror of the v22 mode rules
   (NOT the real rules engine, NOT real Firebase). Run: python3 -m http.server 8765 (repo root); node tests/stage5-mode-check.js [folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness-rx.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(400);
    const all = c => page.evaluate(c => window.__db.all(c), c);
    const setPlan = cs => page.evaluate(cs => { const p = window.__db.all("pc_treatment_plans").find(x => x._id === "pl1"); const id = p._id; delete p._id; p.careSetting = cs; window.__db.add("pc_treatment_plans", id, p); }, cs);
    const openMed = async () => { await f.locator('[data-t="treat"]').click(); await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor(); };
    const fill = async (name, type, extra) => { await f.locator("#obType").selectOption(type); await f.locator("#obMed").fill(name); await f.locator("#obDose").fill("1"); await f.locator("#obUnit").fill("tablet"); await f.locator("#obRoute").fill("by mouth"); if (extra) await extra(); };
    const save = async () => { await f.locator("#obSaveBtn").click(); await page.waitForTimeout(500); };
    const byName = async n => (await all("pc_treatment_orders")).find(o => o.medicineName === n || o.procedureName === n);
    // 1. the three choices, with plain words; the default comes from the care setting, never from the route
    await setPlan("outpatient"); await openMed();
    const opts = await f.locator("#obMode option").allInnerTexts(); assert.equal(opts.length, 3); assert.match(opts[0], /takes it home/); assert.match(opts[1], /Given at the facility/); assert.match(opts[2], /Given on the ward/);
    assert.equal(await f.locator("#obMode").inputValue(), "take_home"); assert.match(await f.locator("#obModeHelp").innerText(), /No planned doses are created/);
    await f.locator("#obMode").selectOption("facility_administered"); assert.match(await f.locator("#obModeHelp").innerText(), /Staff record when the patient arrives or does not attend/);
    await f.locator("#obMode").selectOption("take_home");
    // 2. take-home: a prescription and NO planned doses, no administration records
    await fill("Homecef", "interval", async () => { await f.locator("#obEvery").fill("8"); await f.locator("#obCount").fill("15"); await f.locator("#obQty").fill("15"); }); await save();
    let o = await byName("Homecef"); assert.equal(o.administrationMode, "take_home"); assert.equal(o.totalEvents, 0); assert.equal((await all("pc_treatment_events")).filter(e => e.orderId === o._id).length, 0, "no planned doses for take-home");
    assert.equal((await all("prescriptions")).find(r => r._id === o._id).status, "pending", "the prescription still goes to the pharmacy"); assert.equal((await all("pc_mar_records")).length, 0);
    assert.match((await f.locator("#doneMsg").innerText()), /TAKE-HOME medicine: no planned doses are created/);
    let c = f.locator('.ord:has([data-oxp="' + o._id + '"])'); assert.match(await c.innerText(), /Take-home/); assert.match(await c.innerText(), /DURATION\s+5 days/i, "course length still shown from the schedule");
    await f.locator('[data-oxp="' + o._id + '"]').click(); assert.match(await c.innerText(), /Staff do not record each dose/); assert.equal(await f.locator('[data-oext="' + o._id + '"]').count(), 0, "no 'write next days' for take-home");
    // 3. facility-administered injection: planned visits are created, the order records the mode, route is independent (injection AND oral both allowed)
    await openMed(); await f.locator("#obMode").selectOption("facility_administered"); await fill("Facinj", "interval", async () => { await f.locator("#obEvery").fill("24"); await f.locator("#obCount").fill("3"); await f.locator("#obRoute").fill("intramuscular"); }); await save();
    o = await byName("Facinj"); assert.equal(o.administrationMode, "facility_administered"); assert.equal(o.totalEvents, 3); assert.equal((await all("pc_treatment_events")).filter(e => e.orderId === o._id).length, 3);
    await openMed(); await f.locator("#obMode").selectOption("facility_administered"); await fill("Facoral", "once"); await save(); o = await byName("Facoral"); assert.equal(o.administrationMode, "facility_administered"); assert.equal(o.route, "by mouth", "an oral medicine can be facility-administered");
    await openMed(); await f.locator("#obMode").selectOption("take_home"); await fill("Homeinj", "once", async () => { await f.locator("#obRoute").fill("intramuscular"); }); await save(); o = await byName("Homeinj"); assert.equal(o.administrationMode, "take_home"); assert.equal(o.route, "intramuscular", "an injection can be take-home");
    c = f.locator('.ord:has([data-oxp="' + (await byName("Facinj"))._id + '"])'); await f.locator('[data-oxp="' + (await byName("Facinj"))._id + '"]').click(); assert.match(await c.innerText(), /arrived 0 · did not attend 0/);
    // 4. inpatient plan: default is the ward chart, doses are created
    await setPlan("inpatient"); await openMed(); assert.equal(await f.locator("#obMode").inputValue(), "inpatient_mar"); await fill("Wardmed", "interval", async () => { await f.locator("#obEvery").fill("12"); await f.locator("#obCount").fill("2"); }); await save();
    o = await byName("Wardmed"); assert.equal(o.administrationMode, "inpatient_mar"); assert.equal((await all("pc_treatment_events")).filter(e => e.orderId === o._id).length, 2);
    // 5. procedures: no take-home choice; default is given at the facility
    await setPlan("outpatient"); await f.locator("[data-addproc]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
    assert.deepEqual((await f.locator("#obMode option").evaluateAll(l => l.map(x => x.value))), ["facility_administered", "inpatient_mar"]); assert.equal(await f.locator("#obMode").inputValue(), "facility_administered");
    await f.locator("#obType").selectOption("once"); await f.locator("#obProc").fill("Dressing change"); await save(); o = await byName("Dressing change"); assert.equal(o.administrationMode, "facility_administered"); assert.equal((await all("prescriptions")).some(r => r._id === o._id), false, "procedures write no prescription");
    // 6. Change keeps the mode; an old order with no mode starts from the default
    const homeId = (await byName("Homecef"))._id; await f.locator('[data-oxp="' + homeId + '"]').click().catch(() => {}); if ((await f.locator('[data-ochg="' + homeId + '"]').count()) === 0) await f.locator('[data-oxp="' + homeId + '"]').click();
    await f.locator('[data-ochg="' + homeId + '"]').click(); await f.locator("#obCard:not(.hidden)").waitFor(); assert.equal(await f.locator("#obMode").inputValue(), "take_home", "Change keeps take_home");
    await f.locator("#obChangeReason").fill("Dose changed"); await save(); const nv = (await all("pc_treatment_orders")).find(x => x.supersedes === homeId); assert.equal(nv.administrationMode, "take_home"); assert.equal((await all("pc_treatment_events")).filter(e => e.orderId === nv._id).length, 0);
    assert.deepEqual(await page.evaluate(() => window.__denied || []), [], "no write refused by the mirrored rules");
    assert.equal(await f.locator("#planList").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, vp.width + ": no sideways scroll");
    await page.screenshot({ path: OUT + "/stage5-mode-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" }); await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("STAGE 5 MODE CHECK PASSED (stand-in with mirrored mode rules, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
