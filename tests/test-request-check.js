/* Developer 3: the visit's diagnosis and complaint are offered as the reason when requesting tests (master plan section D: "Diagnosis should be available when requesting investigations").
   Chromium, in-memory stand-in (NOT real Firebase). Run: python3 -m http.server 8765, then node tests/test-request-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
  await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
  const tab = t => f.locator('[data-t="' + t + '"]').click();
  // a catalogue test to pick (the harness has none)
  await page.evaluate(() => { const c = window.__db.all("pc_complaints")[0]; window.__db.add("pc_inv_catalogue", "t1", { businessId: c.businessId, facilityId: c.facilityId, name: "TESTtest malaria", category: "haematology", resultType: "choice", choices: ["positive", "negative"], active: true, specimen: "Blood" }); });
  // 1. complaint is offered; there is no diagnosis yet
  await tab("tests"); await page.waitForTimeout(300);
  let ctxText = await f.locator("#oContext").innerText(); assert.match(ctxText, /Complaint: TESTCOUGH/); assert.doesNotMatch(ctxText, /Diagnosis:/);
  // 2. add a diagnosis; it appears first in the offered reasons
  await tab("dx"); await f.locator("#dName").fill("TEST dx"); await f.locator("#dSaveBtn").click(); await page.waitForTimeout(500);
  await tab("tests"); await page.waitForTimeout(300);
  const chips = await f.locator("#oContext [data-reason]").allInnerTexts(); assert.deepEqual(chips, ["Diagnosis: TEST dx", "Complaint: TESTCOUGH"]);
  // 3. tapping fills the reason; tapping twice does not repeat it; both can be combined
  await f.locator('#oContext [data-reason="TEST dx"]').click(); assert.equal(await f.locator("#oNote").inputValue(), "TEST dx");
  await f.locator('#oContext [data-reason="TEST dx"]').click(); assert.equal(await f.locator("#oNote").inputValue(), "TEST dx", "no duplicate");
  await f.locator('#oContext [data-reason="TESTCOUGH"]').click(); assert.equal(await f.locator("#oNote").inputValue(), "TEST dx; TESTCOUGH");
  await f.locator("#oContext").scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + "/test-request-reason-mobile.png" });
  // 4. the existing request still works and carries the reason on the order
  await f.locator('[data-pick="t1"]').check(); await f.locator("#oReqBtn").click(); await page.waitForTimeout(500);
  const o = (await page.evaluate(() => window.__db.all("pc_inv_orders"))).pop(); assert.equal(o.name, "TESTtest malaria"); assert.equal(o.clinicalNote, "TEST dx; TESTCOUGH");
  // 4b. the reason is optional: a request with no reason is accepted
  await f.locator('[data-pick="t1"]').check(); await f.locator("#oReqBtn").click(); await page.waitForTimeout(500);
  const o2 = (await page.evaluate(() => window.__db.all("pc_inv_orders"))); assert.equal(o2.length, 2); assert.equal(o2[o2.length - 1].clinicalNote, "", "saved without a reason");
  // 5. no sideways scrolling on a small phone
  const small = await browser.newContext({ viewport: { width: 320, height: 640 } }); const p2 = await small.newPage(); p2.on("pageerror", e => errors.push(String(e)));
  await p2.goto(URL); const f2 = p2.frameLocator("#f"); await f2.locator("#mainArea:not(.hidden)").waitFor(); await f2.locator('[data-t="tests"]').click(); await p2.waitForTimeout(300);
  assert.equal(await f2.locator("body").evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "no sideways scrolling at 320px");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("test-request-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
