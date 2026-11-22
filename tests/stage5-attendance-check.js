/* Developer 3, Stage 5: attendance on the real treatment.html (facility_administered visits). Chromium, in-memory stand-in with a MIRROR of rules A1-A5
   from DEV3_RULES_REQUEST_V23.md (NOT the real v23 rules engine, NOT real Firebase). Run: python3 -m http.server 8765 (repo root); node tests/stage5-attendance-check.js [folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/treatment-harness-att.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); let promptText = "", dialogs = [];
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => { dialogs.push(d.type() + ": " + d.message()); d.type() === "prompt" ? d.accept(promptText) : d.accept(); });
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#list").waitFor(); await page.waitForTimeout(500);
    const ev = id => page.evaluate(i => window.__db.all("pc_treatment_events").find(e => e._id === i), id);
    const recs = () => page.evaluate(() => window.__db.all("pc_mar_records"));
    const msg = async () => (await f.locator("#doneMsg").innerText()).trim();
    const open = async (id, tab) => { await f.locator('#tabs [data-f="' + (tab || "appt") + '"]').click(); await f.locator('#list .pt[data-ev="' + id + '"]').click(); await f.locator("#actCard:not(.hidden)").waitFor(); };
    // 1. Appointments list: only facility_administered visits; overdue is derived and counted
    await f.locator('#tabs [data-f="appt"]').click(); let t = await f.locator("#list").innerText();
    assert.match(t, /FACInj Ceftriaxone/); assert.doesNotMatch(t, /WARDMed/); assert.doesNotMatch(t, /TESTmed/); assert.match(t, /Overdue: not arrived/);
    assert.match(await f.locator('#tabs [data-f="appt"]').innerText(), /Appointments \(1\)/);
    // 2. attendance block only for facility visits
    await open("evF2"); assert.equal(await f.locator('#actCard [data-att="arrive"]').count(), 1); assert.equal(await f.locator('#actCard [data-att="dna"]').count(), 1);
    await open("evW1", "due"); assert.equal(await f.locator("#actCard [data-att]").count(), 0, "ward (inpatient_mar) dose has no attendance"); assert.match(await f.locator("#actCard").innerText(), /Record what happened/);
    await open("ev1", "due"); assert.equal(await f.locator("#actCard [data-att]").count(), 0, "order without administrationMode keeps today's behaviour");
    // 3. arrival: the dose stays pending, only the attendance keys are written
    await open("evF2"); await f.locator('#actCard [data-att="arrive"]').click(); await page.waitForTimeout(400); let e2 = await ev("evF2");
    assert.equal(e2.attendance, "attended"); assert.equal(e2.status, "pending"); assert.equal(e2.attendanceBy, "owner1"); assert.equal(e2.attendanceByName, "Dr Owner"); assert.equal(typeof e2.attendanceAt, "number");
    assert.match(await msg(), /Arrival recorded.*still pending/);
    await open("evF2"); assert.match(await f.locator("#actCard").innerText(), /Arrived at/); assert.equal(await f.locator('#actCard [data-att="dna"]').count(), 0, "cannot record did-not-attend after arrival");
    assert.match(await f.locator('#list .pt[data-ev="evF2"]').innerText(), /Arrived/);
    // 4. wrong arrival can be undone
    await f.locator('#actCard [data-att="undo"]').click(); await page.waitForTimeout(400); e2 = await ev("evF2"); assert.equal(e2.attendance, null); assert.equal(e2.attendanceBy, null); assert.equal(e2.status, "pending");
    // 5. did not attend needs a reason; then dose = missed + record in ONE batch, marked as attendance, not as a staff miss
    await open("evF1"); dialogs = []; await f.locator('#actCard [data-att="dna"]').click(); await page.waitForTimeout(300);
    assert.ok(dialogs.some(d => /reason/i.test(d)), "reason demanded"); assert.equal((await ev("evF1")).status, "pending");
    await f.locator("#aReason").fill("Patient travelled"); await f.locator('#actCard [data-att="dna"]').click(); await page.waitForTimeout(500);
    let e1 = await ev("evF1"), r = (await recs()).filter(x => x.eventId === "evF1");
    assert.equal(e1.status, "missed"); assert.equal(e1.attendance, "did_not_attend"); assert.equal(e1.attendanceBy, "owner1"); assert.equal(r.length, 1); assert.equal(r[0].outcome, "missed"); assert.equal(r[0].attendance, "did_not_attend"); assert.equal(r[0].omissionReason, "Patient travelled"); assert.equal(r[0].status, "active");
    const batch = await page.evaluate(() => window.__batches.filter(b => b.some(s => /pc_mar_records/.test(s))).pop()); assert.ok(batch.some(s => s === "update pc_treatment_events/evF1"), "record and event in one batch");
    assert.match(await msg(), /DID NOT ATTEND/); assert.match(await msg(), /not a missed dose by staff/);
    await f.locator('#tabs [data-f="appt"]').click(); t = await f.locator('#list .pt[data-ev="evF1"]').innerText(); assert.match(t, /Did not attend/); assert.doesNotMatch(t, /Missed/);
    // 6. a dose missed by STAFF is different: no attendance keys, record without attendance
    await open("evF3"); await f.locator("#aReason").fill("Nurse unavailable"); await f.locator('#actCard [data-out="missed"]').click(); await page.waitForTimeout(400);
    const e3 = await ev("evF3"), r3 = (await recs()).find(x => x.eventId === "evF3"); assert.equal(e3.status, "missed"); assert.equal(e3.attendance, undefined); assert.equal(r3.attendance, undefined);
    // 7. arrival followed by the dose: attendance stays, the dose is recorded as given
    await open("evF2"); await f.locator('#actCard [data-att="arrive"]').click(); await page.waitForTimeout(300); await open("evF2");
    await f.locator('#actCard [data-out="administered"]').click(); await page.waitForTimeout(500); e2 = await ev("evF2"); assert.equal(e2.status, "administered"); assert.equal(e2.attendance, "attended"); assert.equal(e2.actualDoseValue, 1);
    // 8. correcting the did-not-attend record clears attendance (rule A3): the visit is pending again
    await f.locator('#tabs [data-f="appt"]').click(); await f.locator('#list .pt[data-ev="evF1"]').click(); await f.locator("#fixBtn").waitFor(); promptText = "Patient did come"; await f.locator("#fixBtn").click(); await page.waitForTimeout(500);
    e1 = await ev("evF1"); assert.equal(e1.status, "pending"); assert.equal(e1.attendance, null); assert.equal(e1.attendanceBy, null); assert.equal((await recs()).find(x => x.eventId === "evF1").status, "entered_in_error"); assert.match(await msg(), /'did not attend' mark is removed/);
    // 9. take-home PRN order is not on the ward PRN list
    await f.locator('#tabs [data-f="prn"]').click(); t = await f.locator("#list").innerText(); assert.doesNotMatch(t, /HOMEPrn/); assert.match(await f.locator('#tabs [data-f="prn"]').innerText(), /^As needed \(PRN\)$/);
    // 10. every write passed the mirrored rules; layout
    assert.deepEqual(await page.evaluate(() => window.__denied || []), [], "no write was refused by the mirrored rules");
    assert.equal(await f.locator("#list").evaluate(el => el.scrollWidth > el.clientWidth + 1), false, vp.width + ": no sideways scroll");
    await f.locator('#tabs [data-f="appt"]').click(); await page.screenshot({ path: OUT + "/stage5-attendance-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" });
    await ctx.close();
  }
  // a user without treatment.administer cannot record attendance
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }), p2 = await c2.newPage(); await p2.goto(URL + "?as=nopres"); const f2 = p2.frameLocator("#f"); await f2.locator("#list").waitFor(); await p2.waitForTimeout(500);
  await f2.locator('#tabs [data-f="appt"]').click(); await f2.locator('#list .pt[data-ev="evF2"]').click(); await f2.locator("#actCard:not(.hidden)").waitFor(); assert.equal(await f2.locator("#actCard [data-att]").count(), 0, "no attendance buttons without treatment.administer");
  assert.match(await f2.locator("#actCard").innerText(), /do not have permission to record/); await c2.close();
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("STAGE 5 ATTENDANCE CHECK PASSED (stand-in with mirrored rules A1-A5, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
