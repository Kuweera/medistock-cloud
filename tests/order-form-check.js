/* Developer 3: the medicine and procedure order form in the real encounter.html (Chromium, in-memory stand-in; NOT real Firebase): proves the "Required: ..." line.
   Run: python3 -m http.server 8765, then node tests/order-form-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
  await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
  const orders = () => page.evaluate(() => window.__db.all("pc_treatment_orders")), msg = async () => (await f.locator("#obMsg").innerText()).trim();
  const openMed = async () => { await f.locator('[data-t="treat"]').click(); await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor(); };
  const save = async () => { await f.locator("#obSaveBtn").click(); await page.waitForTimeout(500); };
  await openMed(); assert.match(await f.locator("#req-order").innerText(), /For a medicine, required/);
  await f.locator("#obType").selectOption("once");
  // medicine: each required box is refused when empty
  await save(); assert.match(await msg(), /Enter the medicine/);
  await f.locator("#obMed").fill("TESTmed"); await save(); assert.match(await msg(), /Enter the dose\b/);
  await f.locator("#obDose").fill("1"); await save(); assert.match(await msg(), /dose unit/);
  await f.locator("#obUnit").fill("tablet"); await save(); assert.match(await msg(), /route/);
  assert.equal((await orders()).length, 0, "nothing saved while incomplete");
  // medicine + dose + unit + route + start (pre-filled) are enough for a once-only order. Strength, form, instructions, quantity are optional
  await f.locator("#obRoute").fill("by mouth"); await save();
  let o = await orders(); assert.equal(o.length, 1, "saved with only the required boxes"); assert.equal(o[0].medicineName, "TESTmed"); assert.equal(o[0].scheduleType, "once");
  // the pattern's own boxes are required: regular intervals needs hours and a count; as-needed needs what it is for, the shortest gap and the daily maximum
  const fill = async (n) => { await f.locator("#obMed").fill(n || "TESTmed2"); await f.locator("#obDose").fill("1"); await f.locator("#obUnit").fill("tablet"); await f.locator("#obRoute").fill("by mouth"); };
  await openMed(); await fill(); await f.locator("#obType").selectOption("interval"); await save(); assert.match(await msg(), /hours between doses and how many doses/);
  await f.locator("#obEvery").fill("8"); await f.locator("#obCount").fill("6"); await save(); o = await orders(); assert.equal(o.length, 2, "interval order saved"); 
  await openMed(); await fill("TESTmed3"); await f.locator("#obType").selectOption("prn"); await save(); assert.match(await msg(), /shortest time allowed|most doses allowed|what the as-needed dose is for/);
  await f.locator("#obInd").fill("Pain"); await f.locator("#obMinInt").fill("6"); await f.locator("#obMaxDay").fill("3"); await save(); o = await orders();
  await page.screenshot({ path: OUT + "/order-asneeded-required-mobile.png" });
  // a safety warning (the same medicine is already ordered) needs a written reason before the order is saved
  await openMed(); await fill("TESTmed2"); await f.locator("#obType").selectOption("once"); await save(); assert.match(await msg(), /warnings\. Write why it is safe to continue/); assert.equal((await orders()).length, 3, "not saved without the reason");
  await f.locator("#obOverride").fill("Second course agreed with the prescriber"); await save(); o = await orders(); assert.equal(o.length, 4, "saved once the reason is written"); assert.equal(o[3].overrideReason, "Second course agreed with the prescriber");
  // procedure: only the procedure and the start
  await f.locator('[data-t="treat"]').click(); await f.locator("[data-addproc]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor(); await f.locator("#obType").selectOption("once");
  await save(); assert.match(await msg(), /Enter the procedure/);
  await f.locator("#obProc").fill("TEST dressing"); await save(); o = await orders(); assert.equal(o.length, 5, "procedure saved with only its name and the start"); assert.equal(o[4].kind, "procedure");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("order-form-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
