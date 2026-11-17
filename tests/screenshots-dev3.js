/* Developer 3: regenerates the mobile (390 px) and desktop (1280 px) screenshots of the visit forms for docs/screenshots-dev3/ (master plan deliverable 8).
   Chromium, in-memory stand-in with TEST data only. Run: python3 -m http.server 8765, then node tests/screenshots-dev3.js docs/screenshots-dev3 */
const { chromium } = require("playwright");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), shots = [];
  for (const [name, w, h] of [["mobile", 390, 844], ["desktop", 1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); page.on("dialog", d => d.accept());
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(600);
    const snap = async (file, tab, sel) => { await f.locator('[data-t="' + tab + '"]').click(); await page.waitForTimeout(250); if (sel) await f.locator(sel).scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await page.screenshot({ path: OUT + "/" + file + "-" + name + ".png" }); shots.push(file + "-" + name); };
    await snap("consultation", "consult", "#cSaveBtn");
    await snap("diagnosis", "dx", "#dSaveBtn");
    await snap("treatment-plan", "treat", "#pSaveBtn");
    await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor(); await f.locator("#obType").selectOption("daily"); await snap("order-scheduled", "treat", "#obCard");
    await snap("tests-request", "tests", "#oReqBtn");
    await snap("notes", "notes", "#nDraftBtn");
    await ctx.close();
  }
  await browser.close(); console.log("screenshots:", shots.length, "written to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
