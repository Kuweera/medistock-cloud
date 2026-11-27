/* Developer 3: address links.
   encounter.html?id=<visit>&tab=triage|consultation|notes|tests|diagnosis|treatment|close   and   pharmacy.html?patient=<patient id or name>
   Real pages in headless Chromium at 390px against the in-memory stand-ins (NOT real Firebase). The harness iframe is pointed at the address, as app.html does.
   Run: python3 -m http.server 8765 (repo root), then node tests/stageL-links-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", HOST = "http://localhost:8765/tests/";

(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(harness, addr) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(HOST + harness); await page.waitForTimeout(500);
    await page.evaluate(a => { document.getElementById("f").src = a; }, addr); await page.waitForTimeout(1300);
    return { page, f: page.frameLocator("#f") };
  }
  /* ================= encounter.html ================= */
  const INTERNAL = { triage: "triage", consultation: "consult", notes: "notes", tests: "tests", diagnosis: "dx", treatment: "treat", close: "close" }, ALL = Object.values(INTERNAL);
  async function shown(f) { const out = []; for (const t of ALL) if (!(await f.locator("#tab-" + t).evaluate(e => e.classList.contains("hidden")))) out.push(t); return out; }
  const msg = async f => (await f.locator("#linkMsg").evaluate(e => e.classList.contains("hidden"))) ? "" : (await f.locator("#linkMsg").innerText()).trim();
  const ENC = "/encounter.html?id=e1";

  // owner: every accepted value opens its tab, exactly one tab is shown, its button is selected, no message
  for (const [v, t] of Object.entries(INTERNAL)) {
    const { page, f } = await open("encounter-harness.html", ENC + "&tab=" + v);
    assert.deepEqual(await shown(f), [t], "tab=" + v + " opens " + t);
    assert.equal(await f.locator('#tabs [data-t="' + t + '"]').evaluate(e => e.classList.contains("selected")), true); assert.equal(await msg(f), "", "owner: no message for " + v);
    if (v === "treatment") await page.screenshot({ path: OUT + "/stageL-encounter-tab-treatment-mobile.png" });
    await page.close();
  }
  // no tab / unknown / empty / odd values: normal first tab, no message, no error
  for (const q of ["", "&tab=", "&tab=bogus", "&tab=constructor", "&tab=__proto__", "&tab=consult", "&tab=treat", "&tab=%3Cb%3E"]) {
    const { page, f } = await open("encounter-harness.html", ENC + q); assert.deepEqual(await shown(f), ["triage"], "address '" + q + "' opens the first tab"); assert.equal(await msg(f), ""); await page.close();
  }
  // case and spaces are tolerated
  { const { page, f } = await open("encounter-harness.html", ENC + "&tab=%20Treatment%20"); assert.deepEqual(await shown(f), ["treat"]); await page.close(); }
  // the id is still needed and works with the tab in any position
  { const { page, f } = await open("encounter-harness.html", "/encounter.html?tab=notes&id=e1"); assert.deepEqual(await shown(f), ["notes"]); await page.close(); }
  // a visit that does not exist: the usual gate message, no crash
  { const { page, f } = await open("encounter-harness.html", "/encounter.html?id=nope&tab=treatment"); await page.waitForTimeout(500); assert.match(await f.locator("#gateCard").innerText(), /not found|No visit/i); await page.close(); }
  // a user WITHOUT the permission (nurse: patient.view, consult.record, consult.sign): visit opens normally on the first tab and says so
  const NURSE = "encounter-harness.html?as=nopres";
  for (const [v, ok] of [["consultation", true], ["notes", true], ["triage", false], ["tests", false], ["diagnosis", false], ["treatment", false], ["close", false]]) {
    const { page, f } = await open(NURSE, ENC + "&tab=" + v);
    if (ok) { assert.deepEqual(await shown(f), [INTERNAL[v]], "nurse may open " + v); assert.equal(await msg(f), ""); }
    else { assert.deepEqual(await shown(f), ["triage"], "nurse without permission for " + v + " gets the visit opened normally"); assert.match(await msg(f), /^You do not have permission to use the .+ tab, so the visit was opened on the first tab\.$/, v + ": " + await msg(f));
      assert.equal(await f.locator("#mainArea").evaluate(e => !e.classList.contains("hidden")), true, "the visit itself is open"); if (v === "treatment") await page.screenshot({ path: OUT + "/stageL-encounter-no-permission-mobile.png" }); }
    await page.close();
  }
  // the tab buttons still work after a link, and a link does not lock the tabs
  { const { page, f } = await open("encounter-harness.html", ENC + "&tab=treatment"); await f.locator('#tabs [data-t="notes"]').click(); assert.deepEqual(await shown(f), ["notes"]); await f.locator('#tabs [data-t="triage"]').click(); assert.deepEqual(await shown(f), ["triage"]); await page.close(); }

  /* ================= pharmacy.html ================= */
  const rowsOf = async f => f.locator("#list .pt").evaluateAll(n => n.map(x => x.dataset.id));
  const patientsOf = async f => [...new Set((await f.locator("#list .rxgroup").allInnerTexts()).map(t => (t.match(/Test Patient \w+/) || [""])[0]))];
  { // no parameter: everyone, no note
    const { page, f } = await open("harness-stage6.html", "/pharmacy.html"); const all = await rowsOf(f); assert.ok(all.length >= 3, "several rows without a filter: " + all); assert.equal(await f.locator("#pfNote").evaluate(e => e.classList.contains("hidden")), true);
    const pats = await patientsOf(f); assert.ok(pats.length >= 2, "several patients without a filter: " + pats);
    // by patient id
    await page.evaluate(() => { document.getElementById("f").src = "/pharmacy.html?patient=p9"; }); await page.waitForTimeout(1300);
    const p9 = await rowsOf(f); assert.ok(p9.length >= 1 && p9.length < all.length, "only patient p9: " + p9); assert.deepEqual(await patientsOf(f), ["Test Patient Nine"]);
    assert.match(await f.locator("#pfNote").innerText(), /Showing prescriptions for: p9\s*Show everyone/); await page.screenshot({ path: OUT + "/stageL-pharmacy-patient-mobile.png" });
    // clearing
    await f.locator("#pfClear").click(); await page.waitForTimeout(300); assert.deepEqual((await rowsOf(f)).sort(), all.slice().sort(), "Show everyone restores the whole queue"); assert.equal(await f.locator("#pfNote").evaluate(e => e.classList.contains("hidden")), true);
    // by name: part of the name, any case, spaces encoded
    for (const q of ["Nine", "nine", "test%20patient%20nine"]) { await page.evaluate(a => { document.getElementById("f").src = a; }, "/pharmacy.html?patient=" + q); await page.waitForTimeout(1300); assert.deepEqual((await rowsOf(f)).sort(), p9.slice().sort(), "name '" + q + "' = patient p9"); }
    // unknown patient: nothing listed, still a way back
    await page.evaluate(() => { document.getElementById("f").src = "/pharmacy.html?patient=nobody-here"; }); await page.waitForTimeout(1300); assert.deepEqual(await rowsOf(f), []); assert.equal(await f.locator("#pfClear").count(), 1);
    // markup in the value is shown as text, never run
    await page.evaluate(() => { document.getElementById("f").src = "/pharmacy.html?patient=%3Cimg%20src%3Dx%20onerror%3Dwindow.top.__xss%3D1%3E"; }); await page.waitForTimeout(1300);
    assert.equal(await f.locator("#pfNote img").count(), 0, "no element is created from the address"); assert.equal(await page.evaluate(() => window.__xss === 1), false); assert.match(await f.locator("#pfNote").innerText(), /<img/);
    // the other tabs still work with a filter: it applies to every tab, counts and statuses are untouched
    await page.evaluate(() => { document.getElementById("f").src = "/pharmacy.html?patient=p9"; }); await page.waitForTimeout(1300); await f.locator('#filters [data-f="partial"]').click(); await f.locator('#filters [data-f="waiting"]').click(); await page.waitForTimeout(200);
    assert.deepEqual((await rowsOf(f)).sort(), p9.slice().sort()); await page.close();
  }
  assert.equal(errors.length, 0, "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("address links: OK");
})().catch(e => { console.error(e); process.exit(1); });
