/* Developer 3: proves the Follow-up plan works INSIDE the real encounter.html (Chromium, in-memory Firestore stand-in; NOT real Firebase).
   Run:  python3 -m http.server 8765  (repo root), then  node tests/followup-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness.html";
const pad = n => String(n).padStart(2, "0");
const typed = d => pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(q, w, h) {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 } });
    const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e)));
    page.on("dialog", d => d.accept());
    await page.goto(URL + (q ? "?" + q : "")); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
    return { page, f, ctx };
  }
  const tab = (f, t) => f.locator('[data-t="' + t + '"]').click();
  const notes = page => page.evaluate(() => window.__db.all("pc_clinical_notes"));
  const future = new Date(); future.setDate(future.getDate() + 14);
  const past = "01/01/2020";

  const { page, f } = await open("");
  await tab(f, "notes");
  // 1. choosing Follow-up plan shows the structured form, hides the plain box, and lists what is still open
  assert.equal(await f.locator("#nFollow").isVisible(), false);
  await f.locator("#nType").selectOption("followup");
  assert.equal(await f.locator("#nFollow").isVisible(), true); assert.equal(await f.locator("#nPlain").isVisible(), false);
  assert.match(await f.locator("#nFuPending").innerText(), /TEST plan/, "active treatment is listed automatically");
  await page.screenshot({ path: OUT + "/followup-form-mobile.png", fullPage: false });
  // 2. validation: empty, bad, past dates are refused and nothing is saved
  await f.locator("#nSignBtn").click();
  assert.match(await f.locator("#nMsg").innerText(), /Add a review date/);
  await f.locator("#nFuDate").fill("31/31/2030"); await f.locator("#nSignBtn").click();
  assert.match(await f.locator("#nMsg").innerText(), /DD\/MM\/YYYY/);
  await f.locator("#nFuDate").fill(past); await f.locator("#nSignBtn").click();
  assert.match(await f.locator("#nMsg").innerText(), /cannot be in the past/);
  assert.equal((await notes(page)).filter(n => n.structured && n.structured.kind === "followup").length, 0, "invalid plans are not saved");
  // 3. a valid plan is saved as an existing note type (no schema or rules change) with a structured follow-up
  await f.locator("#nFuDate").fill(typed(future)); await f.locator("#nFuNext").selectOption("review"); await f.locator("#nFuProg").selectOption("improving");
  await f.locator("#nFuInstr").fill("Rest and drink fluids"); await f.locator("#nSignBtn").click(); await page.waitForTimeout(400);
  const fu = (await notes(page)).filter(n => n.structured && n.structured.kind === "followup");
  assert.equal(fu.length, 1); const n = fu[0];
  assert.equal(n.noteType, "progress", "uses an existing, rules-approved note type"); assert.equal(n.status, "signed");
  assert.equal(n.structured.reviewDate, iso(future)); assert.equal(n.structured.nextAction, "review"); assert.equal(n.structured.progress, "improving");
  assert.deepEqual(n.structured.outstandingTreatment, ["TEST plan"]);
  assert.match(n.content, /Review date: /); assert.match(n.content, /Instructions: Rest and drink fluids/);
  // 4. the note list names it a Follow-up plan, and the close card reminds about the plan and what is still open
  assert.match(await f.locator("#nList").innerText(), /Follow-up plan/);
  await tab(f, "close");
  const rv = await f.locator("#xReview").innerText();
  assert.match(rv, /review on/); assert.match(rv, /TEST plan/); assert.match(rv, /Before you close/);
  await f.locator("#xReview").scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await page.screenshot({ path: OUT + "/close-review-mobile.png" });
  // 5. a visit with no follow-up plan is reminded to add one
  const b = await open("nodata=1"); await tab(b.f, "close");
  assert.match(await b.f.locator("#xReview").innerText(), /No follow-up plan recorded/);
  // 6. desktop layout
  const d = await open("", 1280, 900); await tab(d.f, "notes"); await d.f.locator("#nType").selectOption("followup");
  await d.page.screenshot({ path: OUT + "/followup-form-desktop.png" });
  // 7. no horizontal scrolling on a small phone
  const s = await open("", 320, 640); await tab(s.f, "notes"); await s.f.locator("#nType").selectOption("followup");
  const wide = await s.f.locator("body").evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(wide, false, "no sideways scrolling at 320px");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("followup-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
