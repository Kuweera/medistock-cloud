/* Developer 3: the dosing-rule form in Chromium against the in-memory stand-in (NOT real Firebase): what is required, and that the "Required: ..." line is true.
   Run: python3 -m http.server 8765, then node tests/dosing-rules-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/dosing-rules-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
  await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#showFormBtn:not(.hidden)").waitFor(); await f.locator("#showFormBtn").click(); await f.locator("#fMed").waitFor();
  const rules = () => page.evaluate(() => window.__db.all("pc_dosing_rules")), msg = async () => (await f.locator("#fMsg").innerText()).trim(), draft = async () => { await f.locator("#fDraftBtn").click(); await page.waitForTimeout(450); };
  assert.match(await f.locator("#req-rule").innerText(), /Required: the medicine, where the rule comes from, and the country/);
  await draft(); assert.match(await msg(), /Enter the medicine/);
  await f.locator("#fMed").fill("TESTmed"); await draft(); assert.match(await msg(), /where this rule comes from/);
  await f.locator("#fSource").fill("TEST guideline 2024"); assert.equal(await f.locator("#fJur").inputValue(), "Uganda", "the country is pre-filled");
  await f.locator("#fJur").fill(""); await draft(); assert.match(await msg(), /country/);
  await f.locator("#fJur").fill("Uganda"); await draft(); assert.match(await msg(), /at least one dose limit/);
  assert.equal((await rules()).length, 0, "nothing saved while incomplete");
  await f.locator("#fMinDose").fill("500"); await f.locator("#fMaxDose").fill("100"); await draft(); assert.match(await msg(), /lowest dose is higher than the highest/);
  await f.locator("#fMinDose").fill(""); await f.locator("#fMaxDose").fill(""); await f.locator("#fMaxDay").fill("-1"); await draft(); assert.match(await msg(), /zero or more/);
  // the three required boxes plus ONE limit are enough: dates, unit, routes, notes, weight and age limits are optional
  await f.locator("#fMaxDay").fill("4000"); await draft();
  const r = await rules(); assert.equal(r.length, 1); assert.equal(r[0].medicineName, "TESTmed"); assert.equal(r[0].approvalStatus, "draft"); assert.equal(r[0].maxDailyDose, 4000); assert.equal(r[0].effectiveDate, null); assert.equal(r[0].minWeightKg, null);
  await page.screenshot({ path: OUT + "/dosing-rule-form-mobile.png" });
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("dosing-rules-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
