/* Developer 3: the as-needed (PRN) dose flow and the correction flow of treatment.html, driven in Chromium against the in-memory stand-in (NOT real Firebase).
   Run: python3 -m http.server 8765, then node tests/prn-correction-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/treatment-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); const dialogs = []; page.on("pageerror", e => errors.push(String(e)));
  page.on("dialog", d => { dialogs.push(d.message()); d.accept("Entered on the wrong patient"); });
  await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("[data-ev]").first().waitFor();
  const all = c => page.evaluate(c => window.__db.all(c), c);
  const said = re => dialogs.some(m => re.test(m));
  // seed an as-needed order (the harness has only a scheduled one)
  await page.evaluate(() => { const e = window.__db.all("pc_treatment_events")[0];
    window.__db.add("pc_treatment_orders", "o2", { businessId: e.businessId, facilityId: e.facilityId, patientId: "p1", patientName: "Test Patient", encounterId: "e1", planId: "pl1", medicineName: "TESTPRN 500 mg", kind: "medicine", status: "active", scheduleType: "prn", doseValue: 1, doseUnit: "tablet", route: "by mouth", startAt: Date.now() - 3600000, totalEvents: 0, sched: { indication: "Pain", minIntervalHours: 6, maxPerDay: 2, maxDailyDose: 4, periodDays: 5 } }); });
  await f.locator('[data-f="prn"]').click(); await f.locator("[data-prn]").first().click(); await f.locator("#pGiveBtn").waitFor();
  assert.equal(await f.locator("#pReason").inputValue(), "Pain", "reason is pre-filled from the order");
  // 1. a reason is required
  await f.locator("#pReason").fill(""); await f.locator("#pGiveBtn").click(); assert.ok(said(/why the dose is being given/i)); assert.equal((await all("pc_mar_records")).length, 0);
  // 2. a first dose is recorded as an as-needed administration (no scheduled event)
  await f.locator("#pReason").fill("Pain"); await f.locator("#pGiveBtn").click(); await page.waitForTimeout(500);
  let r = await all("pc_mar_records"); assert.equal(r.length, 1); assert.equal(r[0].outcome, "administered"); assert.equal(r[0].eventId, null); assert.equal(r[0].reason, "Pain"); assert.equal(r[0].orderId, "o2"); assert.deepEqual(r[0].warnings, []);
  // 3. a second dose straight away warns about the minimum interval and needs a written reason
  await f.locator('[data-f="prn"]').click(); await f.locator("[data-prn]").first().click(); await f.locator("#pGiveBtn").waitFor();
  assert.match(await f.locator("#actCard").innerText(), /Today: 1 dose/);
  await f.locator("#pDose").fill("1"); await f.locator("#pDose").dispatchEvent("input");
  assert.match(await f.locator("#pWarn").innerText(), /less than 6 hours/); assert.equal(await f.locator("#pOverBox").isVisible(), true);
  await page.screenshot({ path: OUT + "/prn-warning-mobile.png" });
  await f.locator("#pGiveBtn").click(); assert.ok(said(/still being given/i)); assert.equal((await all("pc_mar_records")).length, 1, "not saved without an override reason");
  await f.locator("#pOver").fill("Severe pain, prescriber phoned"); await f.locator("#pGiveBtn").click(); await page.waitForTimeout(500);
  r = await all("pc_mar_records"); assert.equal(r.length, 2); const second = r.find(x => x.overrideReason); assert.equal(second.overrideReason, "Severe pain, prescriber phoned"); assert.ok(second.warnings.length >= 1);
  // 4. a third dose also warns about the daily limit
  await f.locator('[data-f="prn"]').click(); await f.locator("[data-prn]").first().click(); await f.locator("#pGiveBtn").waitFor(); await f.locator("#pDose").dispatchEvent("input");
  assert.match(await f.locator("#pWarn").innerText(), /at most 2 a day/);
  // 5. correction: give the scheduled medicine, then mark the record wrong. The record stays, and the dose is pending again
  await f.locator('[data-f="due"]').click(); await f.locator("[data-ev]").first().click(); await f.locator('[data-out="administered"]').waitFor();
  await f.locator("#aDose").fill("2"); await f.locator('[data-out="administered"]').click(); await page.waitForTimeout(500);
  const given = (await all("pc_mar_records")).find(x => x.eventId === "ev1"); assert.ok(given && given.status === "active"); assert.equal((await all("pc_treatment_events")).find(e => e._id === "ev1").status, "administered");
  await f.locator('[data-f="done"]').click(); await f.locator("[data-ev]").first().click(); await f.locator("#fixBtn").waitFor(); await f.locator("#fixBtn").click(); await page.waitForTimeout(500);
  const fixed = (await all("pc_mar_records")).find(x => x.eventId === "ev1");
  assert.equal(fixed.status, "entered_in_error", "the original record is kept, marked wrong"); assert.equal(fixed.errorReason, "Entered on the wrong patient"); assert.equal(fixed.actualDoseValue, 2, "its content is unchanged");
  assert.equal((await all("pc_treatment_events")).find(e => e._id === "ev1").status, "pending", "the dose goes back to pending");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("prn-correction-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
