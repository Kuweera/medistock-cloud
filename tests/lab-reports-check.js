/* Developer 4: laboratory reports page in Chromium against the in-memory stand-in (NOT real Firebase). Revenue must come from saved bills only. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); page.on("pageerror", e => errors.push(String(e)));
  await page.goto("http://localhost:8765/tests/lab-harness.html?page=reports");
  const f = page.frameLocator("#f"); await f.locator("#out .card").first().waitFor(); await page.waitForTimeout(500);
  const t = await f.locator("#out").innerText();
  assert.match(t, /11 tests requested/); // 8 base + 3 verified
  const rev = await f.locator("#out details", { hasText: "Revenue" }).innerText();
  assert.match(rev, /Billed \(saved bills\)\s*10,?000/); assert.match(rev, /Money received\s*5,?000/); assert.match(rev, /On credit.*\s5,?000/s); assert.match(rev, /Tests not billed yet\s*\S+ \(worth/);
  assert.match(rev, /Later payments of credit are recorded in Credit/);
  assert.match(t, /Corrected results \(1\)/); assert.match(t, /Rejected specimens \(0\)/);
  await f.locator("#out details", { hasText: "Test volume" }).locator("summary").click();
  await page.screenshot({ path: OUT + "/lab-reports-mobile.png", fullPage: true });
  assert.deepEqual(errors, []); await browser.close(); console.log("lab-reports-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
