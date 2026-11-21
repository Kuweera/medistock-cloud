/* Developer 3, Stage 3: the pharmacy screen with PENDING prescriptions and a prescription STOPPED after partial dispensing.
   Real pharmacy.html in Chromium, in-memory stand-in (NOT real Firebase). Run: python3 -m http.server 8765 (repo root), then node tests/pharmacy-stage3-check.js */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e)));
    await page.goto("http://localhost:8765/tests/harness-stage3.html"); const f = page.frameLocator("#f"); await f.locator("#list .rxgroup").first().waitFor(); await page.waitForTimeout(400);
    const line = id => f.locator('#list .pt[data-id="' + id + '"]');
    // pending prescription with no quantity: flagged "No quantity stated", no invented "Prescribed 0" block
    let t = await line("g6").innerText(); assert.match(t, /No quantity stated/); assert.doesNotMatch(t, /PRESCRIBED/i); assert.match(t, /Waiting/);
    // stopped after partial dispensing
    await f.locator('#filters [data-f="stopped"]').click(); await line("g5").waitFor(); t = await line("g5").innerText();
    assert.match(t, /Stopped, do not dispense/); assert.match(t, /4\s+DISPENSED/i); assert.match(t, /6\s+OUTSTANDING/i);
    await line("g5").click(); await f.locator("#actCard [data-act=close]").waitFor(); const p = await f.locator("#actCard").innerText();
    assert.match(p, /STOPPED by the prescriber/); assert.match(p, /Dr Test/); assert.match(p, /Reason: Allergic reaction/); assert.match(p, /4 Tablet already dispensed stays on record/); assert.match(p, /Do not dispense the remaining 6/);
    assert.equal(await f.locator('#actCard [data-act="confirm"], #actCard [data-act="dispense"], #actCard #dispBtn').count(), 0, "no dispense button on a stopped prescription");
    // the group header counts it as stopped, patient named once per visit
    await f.locator('#filters [data-f="stopped"]').click(); const g = await f.locator('#list .rxgroup:has(.pt[data-id="g5"])').innerText(); assert.match(g, /1 stopped/); assert.equal((g.match(/John Doe/g) || []).length, 1);
    assert.equal(await f.locator("#list").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, "no sideways scroll");
    await page.screenshot({ path: "docs/screenshots-dev3/stage3-stopped-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" });
    await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("PHARMACY STAGE 3 CHECK PASSED (stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
