/* Pharmacy queue groups medicines under one prescription header per patient + visit.
   Run: node tests/pharmacy-grouping-check.js  (repo served on :8765). In-memory stand-in only: no rules, no real Firebase. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(String(e)));
    await page.goto("http://localhost:8765/tests/harness-group.html");
    const f = page.frameLocator("#f");
    await f.locator("#list .rxgroup").first().waitFor();
    const heads = await f.locator("#list .rxgroup").evaluateAll(els => els.map(e => ({ name: e.querySelector(".rxhead .pt-name").innerText, meta: e.querySelector(".rxhead .pt-meta").innerText, lines: e.querySelectorAll(".pt[data-id]").length, text: e.innerText })));
    const john = heads.filter(h => /John Doe/.test(h.name));
    assert.equal(john.length, 2, vp.width + ": John Doe has two prescriptions (two visits), not one per medicine");
    const v123 = john.find(h => /V-123/.test(h.meta)), v124 = john.find(h => /V-124/.test(h.meta));
    assert.ok(v123 && v124, "each visit has its own header");
    assert.equal(v123.lines, 3, "three medicines under visit V-123"); assert.equal(v124.lines, 1, "later visit not merged");
    ["GroupMed Amoxicillin", "GroupMed Paracetamol", "GroupMed Cetirizine"].forEach(m => assert.match(v123.text, new RegExp(m)));
    assert.doesNotMatch(v123.text, /GroupMed Later Visit/);
    assert.equal((v123.text.match(/John Doe/g) || []).length, 1, "patient named once per prescription");
    assert.match(v123.meta, /3 medicines/); assert.match(v123.meta, /2 waiting/); assert.match(v123.meta, /1 partly dispensed/);
    // each line keeps its own status
    const line = id => f.locator('#list .pt[data-id="' + id + '"]');
    assert.match(await line("g1").innerText(), /Waiting/); assert.match(await line("g2").innerText(), /Partly dispensed/); assert.match(await line("g2").innerText(), /outstanding/i);
    // a line still opens the dispensing panel
    await line("g3").click(); await f.locator("#actCard .step").first().waitFor();
    assert.match(await f.locator("#actCard").innerText(), /GroupMed Cetirizine/);
    // no horizontal overflow on a phone
    const over = await f.locator("#list").evaluate(e => e.scrollWidth > e.clientWidth + 1); assert.equal(over, false, vp.width + ": no sideways scroll");
    // partial tab lists the whole prescription, with the partly dispensed line
    await f.locator('#filters [data-f="partial"]').click();
    const t = await f.locator("#list").innerText(); assert.match(t, /John Doe/); assert.match(t, /GroupMed Paracetamol/);
    assert.deepEqual(errors, [], "no page errors");
    await page.screenshot({ path: "docs/screenshots-dev3/stage1-grouping-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" });
    await ctx.close();
  }
  await browser.close(); console.log("PHARMACY GROUPING CHECK PASSED");
})().catch(e => { console.error(e); process.exit(1); });
