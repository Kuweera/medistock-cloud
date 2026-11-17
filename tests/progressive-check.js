/* Developer 3: proves the progressive (collapsible) forms behave: the main fields are visible, the extras start collapsed, and a value entered inside a collapsed section is saved.
   Chromium, in-memory stand-in (NOT real Firebase). Run: python3 -m http.server 8765, then node tests/progressive-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", ENC = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(w, h) { const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(ENC); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500); return { page, f }; }
  const { page, f } = await open(390, 844);
  await f.locator('[data-t="triage"]').click();
  // main measurements are visible at once; the extras are collapsed
  for (const id of ["tTemp", "tPulse", "tSys", "tDia", "tResp", "tSpo2", "tWeight", "tHeight", "tPain", "tCat", "tNotes"]) assert.equal(await f.locator("#" + id).isVisible(), true, id + " visible");
  for (const id of ["tGlu", "tCons", "tMuac"]) assert.equal(await f.locator("#" + id).isVisible(), false, id + " collapsed");
  assert.equal(await f.locator("#tMore").evaluate(e => e.open), false);
  await f.locator("#tMore").scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + "/triage-collapsed-mobile.png" });
  // open it, enter values inside it, and they are saved with the record
  await f.locator("#tMore > summary").click(); assert.equal(await f.locator("#tGlu").isVisible(), true);
  await f.locator("#tTemp").fill("38.2"); await f.locator("#tGlu").fill("5.5"); await f.locator("#tCons").selectOption("alert"); await f.locator("#tMuac").fill("13.5");
  await page.screenshot({ path: OUT + "/triage-expanded-mobile.png" });
  await f.locator("#tSaveBtn").click(); await page.waitForTimeout(500);
  const rows = await page.evaluate(() => window.__db.all("pc_triage")); const r = rows[rows.length - 1];
  assert.equal(r.temperatureC, 38.2); assert.equal(r.glucose, 5.5); assert.equal(r.consciousness, "alert"); assert.equal(r.muacCm, 13.5);
  // collapsed fields that were NOT filled are simply empty, not required
  const only = await open(390, 844); await only.f.locator('[data-t="triage"]').click(); await only.f.locator("#tPulse").fill("88"); await only.f.locator("#tSaveBtn").click(); await only.page.waitForTimeout(400);
  const r2 = (await only.page.evaluate(() => window.__db.all("pc_triage"))).pop(); assert.equal(r2.pulse, 88); assert.equal(r2.glucose, null); assert.equal(r2.muacCm, null);
  // consultation, earlier medicines and diagnosis: main fields visible, extras collapsed, extras saved when filled
  const c = await open(390, 844); const cf = c.f, all = n => c.page.evaluate(n => window.__db.all(n), n);
  await cf.locator('[data-t="consult"]').click();
  for (const id of ["cName", "cOnset", "cDurVal", "cSev", "cProg", "mName", "mStrength", "mDose", "mFreq", "mRoute"]) assert.equal(await cf.locator("#" + id).isVisible(), true, id + " visible");
  for (const id of ["cAssoc", "cAgg", "cRel", "cPrev", "cNotes", "mDur", "mLast", "mDone", "mResp", "mBy"]) assert.equal(await cf.locator("#" + id).isVisible(), false, id + " collapsed");
  await cf.locator("#cMore").scrollIntoViewIfNeeded(); await c.page.screenshot({ path: OUT + "/consultation-collapsed-mobile.png" });
  await cf.locator("#cName").fill("TEST headache"); await cf.locator("#cMore > summary").click(); await cf.locator("#cAgg").fill("TEST bright light"); await cf.locator("#cSaveBtn").click(); await c.page.waitForTimeout(500);
  const comp = (await all("pc_complaints")).find(x => x.name === "TEST headache"); assert.equal(comp.aggravating, "TEST bright light"); assert.equal(comp.associated || "", "", "unfilled extras are simply empty");
  await cf.locator("#mName").fill("TESTmed"); await cf.locator("#mMore > summary").click(); await cf.locator("#mDur").fill("3 days"); await cf.locator("#mSaveBtn").click(); await c.page.waitForTimeout(500);
  assert.equal((await all("pc_prior_medications")).find(x => x.medicineName === "TESTmed").duration, "3 days");
  await cf.locator('[data-t="dx"]').click();
  for (const id of ["dName", "dIcd", "dRole", "dCert"]) assert.equal(await cf.locator("#" + id).isVisible(), true, id + " visible");
  for (const id of ["dFind", "dNotes"]) assert.equal(await cf.locator("#" + id).isVisible(), false, id + " collapsed");
  await cf.locator("#dName").fill("TEST dx"); await cf.locator("#dMore > summary").click(); await cf.locator("#dFind").fill("TEST finding"); await cf.locator("#dSaveBtn").click(); await c.page.waitForTimeout(500);
  assert.equal((await all("pc_diagnoses")).find(x => x.name === "TEST dx").findings, "TEST finding");
  // editing a diagnosis that already has findings opens the section so the saved text is not hidden
  await cf.locator("[data-dxe]").first().click(); await c.page.waitForTimeout(200);
  assert.equal(await cf.locator("#dMore").evaluate(e => e.open), true, "section opens when it holds saved text"); assert.equal(await cf.locator("#dFind").inputValue(), "TEST finding");
  // desktop + no sideways scroll on a small phone
  const d = await open(1280, 900); await d.f.locator('[data-t="triage"]').click(); await d.page.screenshot({ path: OUT + "/triage-desktop.png" });
  const s = await open(320, 640); await s.f.locator('[data-t="triage"]').click(); await s.f.locator("#tMore > summary").click();
  assert.equal(await s.f.locator("body").evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "no sideways scrolling at 320px");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("progressive-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
