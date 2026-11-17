/* Developer 3: proves the medication administration screen (treatment.html) in Chromium against an in-memory Firestore stand-in (NOT real Firebase).
   Run:  python3 -m http.server 8765  (repo root), then  node tests/treatment-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/treatment-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(q, w, h) {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 } });
    const page = await ctx.newPage(); const dialogs = [];
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(URL + (q ? "?" + q : "")); const f = page.frameLocator("#f");
    await f.locator("[data-ev]").first().waitFor(); await f.locator("[data-ev]").first().click(); await f.locator("#actCard:not(.hidden)").waitFor();
    return { page, f, dialogs };
  }
  const all = (page, c) => page.evaluate(c => window.__db.all(c), c);

  // 1. the screen explains itself
  { const { page, f } = await open("");
    const card = await f.locator("#actCard").innerText();
    assert.match(card, /TESTmed 500 mg/); assert.match(card, /Dispensing from the pharmacy is recorded separately/);
    for (const w of [/Which button\?/, /Hold:.*wait on purpose/s, /Not given:.*will not be given/s, /Missed:.*time passed/s, /Patient refused:/]) assert.match(card, w);
    assert.match(card, /Date this happened/); assert.match(card, /Time this happened/); assert.match(card, /Reason \(needed for everything except Given\)/);
    assert.match(card, /Change it only if you gave a different amount/);
    await page.screenshot({ path: OUT + "/administration-mobile.png" });
  }
  // 2. a reason is required; nothing is saved without one
  { const { page, f, dialogs } = await open("");
    await f.locator('[data-out="not_given"]').click();
    assert.ok(dialogs.some(m => /reason/i.test(m)), "asked for a reason"); assert.equal((await all(page, "pc_mar_records")).length, 0);
    // 3. Missed with a reason is recorded with who, when and why, and the event status changes
    await f.locator("#aReason").fill("Nurse was called to an emergency"); await f.locator('[data-out="missed"]').click(); await page.waitForTimeout(400);
    const r = await all(page, "pc_mar_records"); assert.equal(r.length, 1);
    assert.equal(r[0].outcome, "missed"); assert.equal(r[0].omissionReason, "Nurse was called to an emergency"); assert.equal(r[0].administeredByName, "Dr Owner"); assert.ok(r[0].actualAt > 0);
    assert.equal((await all(page, "pc_treatment_events")).find(e => e._id === "ev1").status, "missed");
  }
  // 4. Given records the dose, and is separate from dispensing (no pharmacy records are written or required)
  { const { page, f } = await open("");
    await f.locator("#aDose").fill("1"); await f.locator('[data-out="administered"]').click(); await page.waitForTimeout(400);
    const r = await all(page, "pc_mar_records"); assert.equal(r.length, 1); assert.equal(r[0].outcome, "administered"); assert.equal(r[0].actualDoseValue, 1); assert.equal(r[0].prescribedDoseValue, 2);
    for (const c of ["dispense_records", "prescriptions", "sales", "inventory"]) assert.equal((await all(page, c)).length, 0, c + " untouched by giving a medicine");
    await page.waitForTimeout(300); assert.match(await f.locator("body").innerText(), /Recorded on this phone: Given/); assert.equal(await f.locator("#actCard").isVisible(), false, "the card closes after recording");
  }
  // 5. a matching allergy blocks Given until a clinician's authorisation is ticked
  { const { page, f, dialogs } = await open("allergy=1");
    assert.match(await f.locator("#actCard").innerText(), /matches a recorded allergy/);
    await f.locator('[data-out="administered"]').click(); assert.ok(dialogs.some(m => /allergy/i.test(m))); assert.equal((await all(page, "pc_mar_records")).length, 0);
    await page.screenshot({ path: OUT + "/administration-allergy-mobile.png" });
  }
  // 6. desktop layout and no sideways scrolling on a small phone
  { const d = await open("", 1280, 900); await d.page.screenshot({ path: OUT + "/administration-desktop.png" }); }
  { const s = await open("", 320, 640); assert.equal(await s.f.locator("body").evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "no sideways scrolling at 320px"); }
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("treatment-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
