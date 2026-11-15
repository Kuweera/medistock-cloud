/* Drives guidelines.html in headless Chromium against the in-memory harness.
   Run:  python3 -m http.server 8765  (from the repo root), then  node tests/guidelines-browser-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
const URL = "http://localhost:8765/tests/guidelines-harness.html";
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(as, w, h, pq) {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); page.on("pageerror", e => errors.push(as + ": " + e)); page.on("console", m => { if (m.type() === "error") errors.push(as + ": " + m.text()); });
    page.on("dialog", d => d.accept(d.type() === "prompt" ? "Test reason" : undefined));
    await page.goto(URL + "?as=" + as + (pq ? "&pq=" + encodeURIComponent(pq) : "")); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); return { page, f, ctx };
  }
  const db = (page, fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]);

  // ---------- ordinary staff (no guideline permissions)
  {
    const { page, f, ctx } = await open("viewer");
    await f.locator("#list .pt").first().waitFor();
    const t = await f.locator("#list").innerText();
    assert.match(t, /TEST topic alpha/); assert.match(t, /TEST topic bravo overdue/); assert.match(t, /TEST local protocol/);
    assert.doesNotMatch(t, /draft charlie/, "drafts hidden from staff"); assert.equal((t.match(/TEST topic alpha/g) || []).length, 1, "old version hidden");
    assert.equal(await f.locator("#fStatusBox").isVisible(), false); assert.equal(await f.locator("#addBtn").isVisible(), false, "no add button without permission");
    assert.match(t, /Local facility protocol/); assert.match(t, /National \/ published/);
    await f.locator("#q").fill("test fev"); assert.equal(await f.locator("#list .pt").count(), 1, "search by symptom, partial words");
    await f.locator("#q").fill(""); await f.locator('#cats [data-c="wound"]').click(); assert.equal(await f.locator("#list .pt").count(), 1);
    await f.locator('#cats [data-c=""]').click();
    await f.locator('#list .pt[data-id="gl_a_v2"]').click(); await f.locator("#refCard h2").waitFor();
    const c = await f.locator("#refCard").innerText();
    ["Patient assessment", "Warning signs", "Investigations", "Management references", "Published by", "Test Org", "p. 1", "Source: Test Guideline", "page", "Reference only"].forEach(s => assert.match(c, new RegExp(s, "i"), s));
    assert.match(c, /Our facility also has its own protocol/); assert.match(c, /Version history/);
    assert.equal(await f.locator('#refCard [data-act="approve"]').count(), 0, "staff cannot approve"); assert.equal(await f.locator('#refCard [data-act="edit"]').count(), 0);
    await f.locator('#refCard [data-act="hist"]').click(); assert.match(await f.locator("#histBox").innerText(), /Version 1[\s\S]*Replaced by a newer version/);
    await f.locator('#refCard [data-act="copy"]').click(); await page.waitForTimeout(100); assert.match(await page.evaluate(() => window.__shared), /Source: Test Guideline/);
    await f.locator('#list .pt[data-id="gl_b_v1"]').click(); assert.match(await f.locator("#refCard").innerText(), /review date .* has passed/i);
    await f.locator('#list .pt[data-id="gl_l_v1"]').click(); assert.match(await f.locator("#refCard").innerText(), /does not replace national guidance/);
    await page.screenshot({ path: OUT + "/g1-staff-mobile.png", fullPage: true });
    await ctx.close();
  }
  // ---------- deep link from another screen
  {
    const { page, f, ctx } = await open("viewer", 390, 844, "q=test%20cough&id=gl_a_v2");
    await f.locator("#refCard h2").waitFor(); assert.equal(await f.locator("#q").inputValue(), "test cough"); assert.match(await f.locator("#refCard h2").innerText(), /alpha/); await ctx.close();
  }
  // ---------- owner: create, approve, new version, retire; offline; permissions
  {
    const { page, f, ctx } = await open("owner", 1280, 900);
    await f.locator("#fStatus").selectOption("draft"); assert.match(await f.locator("#list").innerText(), /draft charlie/);
    await f.locator('#list .pt[data-id="gl_c_v1"]').click();
    let c = await f.locator("#refCard").innerText(); assert.match(c, /Not ready to approve/); assert.match(c, /chapter, section or page/i);
    await f.locator('#refCard [data-act="approve"]').click(); await page.waitForTimeout(150);
    assert.equal((await db(page, "get", "guidelines", "gl_c_v1")).approvalStatus, "draft", "unready draft cannot be approved"); assert.match(await f.locator("#topMsg").innerText(), /missing required information/);
    // new entry through the steps
    await f.locator("#addBtn").click(); await f.locator("#f_title").fill("TEST new entry"); await f.locator("#f_category").selectOption("wound"); await f.locator("#f_symptoms").fill("test bleed, test cut");
    await f.locator('#edCard [data-act="next"]').click();
    for (const [k, v] of [["sourceTitle", "Test Guideline"], ["sourceOrg", "Test Org"], ["sourceEdition", "2024"], ["sourceRef", "p. 9"], ["jurisdiction", "Uganda"], ["effectiveDate", "2026-06-01"], ["reviewDate", "2028-06-01"]]) await f.locator("#f_" + k).fill(v);
    await f.locator('#edCard [data-act="next"]').click(); await f.locator("#f_aQuestions").fill("- TEST q one\n- TEST q two"); await f.locator("#f_wDanger").fill("TEST danger");
    await f.locator('#edCard [data-act="next"]').click(); assert.match(await f.locator("#edCard").innerText(), /Everything needed for approval is filled in/);
    await page.screenshot({ path: OUT + "/g2-editor-desktop.png" });
    await f.locator('#edCard [data-act="save"]').click(); await f.locator("#refCard h2", { hasText: "TEST new entry" }).waitFor();
    const drafts = (await db(page, "all", "guidelines")).filter(g => g.title === "TEST new entry"); assert.equal(drafts.length, 1);
    const d = drafts[0]; assert.equal(d.approvalStatus, "draft"); assert.equal(d.id, d._id); assert.deepEqual(d.symptoms, ["test bleed", "test cut"]); assert.deepEqual(d.assessment.questions, ["TEST q one", "TEST q two"]);
    ["businessId", "facilityId", "schemaVersion", "createdBy", "createdAt", "guidelineKey", "version", "source", "scope", "enteredDate"].forEach(k => assert.ok(d[k] != null, "has " + k));
    // staff view does not show it until approved
    // approve while "offline"
    await page.evaluate(() => Object.defineProperty(window.frames[0].navigator, "onLine", { value: false, configurable: true }));
    await f.locator('#refCard [data-act="approve"]').click(); await page.waitForTimeout(150); assert.match(await f.locator("#topMsg").innerText(), /internet connection/); assert.equal((await db(page, "get", "guidelines", d._id)).approvalStatus, "draft", "no approval offline");
    await page.evaluate(() => Object.defineProperty(window.frames[0].navigator, "onLine", { value: true, configurable: true }));
    await f.locator('#refCard [data-act="approve"]').click(); await page.waitForTimeout(300);
    let a = await db(page, "get", "guidelines", d._id); assert.equal(a.approvalStatus, "approved"); assert.equal(a.approvedBy, "owner1"); assert.equal(typeof a.selfApproved, "boolean");
    // new version of alpha supersedes v2
    await f.locator("#fStatus").selectOption("current"); await f.locator('#list .pt[data-id="gl_a_v2"]').click(); await f.locator('#refCard [data-act="newver"]').click(); await f.locator("#edCard h2").waitFor();
    assert.match(await f.locator("#edCard h2").innerText(), /version 3/); assert.equal(await f.locator("#f_scope").isDisabled(), true, "kind cannot change on an existing entry");
    const v3 = await db(page, "get", "guidelines", "gl_a_v3"); assert.equal(v3.approvalStatus, "draft"); assert.equal(v3.supersedes, "gl_a_v2");
    assert.equal((await db(page, "get", "guidelines", "gl_a_v2")).approvalStatus, "approved", "old version stays current until v3 is approved");
    await f.locator("#f_title").fill("x"); await f.locator('#edCard [data-act="next"]').click(); await f.locator('#edCard [data-act="next"]').click(); await f.locator('#edCard [data-act="next"]').click();
    await f.locator('#edCard [data-act="save"]').click(); await f.locator("#refCard h2", { hasText: "x" }).waitFor({ timeout: 3000 }).catch(() => {});
    await f.locator("#fStatus").selectOption("draft"); await f.locator('#list .pt[data-id="gl_a_v3"]').click(); await f.locator('#refCard [data-act="approve"]').click(); await page.waitForTimeout(300);
    assert.equal((await db(page, "get", "guidelines", "gl_a_v3")).approvalStatus, "approved"); assert.equal((await db(page, "get", "guidelines", "gl_a_v2")).approvalStatus, "superseded"); assert.equal((await db(page, "get", "guidelines", "gl_a_v2")).supersededBy, "gl_a_v3"); assert.equal((await db(page, "get", "guidelines", "gl_a_v1")).approvalStatus, "superseded");
    // approved entries are never edited in place, nothing deleted, audit written
    const audits = (await db(page, "all", "pc_audit_logs")).map(x => x.action); ["guideline.create", "guideline.approve", "guideline.new_version"].forEach(x => assert.ok(audits.includes(x), x)); 
    assert.ok(!(await page.evaluate(() => window.__db.writes)).includes("delete"));
    // retire
    await f.locator("#fStatus").selectOption("current"); await f.locator('#list .pt[data-id="gl_b_v1"]').click(); await f.locator('#refCard [data-act="retire"]').click(); await page.waitForTimeout(300);
    assert.equal((await db(page, "get", "guidelines", "gl_b_v1")).approvalStatus, "retired"); assert.equal((await db(page, "get", "guidelines", "gl_b_v1")).retiredReason, "Test reason");
    // a save that never reaches the server is NOT reported as saved
    await page.evaluate(() => { window.__db.hang = true; }); await f.locator("#addBtn").click(); await f.locator("#f_title").fill("TEST hang"); await f.locator("#f_category").selectOption("wound");
    for (let i = 0; i < 3; i++) await f.locator('#edCard [data-act="next"]').click(); await f.locator('#edCard [data-act="save"]').click();
    await f.locator("#topMsg.err").waitFor({ timeout: 12000 }); assert.match(await f.locator("#topMsg").innerText(), /NOT reached the server|has NOT reached/i); await page.evaluate(() => { window.__db.hang = false; });
    // failure shows plain words
    await page.evaluate(() => { window.__db.failNext = true; }); await f.locator("#addBtn").click(); await f.locator("#f_title").fill("TEST fail"); await f.locator("#f_category").selectOption("wound");
    for (let i = 0; i < 3; i++) await f.locator('#edCard [data-act="next"]').click(); await f.locator('#edCard [data-act="save"]').click(); await f.locator("#edMsg.err").waitFor(); assert.match(await f.locator("#edMsg").innerText(), /no internet/); 
    // import
    await f.locator('#tabs [data-t="library"]').click(); await f.locator('#tabs [data-t="import"]').click();
    await f.locator("#impText").fill(JSON.stringify({ entries: [{ title: "TEST imported", category: "wound" }, { title: "", category: "wound" }] })); await f.locator("#impPreview").click(); await f.locator("#impGo").waitFor();
    assert.match(await f.locator("#impOut").innerText(), /1 entry can be imported as drafts/); await f.locator("#impGo").click(); await page.waitForTimeout(400);
    const imp = (await db(page, "all", "guidelines")).filter(g => g.title === "TEST imported"); assert.equal(imp.length, 1); assert.equal(imp[0].approvalStatus, "draft"); assert.equal(imp[0].origin, "import");
    await page.screenshot({ path: OUT + "/g3-owner-desktop.png" });
    await ctx.close();
  }
  // ---------- manager (can write drafts, cannot approve)
  {
    const { page, f, ctx } = await open("manager");
    await f.locator("#fStatus").selectOption("draft"); await f.locator('#list .pt[data-id="gl_c_v1"]').click();
    assert.equal(await f.locator('#refCard [data-act="approve"]').count(), 0, "manager cannot approve"); assert.equal(await f.locator('#refCard [data-act="edit"]').count(), 1);
    await ctx.close();
  }
  assert.deepEqual(errors, [], "no console or page errors");
  await browser.close(); console.log("browser checks passed");
})().catch(e => { console.error(e); process.exit(1); });
