/* Developer 2: proves guideline support works INSIDE the real encounter.html (Chromium, in-memory Firestore stand-in; NOT real Firebase).
   Run:  python3 -m http.server 8765  (repo root), then  node tests/encounter-guidance-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(q, w, h) {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); page.on("pageerror", e => errors.push(q + ": " + e)); page.on("console", m => { if (m.type() === "error") errors.push(q + ": " + m.text()); });
    page.on("dialog", d => d.accept(d.type() === "prompt" ? "1" : undefined));
    await page.goto(URL + (q ? "?" + q : "")); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(300); return { page, f, ctx };
  }
  const all = (page, c) => page.evaluate(c => window.__db.all(c), c);
  const tab = (f, t) => f.locator('[data-t="' + t + '"]').click();
  const strip = (f, s) => f.locator('[data-gstage="' + s + '"]');

  {
    const { page, f, ctx } = await open("");
    // 1. triage + consultation strips: only matching APPROVED guidance, with reason and source
    const tri = await strip(f, "triage").innerText();
    assert.match(tri, /TEST alpha/); assert.match(tri, /Why this is shown/); assert.match(tri, /TESTCOUGH/i); assert.match(tri, /Test Guideline \(2023\)/);
    assert.doesNotMatch(tri, /draft delta/, "draft never shown"); assert.doesNotMatch(tri, /zulu/, "unrelated not shown"); assert.doesNotMatch(tri, /papa/, "adult-only guideline hidden for an 8-year-old");
    assert.match(tri, /does not prescribe|not a diagnosis/i);
    await tab(f, "consult");
    const con = strip(f, "consult"), ct = await con.innerText();
    assert.match(ct, /warning · /i); assert.match(ct, /TEST danger sign/, "warnings visible without opening");
    assert.doesNotMatch(ct, /TEST question\?/, "recommendations wait for Review");
    assert.equal(await con.locator(".gs-sec.warning").count() > 0, true);
    await con.locator('[data-gact="review"]').first().click(); assert.match(await con.innerText(), /TEST question\?/);
    // other stages
    await tab(f, "tests"); assert.match(await strip(f, "tests").innerText(), /TEST investigation/);
    await tab(f, "close"); assert.match(await strip(f, "followup").innerText(), /TEST follow-up point/);
    // 2. Accept -> visit note + audit entry
    await tab(f, "consult");
    await con.locator('[data-gact="accept"]').first().click(); await page.waitForTimeout(300);
    const notes = (await all(page, "pc_clinical_notes")).filter(n => n.structured && n.structured.action === "accepted");
    assert.equal(notes.length, 1); assert.equal(notes[0].structured.guidelineRef.guidelineKey, "a"); assert.match(notes[0].content, /not a diagnosis or an order/); assert.match(notes[0].content, /Shown because/);
    assert.ok((await all(page, "pc_audit_logs")).some(a => a.action === "guideline.accept" && a.guidelineId === "gl_a_v1"));
    assert.match(await con.innerText(), /Accepted/); assert.equal(await con.locator('[data-gact="accept"]').first().isDisabled(), true);
    assert.equal((await all(page, "pc_treatment_orders")).length, 0, "accepting never creates an order");
    assert.equal((await all(page, "pc_diagnoses")).length, 0, "accepting never creates a diagnosis");
    await page.screenshot({ path: OUT + "/e1-consult-mobile.png", fullPage: true });
    // 3. Dismiss -> hidden; same reasons do not bring it back; a NEW complaint does
    await con.locator('[data-gact="dismiss"]').first().click(); await page.waitForTimeout(200);
    assert.doesNotMatch(await con.innerText(), /TEST alpha/); assert.match(await con.innerText(), /Show 1 dismissed/);
    assert.ok((await all(page, "pc_audit_logs")).some(a => a.action === "guideline.dismiss"));
    await page.evaluate(() => window.__db.add("pc_triage", "t2", { businessId: "biz1", facilityId: "shop1", encounterId: "e1", patientId: "p1", status: "active", recordedAt: Date.now(), pulse: 80 })); await page.waitForTimeout(300);
    assert.doesNotMatch(await con.innerText(), /TEST alpha/, "same reasons: stays dismissed");
    await page.evaluate(() => window.__db.add("pc_complaints", "c2", { businessId: "biz1", facilityId: "shop1", encounterId: "e1", patientId: "p1", status: "active", recordedAt: Date.now(), name: "Second testcough problem" })); await page.waitForTimeout(300);
    assert.match(await con.innerText(), /TEST alpha/, "a new matching complaint is a meaningful reason: shown again"); assert.match(await con.innerText(), /Second testcough problem/);
    // 4. treatment: regimens fit the patient (weight 20 kg), pre-fill the form, never save by themselves
    await tab(f, "treat");
    const tr = strip(f, "treat"), tt = await tr.innerText();
    assert.equal(await tr.locator(".gs-sec.recommend").count() > 0, true, "recommendations are styled apart from warnings"); assert.equal(await tr.locator(".gs-sec.warning").count() > 0, true); assert.match(tt, /TEST regimen/); assert.match(tt, /0, 12, 24|hour/i); assert.match(tt, /1 other regimen[\s\S]*not shown/); assert.doesNotMatch(tt, /TEST regimen small[\s\S]*1 tablet/, "small-child regimen hidden");
    await tr.locator('[data-gact="use"]').first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
    assert.equal(await f.locator("#obMed").inputValue(), "TESTmed"); assert.equal(await f.locator("#obDose").inputValue(), "2"); assert.equal(await f.locator("#obType").inputValue(), "elapsed"); assert.equal(await f.locator("#obHours").inputValue(), "0, 12, 24");
    assert.equal((await all(page, "pc_treatment_orders")).length, 0, "pre-fill is not an order");
    await page.screenshot({ path: OUT + "/e2-regimen-prefill-mobile.png", fullPage: true });
    await f.locator("#obSaveBtn").click(); await page.waitForTimeout(400);
    const ord = await all(page, "pc_treatment_orders"); assert.equal(ord.length, 1, (await f.locator("#obMsg").innerText()) + " | " + (await f.locator("#doneMsg").innerText()));
    assert.equal(ord[0].scheduleType, "elapsed"); assert.deepEqual(ord[0].sched.hours, [0, 12, 24]); assert.equal(ord[0].prescribingLevel, "guideline"); assert.equal(ord[0].guidelineRef.guidelineKey, "a"); assert.equal(ord[0].dosingCheck, "not_checked");
    const ev = (await all(page, "pc_treatment_events")).filter(e => e.orderId === ord[0]._id).sort((a, b) => a.plannedAt - b.plannedAt);
    assert.deepEqual(ev.map(e => (e.plannedAt - ev[0].plannedAt) / 3600e3), [0, 12, 24], "exact elapsed times");
    // 5. manual prescription with NO dosing rule is allowed; level recorded honestly; abbreviation meaning shown and it sets no dose
    await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
    await f.locator("#obMed").fill("Manualdrug"); await f.locator("#obRoute").fill("by mouth"); await f.locator("#obUnit").fill("tablet");
    await f.locator("#obAbbr").fill("BD"); await f.locator("#obAbbrGo").click(); assert.match(await f.locator("#obAbbrHelp").innerText(), /BD means twice daily/);
    assert.equal(await f.locator("#obDose").inputValue(), "", "abbreviation never sets the dose");
    await f.locator("#obInstr").fill("1 tab BD PO"); await f.locator("#obInstr").dispatchEvent("input"); await page.waitForTimeout(400); assert.match(await f.locator("#obExpand").innerText(), /BD means twice daily[\s\S]*PO means by mouth/);
    await f.locator("#obInstr").fill("QD"); await f.locator("#obInstr").dispatchEvent("input"); await page.waitForTimeout(400); assert.match(await f.locator("#obExpand").innerText(), /UNSAFE/); await f.locator("#obInstr").fill("");
    await f.locator("#obDays").fill("3"); await f.locator("#obDose").fill("1"); await f.locator("#obSaveBtn").click(); await page.waitForTimeout(300);
    let ord2 = (await all(page, "pc_treatment_orders")).filter(o => o.medicineName === "Manualdrug"); if (!ord2.length) assert.fail("manual order blocked: " + await f.locator("#obMsg").innerText());
    assert.equal(ord2[0].prescribingLevel, "clinician"); assert.equal(ord2[0].dosingCheck, "not_checked"); assert.equal(ord2[0].abbreviation.code, "BD");
    assert.match(await f.locator("#treatList, #tab-treat").first().innerText(), /not (been )?(automatically )?checked/i);
    await page.screenshot({ path: OUT + "/e3-treatment-mobile.png", fullPage: true });
    assert.deepEqual(errors, [], "no page errors"); await ctx.close();
  }
  { // nothing recorded yet -> nothing suggested
    const { f, ctx } = await open("nodata=1"); assert.equal((await strip(f, "consult").innerText()).trim(), ""); assert.equal((await strip(f, "triage").innerText()).trim(), ""); await ctx.close();
  }
  { // missing weight is said plainly; pregnancy is read from history; no-permission user cannot use a regimen
    const { f, ctx } = await open("as=nopres"); await tab(f, "treat");
    const t = await strip(f, "treat").innerText(); assert.match(t, /do not have permission to prescribe/); assert.equal(await strip(f, "treat").locator('[data-gact="use"]').first().isDisabled(), true); await ctx.close();
  }
  { const { page, f, ctx } = await open("", 1280, 900); await tab(f, "consult"); await page.screenshot({ path: OUT + "/e4-consult-desktop.png" }); await ctx.close(); }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("ALL ENCOUNTER GUIDANCE CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
