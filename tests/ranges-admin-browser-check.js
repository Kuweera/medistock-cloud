/* Developer 4, Stage 3B: the ranges and alert-rules tab of investigations.html in Chromium (phone and desktop sizes).
   In-memory Firestore stand-in, NOT real Firebase, NO security rules. TEST values only, invented for testing. Run: python3 -m http.server 8765 (repo root), then node tests/ranges-admin-browser-check.js [outdir] */
const { chromium } = require("playwright"), assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage(); page.on("pageerror", e => errors.push(name + ": " + String(e))); page.on("dialog", d => d.accept());
    await page.goto("http://localhost:8765/tests/lab-harness.html?page=catalogue");
    const f = page.frameLocator("#f"); await f.locator("#tabRanges").waitFor(); await page.waitForTimeout(400);
    const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]); const wait = (ms = 250) => page.waitForTimeout(ms);
    await db("add", "pc_inv_catalogue", "c1", { businessId: "biz1", facilityId: "shop1", name: "TEST number test", category: "biochemistry", resultType: "number", units: "tu", active: true, approvalStatus: "approved" });
    await f.locator("#tabRanges").click(); await wait();
    assert.match(await f.locator("#rList").innerText(), /Reference range not configured/);
    // 1. a vital-sign range: refused without a source; saved as a draft with the right shape
    await f.locator("#rNewBtn").click(); await f.locator("#rSubject").selectOption("pulse"); assert.equal(await f.locator("#rUnit").inputValue(), "/min");
    await f.locator("#rRefMin").fill("1,5"); await f.locator("#rSaveBtn").click(); await wait(); assert.match(await f.locator("#rFMsg").innerText(), /decimal point/);
    await f.locator("#rRefMin").fill("10"); await f.locator("#rRefMax").fill("20"); await f.locator("#rSaveBtn").click(); await wait(); assert.match(await f.locator("#rFMsg").innerText(), /source/i);
    await f.locator("#rSource").fill("TEST source"); await f.locator("#rSaveBtn").click(); await wait(); assert.match(await f.locator("#rFMsg").innerText(), /age limit/);
    await f.locator("#rAllAges").check(); await f.locator("#rSaveBtn").click(); await wait(400);
    let rr = await db("all", "pc_reference_ranges"); assert.equal(rr.length, 1); const d1 = rr[0]; assert.equal(d1.approvalStatus, "draft"); assert.equal(d1.origin, "custom"); assert.equal(d1.refMin, 10); assert.equal(d1.allAges, true); assert.equal(d1._id, "rr_" + d1.rangeKey + "_v1"); assert.equal(Object.values(d1).includes(null), false); assert.equal(d1.createdBy, "owner1");
    assert.match(await f.locator("#rList").innerText(), /Draft \(not in use\)/);
    // 2. approve: the reviewer credential is required; approving your own draft is labelled, not blocked
    await f.locator("[data-ract=approve]").first().click(); assert.match(await f.locator("#rAWarn").innerText(), /self-approved/); await f.locator("#rAGo").click(); await wait(); assert.match(await f.locator("#rAMsg").innerText(), /reviewer/i);
    await f.locator("#rCred").fill("TEST role"); await f.locator("#rAGo").click(); await wait(); assert.match(await f.locator("#rAMsg").innerText(), /effective date/i);
    await f.locator("#rACancel").click(); await f.locator("[data-ract=edit]").first().click(); assert.equal(await f.locator("#rSubject").isDisabled(), true, "the subject is locked on edit"); await f.locator("#rEff").fill("2026-01-01"); await f.locator("#rFormCard summary", { hasText: "More context" }).click(); await f.locator("#rBoundary").fill("TEST boundary"); await f.locator("#rSaveBtn").click(); await wait(400);
    rr = await db("all", "pc_reference_ranges"); assert.equal(rr[0].effectiveDate, "2026-01-01"); assert.equal(rr[0].boundaryNote, "TEST boundary"); assert.equal(rr[0].approvalStatus, "draft"); assert.equal(rr[0].createdAt, d1.createdAt);
    await f.locator("[data-ract=approve]").first().click(); await f.locator("#rCred").fill("TEST role"); await f.locator("#rAGo").click(); await wait(400);
    rr = await db("all", "pc_reference_ranges"); assert.equal(rr[0].approvalStatus, "approved"); assert.equal(rr[0].selfApproved, true); assert.equal(rr[0].reviewerCredential, "TEST role"); assert.match(await f.locator("#rList").innerText(), /same person who created it/);
    // 3. a new version above the approved one; approving it replaces the old one in the same commit
    await f.locator("[data-ract=version]").first().click(); assert.match(await f.locator("#rFTitle").innerText(), /v2/); await f.locator("#rRefMax").fill("25"); await f.locator("#rEff").fill("2026-06-01"); await f.locator("#rReason").fill("TEST reason"); await f.locator("#rSaveBtn").click(); await wait(400);
    rr = await db("all", "pc_reference_ranges"); assert.equal(rr.length, 2); const v2 = rr.find(x => x.version === 2); assert.equal(v2.rangeKey, d1.rangeKey); assert.equal(v2.approvalStatus, "draft"); assert.equal(v2.changeReason, "TEST reason"); assert.equal(rr.find(x => x.version === 1).approvalStatus, "approved", "the old one stays in use until the new one is approved");
    await f.locator("#rStatus").selectOption("draft"); await f.locator("[data-ract=approve]").first().click(); assert.match(await f.locator("#rAWarn").innerText(), /replaces the version now in use/); await f.locator("#rCred").fill("TEST role"); await f.locator("#rAGo").click(); await wait(400);
    rr = await db("all", "pc_reference_ranges"); assert.equal(rr.find(x => x.version === 1).approvalStatus, "superseded"); assert.equal(rr.find(x => x.version === 1).supersededBy, v2._id); assert.equal(rr.find(x => x.version === 2).approvalStatus, "approved");
    // 4. a lab range from the catalogue (unit prefilled, text-only interval allowed)
    await f.locator("#rStatus").selectOption(""); await f.locator("#rNewBtn").click(); await f.locator("#rSubType").selectOption("lab_test"); await f.locator("#rSubject").selectOption("c1"); assert.equal(await f.locator("#rUnit").inputValue(), "tu");
    await f.locator("#rRefText").fill("TEST text interval"); await f.locator("#rSource").fill("TEST lab source"); await f.locator("#rSaveBtn").click(); await wait(400); assert.equal((await db("all", "pc_reference_ranges")).length, 3);
    assert.match(await f.locator("#rList").innerText(), /text only: no flag is calculated/);
    // 5. an alert rule: emergency forces acknowledgement; reject keeps it with the reason; nothing is deleted
    await f.locator("#kRule").click(); await f.locator("#rNewBtn").click(); await f.locator("#rSubject").selectOption("spo2"); await f.locator("#rRuleType").selectOption("emergency"); assert.equal(await f.locator("#rAck").isChecked(), true); assert.equal(await f.locator("#rAck").isDisabled(), true);
    await f.locator("#rValue").fill("5"); await f.locator("#rMessage").fill("ab"); await f.locator("#rSaveBtn").click(); await wait(); assert.match(await f.locator("#rFMsg").innerText(), /at least 3/);
    await f.locator("#rMessage").fill("TEST message"); await f.locator("#rSource").fill("TEST source"); await f.locator("#rAllAges").check(); await f.locator("#rSaveBtn").click(); await wait(400);
    let ar = await db("all", "pc_alert_rules"); assert.equal(ar.length, 1); assert.equal(ar[0].level, "critical"); assert.equal(ar[0].requiresAck, true); assert.equal(ar[0].ruleType, "emergency"); assert.equal(ar[0]._id, "ar_" + ar[0].ruleKey + "_v1");
    await f.locator("[data-ract=reject]").first().click(); await f.locator("#rAGo").click(); await wait(); assert.match(await f.locator("#rAMsg").innerText(), /reason/i); await f.locator("#rReasonTxt").fill("TEST rejection"); await f.locator("#rAGo").click(); await wait(400);
    ar = await db("all", "pc_alert_rules"); assert.equal(ar[0].approvalStatus, "rejected"); assert.equal(ar[0].rejectedReason, "TEST rejection"); assert.equal(ar[0].rejectedBy, "owner1");
    await f.locator("#kRange").click();
    // 6. importer: drafts only; an existing id is skipped; approval fields refused; re-import creates nothing
    const file = JSON.stringify({ format: "medistock-range-proposals", formatVersion: 1, proposals: [
      { kind: "range", key: "tpimp1", version: 1, subjectType: "lab_test", subjectId: "c1", unit: "tu", refMin: 1, refMax: 2, source: "TEST src", reviewRequired: true, sourceUrl: "javascript:alert(1)" },
      { kind: "range", key: d1.rangeKey, version: 1, subjectType: "vital", subjectId: "pulse", unit: "/min", allAges: true, refMin: 1, refMax: 2, source: "TEST src" },
      { kind: "range", key: "tpimp3", version: 1, subjectType: "lab_test", subjectId: "c1", unit: "tu", refMin: 1, refMax: 2, source: "TEST src", approvalStatus: "approved" } ] });
    await f.locator("#rFile").setInputFiles({ name: "p.json", mimeType: "application/json", buffer: Buffer.from(file) }); await wait(600);
    const t = await f.locator("#rImpBody").innerText(); assert.match(t, /Will be created as a draft/); assert.match(t, /Already exists/); assert.match(t, /Drafts only/); assert.match(await f.locator("#rImpGo").innerText(), /Create 1 draft/);
    await f.locator("#rImpGo").click(); await wait(500); rr = await db("all", "pc_reference_ranges"); assert.equal(rr.length, 4); const im = rr.find(x => x._id === "rr_tpimp1_v1"); assert.equal(im.approvalStatus, "draft"); assert.equal(im.origin, "evidence_proposal"); assert.equal(im.proposal.reviewRequired, true); assert.equal("approvedBy" in im, false);
    const body = await f.locator("#rList").innerText(); assert.match(body, /Clinician decision needed/); assert.match(body, /Imported research proposal/); assert.equal(await f.locator("a[href^='javascript']").count(), 0, "an unsafe link is never made clickable");
    await f.locator("#rFile").setInputFiles({ name: "p.json", mimeType: "application/json", buffer: Buffer.from(file) }); await wait(600); assert.equal(await f.locator("#rImpGo").isVisible(), false, "a second import offers nothing to create"); await f.locator("#rImpCancel").click();
    assert.equal((await db("all", "pc_reference_ranges")).length, 4);
    // 7. audit records exist for the important actions; the Tests tab still works; no sideways scrolling
    const au = (await db("all", "pc_audit_logs")).map(x => x.action); for (const a of ["range.create", "range.edit", "range.approve", "range.supersede", "rule.create", "rule.reject", "ranges.import"]) assert.ok(au.includes(a), "audit: " + a);
    await f.locator("#tabTests").click(); await wait(); assert.equal(await f.locator("#testsArea").isVisible(), true); await f.locator("#tabRanges").click();
    const over = await f.locator("body").evaluate(b => b.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1, name + ": sideways scroll of " + over + "px");
    await page.screenshot({ path: OUT + "/ranges-" + name + ".png" });
    console.log(name + ": ok");
  }
  await browser.close(); assert.deepEqual(errors, []); console.log("page errors: none");
})().catch(e => { console.error(e); process.exit(1); });
