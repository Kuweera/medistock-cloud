/* Developer 3: proves, in the real encounter.html (Chromium, in-memory stand-in; NOT real Firebase), that the "Required: ..." line shown above each visit form is true:
   an empty form is refused, and a form with ONLY the required box filled is saved. Run: python3 -m http.server 8765, then node tests/required-check.js */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const URL = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
  await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
  const tab = t => f.locator('[data-t="' + t + '"]').click();
  const all = c => page.evaluate(c => window.__db.all(c), c);
  const msg = async id => (await f.locator("#" + id).innerText()).trim();
  const form = async (t, note, btn, msgId, emptyRe, fill, coll, check) => {
    await tab(t);
    const shown = await f.locator("#req-" + note).innerText(); assert.match(shown, /Required:|optional/i, note + " note is on screen");
    const before = (await all(coll)).length;
    await f.locator("#" + btn).click(); await page.waitForTimeout(250);
    assert.match(await msg(msgId), emptyRe, note + ": empty form is refused"); assert.equal((await all(coll)).length, before, note + ": nothing saved when empty");
    await fill(); await f.locator("#" + btn).click(); await page.waitForTimeout(450);
    const rows = await all(coll); assert.equal(rows.length, before + 1, note + ": saved with only the required box filled");
    if (check) check(rows[rows.length - 1]);
  };
  // 1 triage: every box optional, but at least one entry
  await form("triage", "triage", "tSaveBtn", "tMsg", /at least one/i, async () => { await f.locator("#tCat").selectOption({ index: 1 }); }, "pc_triage", r => { assert.equal(r.temperatureC, null); assert.equal(r.pulse, null); });
  // 2 complaint: only the complaint
  await form("consult", "complaint", "cSaveBtn", "cMsg", /Enter the complaint/i, async () => { await f.locator("#cName").fill("TEST cough"); }, "pc_complaints", r => { assert.equal(r.name, "TEST cough"); assert.equal(r.durationValue, null); });
  // 3 earlier medicine: only the name
  await form("consult", "priormed", "mSaveBtn", "mMsg", /medicine name/i, async () => { await f.locator("#mName").fill("TESTmed"); }, "pc_prior_medications", r => assert.equal(r.medicineName, "TESTmed"));
  // 4 diagnosis: only the diagnosis (a malformed code is refused when given)
  await tab("dx"); await f.locator("#dName").fill("TEST dx"); await f.locator("#dIcd").fill("12"); await f.locator("#dSaveBtn").click(); await page.waitForTimeout(250);
  assert.match(await msg("dMsg"), /ICD-10 code looks wrong/i); assert.equal((await all("pc_diagnoses")).length, 0, "bad ICD code not saved");
  await f.locator("#dIcd").fill(""); await f.locator("#dName").fill("");
  await form("dx", "dx", "dSaveBtn", "dMsg", /Enter the diagnosis/i, async () => { await f.locator("#dName").fill("TEST dx"); }, "pc_diagnoses", r => { assert.equal(r.name, "TEST dx"); assert.equal(r.icd10, null); });
  // 5 treatment plan: only the title
  await tab("treat"); await f.locator("#pTitle").fill(""); const plansBefore = (await all("pc_treatment_plans")).length;
  await f.locator("#pSaveBtn").click(); await page.waitForTimeout(250);
  assert.match(await msg("pMsg"), /title/i); assert.equal((await all("pc_treatment_plans")).length, plansBefore);
  await f.locator("#pTitle").fill("TEST plan two"); await f.locator("#pSaveBtn").click(); await page.waitForTimeout(450);
  assert.equal((await all("pc_treatment_plans")).length, plansBefore + 1, "plan saved with only a title");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("required-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
