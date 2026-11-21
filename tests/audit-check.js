/* Developer 2: read-only audit and access log screen (audit.html). In-memory stand-in (NOT real Firebase); the rules that
   restrict these logs to audit.view are covered by tests-emulator/rules.test.js. Run: python3 -m http.server 8765, then node tests/audit-check.js [shots] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", BASE = "http://localhost:8765/tests/audit-harness.html";
const B = "biz1", F = "shop1", NOW = Date.now(), H = 3600000;
(async () => {
  const browser = await chromium.launch(), errors = [], results = [];
  const ok = n => { results.push(n); console.log("PASS " + n); };
  const sc = { businessId: B, facilityId: F };
  const add = (page, c, id, d) => page.evaluate(a => window.__db.add(a[0], a[1], a[2]), [c, id, d]);
  async function open(w, h, qs) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(BASE + (qs || "")); await page.evaluate(() => { window.MC.go = function (u) { window.__went = u; }; });
    const person = n => Object.assign({ fullName: n, sex: "female", phone: "0772000111", registeredFacilityId: F, status: "active", dobPrecision: "unknown" }, { businessId: B });
    await add(page, "pc_patients", "pa", person("TEST Alice Auditee")); await add(page, "pc_patients", "pb", person("TEST Bob Other"));
    await add(page, "pc_patient_facility_links", "pa_" + F, Object.assign({ patientId: "pa", localRegNo: "P-O-5" }, sc));
    await add(page, "users", "nurse1", { businessId: B, role: "operator", shopId: F, name: "Nurse Nancy", active: true, perms: {} });
    const au = (id, who, uid, action, pid, ago, x) => add(page, "pc_audit_logs", id, Object.assign({ actorUid: uid, actorName: who, action: action, patientId: pid, clientCreatedAt: NOW - ago * H }, sc, x || {}));
    await au("a1", "Dr Owner", "owner1", "allergy.add", "pa", 5, { substance: "TESTpenicillin", severity: "severe" });
    await au("a2", "Nurse Nancy", "nurse1", "share.grant", "pa", 3, { purpose: "Referral for X-ray" });
    await au("a3", "Nurse Nancy", "nurse1", "history.add", "pb", 2);
    await au("a4", "Dr Owner", "owner1", "journey.route", "pa", 1, { next: "pharmacy", waiting: ["pharmacy"] });
    await add(page, "pc_audit_logs", "a5", { businessId: B, facilityId: "otherShop", actorUid: "x", actorName: "Someone Else", action: "allergy.add", patientId: "pa", clientCreatedAt: NOW });
    const ac = (id, who, uid, pid, ago, purpose) => add(page, "pc_access_logs", id, Object.assign({ actorUid: uid, actorName: who, patientId: pid, purpose: purpose, clientCreatedAt: NOW - ago * H }, sc));
    await ac("v1", "Nurse Nancy", "nurse1", "pa", 4, "Viewed patient profile"); await ac("v2", "Dr Owner", "owner1", "pa", 0.5, "Viewed patient profile"); await ac("v3", "Nurse Nancy", "nurse1", "pb", 6, "Viewed patient profile");
    const f = page.frameLocator("#f"); await page.waitForTimeout(500); return { page, f };
  }
  const items = async f => (await f.locator("#logList .log").allInnerTexts());
  {
    const { page, f } = await open(390, 844); await f.locator("#fScope").waitFor();
    assert.match(await f.locator("#logList").innerText(), /Find a patient above/); ok("Owner opens the screen: asks which patient before showing anything");
    await f.locator("#pQ").fill("alice"); await f.locator("#pResults .pt").first().click(); await page.waitForTimeout(400);
    let l = await items(f); assert.equal(l.length, 5, "3 changes + 2 views for Alice at this facility, other facility excluded");
    assert.match(l[0], /Opened the record[\s\S]*View[\s\S]*Dr Owner[\s\S]*TEST Alice Auditee[\s\S]*Viewed patient profile/);
    assert.match(l[4], /Recorded an allergy[\s\S]*Change[\s\S]*Dr Owner[\s\S]*TESTpenicillin/);
    assert.ok(!l.join("").includes("Someone Else") && !l.join("").includes("TEST Bob"));
    ok("One patient: every change and every view, newest first, with who, when and details; other facilities' and patients' entries are not shown");
    await f.locator("#fType").selectOption("access"); assert.equal((await items(f)).length, 2); await f.locator("#fType").selectOption("audit"); assert.equal((await items(f)).length, 3); await f.locator("#fType").selectOption("all");
    await f.locator("#fText").fill("share"); l = await items(f); assert.equal(l.length, 1); assert.match(l[0], /Shared the patient with a facility[\s\S]*Referral for X-ray/); await f.locator("#fText").fill("");
    const d = new Date(NOW - 2 * H), iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    await f.locator("#fFrom").fill(iso); await f.locator("#fTo").fill(iso); assert.ok((await items(f)).length >= 1); await f.locator("#fFrom").fill("2001-01-01"); await f.locator("#fTo").fill("2001-01-02"); assert.match(await f.locator("#logList").innerText(), /Nothing matches/);
    ok("Filters: changes only, views only, text search and date range");
    assert.equal(await f.locator("button, input[type=submit]").filter({ hasText: /save|delete|edit/i }).count(), 0); const w = await page.evaluate(() => window.__db.writes.length); assert.equal(w, 0); ok("The screen is read-only: no write button, nothing written");
    await page.screenshot({ path: OUT + "/audit-390-mobile.png" });
    await f.locator("#fFrom").fill(""); await f.locator("#fTo").fill(""); await f.locator("#fScope").selectOption("staff"); await f.locator("#sPick").selectOption("nurse1"); await page.waitForTimeout(400); l = await items(f); assert.equal(l.length, 4); assert.ok(l.every(x => /Nurse Nancy/.test(x))); ok("One staff member: only that person's changes and views");
    await f.locator("#fScope").selectOption("facility"); await page.waitForTimeout(400); l = await items(f); assert.equal(l.length, 7, "4 audit + 3 access for this facility only"); ok("Whole facility: everything for this facility only");
  }
  {
    const { page, f } = await open(390, 844, "?go=" + encodeURIComponent("?patient=pa")); assert.equal((await items(f)).length, 5); assert.match(await f.locator("#pPicked").innerText(), /TEST Alice Auditee/); ok("A link with ?patient= opens straight onto that patient's log");
  }
  {
    const { f } = await open(390, 844, "?as=aud"); await f.locator("#fScope").waitFor(); assert.equal(await f.locator("#optStaff").count(), 0); await f.locator("#pQ").fill("alice"); await f.locator("#pResults .pt").first().click(); assert.equal((await items(f)).length, 5);
    ok("A user with audit.view (not the owner) can read, without the staff list that only the owner may read");
  }
  for (const as of ["nopres", "view"]) {
    const { f } = await open(390, 844, "?as=" + as); await f.locator("#gateCard").waitFor(); assert.match(await f.locator("#gateMsg").innerText(), /Only the owner, or someone the owner has given/); assert.equal(await f.locator("#mainArea").isVisible(), false);
  }
  ok("Users without audit.view see an explanation and no log entries");
  for (const [w, h, n] of [[360, 640, "small-phone"], [768, 1024, "tablet"], [1280, 900, "desktop"]]) {
    const { page, f } = await open(w, h, "?go=" + encodeURIComponent("?patient=pa")); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, n); await page.screenshot({ path: OUT + "/audit-" + n + ".png" }); ok(w + "x" + h + " " + n + ": no sideways scroll");
  }
  const own = errors.filter(e => !/favicon/i.test(e)); assert.equal(own.length, 0, "page errors: " + own.join(" | ")); ok("No JavaScript errors");
  await browser.close(); console.log("audit-check: " + results.length + " checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
