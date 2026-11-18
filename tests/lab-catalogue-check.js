/* Developer 4: the flexible test catalogue editor in Chromium (in-memory stand-in, NOT real Firebase). */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
  await page.goto("http://localhost:8765/tests/lab-harness.html?page=catalogue");
  const f = page.frameLocator("#f"); await f.locator("#showFormBtn").waitFor(); await page.waitForTimeout(400);
  const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]);
  const msg = () => f.locator("#fMsg").innerText();
  // scale test: refuses to save without terms (nothing is filled in for the facility)
  await f.locator("#showFormBtn").click();
  await f.locator("#fName").fill("TEST scale test"); await f.locator("#fCat").selectOption("urinalysis"); await f.locator("#fType").selectOption("semiquant");
  await f.locator("#fSaveBtn").click(); await page.waitForTimeout(200); assert.match(await msg(), /scale terms/i); assert.equal((await db("all", "pc_inv_catalogue")).length, 0);
  await f.locator("#fScale").fill("Tr = my local meaning\nTrr\n1+"); await f.locator("#fSaveBtn").click(); await page.waitForTimeout(300);
  let c = (await db("all", "pc_inv_catalogue"))[0]; assert.deepEqual(c.scale, [{ term: "Tr", meaning: "my local meaning" }, { term: "Trr", meaning: "" }, { term: "1+", meaning: "" }]); assert.equal(c.approvalStatus, "approved");
  // critical limits need a source
  await f.locator("#showFormBtn").click(); await f.locator("#fName").fill("TEST number test"); await f.locator("#fCat").selectOption("biochemistry"); await f.locator("#fType").selectOption("number");
  await f.locator("#critDet summary").click(); await f.locator("#fCritLow").fill("5"); await f.locator("#fSaveBtn").click(); await page.waitForTimeout(200); assert.match(await msg(), /critical/i);
  await f.locator("#fCritSrc").fill("Test source"); await f.locator("#fSaveBtn").click(); await page.waitForTimeout(300);
  assert.equal((await db("all", "pc_inv_catalogue")).find(x => x.name === "TEST number test").critical.low, 5);
  // panel from template: structure only, empty scale terms must be completed before saving; saved as draft
  await f.locator("#showFormBtn").click(); await f.locator("#tplPick").selectOption("t_urine"); await page.waitForTimeout(200);
  assert.equal(await f.locator("#fType").inputValue(), "multi"); assert.equal(await f.locator("#fUnits").inputValue(), ""); assert.equal(await f.locator("#fApproval").inputValue(), "draft");
  await page.screenshot({ path: OUT + "/lab-catalogue-panel-mobile.png", fullPage: true });
  await f.locator("#fSaveBtn").click(); await page.waitForTimeout(200); assert.match(await msg(), /scale terms|add the/i, "template does not invent scale terms");
  assert.equal((await db("all", "pc_inv_catalogue")).length, 2);
  assert.deepEqual(errors, []); await browser.close(); console.log("lab-catalogue-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
