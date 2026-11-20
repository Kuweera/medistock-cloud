/* Developer 2, Stage 1: patient list (toolbar, Local/Shared list, filters, duplicate check against shared records).
   Runs patients.html in Chromium against the in-memory stand-in (NOT real Firebase).
   Run: python3 -m http.server 8765, then node tests/list-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", BASE = "http://localhost:8765/tests/patients-harness.html";
const B = "biz1", F = "shop1";
const yr = new Date().getFullYear();
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(w, h, qs) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(BASE + (qs || "")); await page.evaluate(() => { window.MC.go = function (u) { window.__went = u; }; }); const f = page.frameLocator("#f"); await f.locator("#q").waitFor(); return { page, f, ctx };
  }
  const add = (page, c, id, d) => page.evaluate(a => window.__db.add(a[0], a[1], a[2]), [c, id, d]);
  async function seed(page, n) {
    for (let i = 1; i <= n; i++) {
      await add(page, "pc_patients", "p" + i, { businessId: B, facilityId: F, registeredFacilityId: F, fullName: "TEST Local" + i + " Person", nameKey: "x", sex: i % 2 ? "female" : "male", dob: (yr - 20 - i) + "-03-03", dobApprox: (yr - 20 - i) + "-03-03", dobPrecision: "exact", phone: "0772" + String(100000 + i), phoneKey: "772" + String(100000 + i), village: "Kyebando", status: "active", clientCreatedAt: 1000 + i });
      await add(page, "pc_patient_facility_links", "p" + i + "_" + F, { businessId: B, facilityId: F, patientId: "p" + i, localRegNo: "P-O-" + i, status: "active" });
    }
    const snap = (name, ph) => ({ fullName: name, sex: "female", dob: (yr - 30) + "-07-07", dobApprox: (yr - 30) + "-07-07", dobPrecision: "exact", phone: ph, village: "Ntinda", nextOfKin: {} });
    await add(page, "pc_shares", "s1", { granteeBusinessId: B, granteeFacilityId: F, patientId: "zzz111abcdef", sourceFacilityName: "TEST General Hospital", sourceBusinessName: "TEST Health Ltd", purpose: "Referral for X-ray", patientSnapshot: snap("TEST Shared Aisha", "0701555111"), clientCreatedAt: 5000 });
    await add(page, "pc_shares", "s2", { granteeBusinessId: B, granteeFacilityId: F, patientId: "zzz222abcdef", sourceFacilityName: "TEST Lab Centre", purpose: "Referral", patientSnapshot: snap("TEST Revoked Person", "0701999999"), revokedAt: 1, clientCreatedAt: 5001 });
    await add(page, "pc_shares", "s3", { granteeBusinessId: B, granteeFacilityId: F, patientId: "zzz333abcdef", sourceFacilityName: "TEST Clinic B", purpose: "Referral", patientSnapshot: snap("TEST Already Ours", "0701888888"), clientCreatedAt: 5002 });
    await add(page, "pc_patients", "pours", { businessId: B, facilityId: F, registeredFacilityId: F, fullName: "TEST Already Ours", sex: "female", dob: (yr - 30) + "-07-07", dobApprox: (yr - 30) + "-07-07", dobPrecision: "exact", phone: "0701888888", phoneKey: "701888888", status: "active", sharedFrom: "s3", clientCreatedAt: 6000 });
    await add(page, "pc_patient_facility_links", "pours_" + F, { businessId: B, facilityId: F, patientId: "pours", localRegNo: "P-O-99", status: "active" });
  }
  const results = [];
  const ok = (name) => { results.push(name); console.log("PASS " + name); };

  // ---- small Android phone, 360x640: Register is at the top without scrolling, even with a long list
  {
    const { page, f } = await open(360, 640); await seed(page, 40);
    await f.locator("#showFormBtn:not(.hidden)").waitFor();
    const bb = await f.locator("#showFormBtn").boundingBox(), sb = await f.locator("#q").boundingBox();
    assert.ok(bb.y + bb.height < 640 && bb.y < 260, "register button in first screen, y=" + bb.y);
    assert.ok(sb.y < 260 && Math.abs(sb.y - bb.y) < 120, "search and register are together");
    ok("360x640: Register New Patient and search both visible at the top with 40+ patients");
    await page.waitForTimeout(300);
    const bb2 = await f.locator("#showFormBtn").boundingBox(); assert.equal(Math.round(bb2.y), Math.round(bb.y), "button does not move");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scroll");
    ok("360x640: no horizontal scroll");
    await page.screenshot({ path: OUT + "/list-360-mobile.png" });
    await f.locator("#showFormBtn").click(); await f.locator("#fName").waitFor();
    assert.equal(await f.locator("#formCard").isVisible(), true); ok("Register button opens the form right at the top (no scrolling the list)");
  }
  // ---- 390 phone: chips, shared origin, filters, search
  {
    const { page, f } = await open(390, 844); await seed(page, 40); await f.locator(".pt").first().waitFor();
    const txt = await f.locator("#results").innerText();
    assert.match(txt, /TEST Shared Aisha/); assert.match(txt, /From TEST General Hospital \(TEST Health Ltd\)/); assert.match(txt, /Referral for X-ray/);
    assert.doesNotMatch(txt, /Revoked Person/, "revoked share hidden");
    assert.equal(await f.locator("#results .pt", { hasText: "TEST Already Ours" }).count(), 1, "already-registered shared patient shows once");
    assert.match(await f.locator("#results .pt", { hasText: "TEST Already Ours" }).innerText(), /Local[\s\S]*P-O-99[\s\S]*Originally shared by TEST Clinic B/);
    ok("Shared patients show origin; revoked hidden; a shared patient already registered locally appears once, as Local");
    assert.equal(await f.locator("#results .pt", { hasText: "TEST Shared Aisha" }).locator(".chip.shared").count(), 1);
    assert.equal(await f.locator("#results .pt", { hasText: "TEST Local35 " }).locator(".chip.local").count(), 1);
    assert.match(await f.locator("#results .pt", { hasText: "TEST Local35 " }).innerText(), /P-O-35/);
    ok("Local and Shared chips distinguish rows; local rows show registration number");
    assert.match(await f.locator("#scopeTabs").innerText(), /All \(42\)[\s\S]*Local \(41\)[\s\S]*Shared with us \(1\)/);
    await f.locator('[data-scope="shared"]').click(); assert.equal(await f.locator("#results .pt").count(), 1);
    await f.locator('[data-scope="local"]').click(); assert.equal(await f.locator("#results .pt").count() > 0 && !(await f.locator("#results").innerText()).includes("Shared Aisha"), true);
    await f.locator('[data-scope="all"]').click(); ok("Filter tabs All / Local / Shared with counts");
    await f.locator("#q").fill("aisha"); assert.equal(await f.locator("#results .pt").count(), 1); assert.match(await f.locator("#listInfo").innerText(), /1 found/);
    await f.locator("#q").fill("0701555"); assert.equal(await f.locator("#results .pt").count(), 1);
    await f.locator("#q").fill("P-O-12"); assert.match(await f.locator("#results").innerText(), /Local12/);
    await f.locator("#q").fill("zzzznobody"); assert.match(await f.locator("#results").innerText(), /No patient found[\s\S]*Register New Patient/);
    await f.locator("#q").fill(""); ok("Search finds local and shared patients by name, phone, registration number; empty result points to Register");
    await f.locator("#results .pt", { hasText: "Shared Aisha" }).click(); assert.match(await page.evaluate(() => window.__went), /patient\.html\?share=s1/); ok("Shared row opens the read-only shared profile");
    await f.locator("#q").fill("local5"); await f.locator("#results .pt").first().click(); await f.locator("#openProfileBtn").waitFor(); ok("Local row opens its summary with Open profile");
    await page.screenshot({ path: OUT + "/list-390-mobile.png" });
  }
  // ---- duplicate check against a shared record
  {
    const { page, f } = await open(390, 844); await seed(page, 3); await f.locator(".pt").first().waitFor();
    await f.locator("#showFormBtn").click(); await f.locator("#fName").fill("Aisha Shared Test"); await f.locator("#fSex").selectOption("female");
    await f.locator("#fDob").fill("07/07/" + (yr - 30)); await f.locator("#fDob").blur(); await f.locator("#fPhone").fill("0701555111");
    await f.locator("#saveBtn").click(); await f.locator("#candBox:not(.hidden)").waitFor();
    const ctext = await f.locator("#candBox").innerText();
    assert.match(ctext, /Shared, not yet registered here/); assert.match(ctext, /From TEST General Hospital/); assert.match(ctext, /Use this shared record/);
    assert.equal((await page.evaluate(() => window.__db.all("pc_patients"))).filter(p => /Aisha Shared Test/.test(p.fullName)).length, 0, "nothing saved yet");
    await f.locator("#candBox [data-regshare]").click(); assert.match(await page.evaluate(() => window.__went), /patients\.html\?fromShare=s1/);
    await f.locator("#forceNewBtn").click(); assert.match(await f.locator("#formMsg").innerText(), /say why/i);
    await f.locator("#dupReason").fill("Different person, same phone family"); await f.locator("#forceNewBtn").click(); await page.waitForTimeout(500);
    const saved = (await page.evaluate(() => window.__db.all("pc_patients"))).filter(p => /Aisha Shared Test/.test(p.fullName)); assert.equal(saved.length, 1);
    const audit = (await page.evaluate(() => window.__db.all("pc_audit_logs"))).find(a => a.action === "patient.register" && a.patientId === saved[0]._id);
    assert.ok(audit.duplicateCandidates.includes("share:s1") && /Different person/.test(audit.duplicateOverrideReason));
    ok("Registering a match of a shared patient warns, offers the shared record, needs a reason to override, and is audited");
    assert.equal(await f.locator("#showFormBtn").isVisible(), true); assert.equal(await f.locator("#formCard").isVisible(), false); ok("After saving, the form closes and Register stays at the top");
  }
  // ---- registering from the shared record path (no duplicate warning against itself)
  {
    const { page, f } = await open(390, 844); await seed(page, 2); await f.locator(".pt").first().waitFor();
    assert.equal((await f.locator("#results").innerText()).includes("Shared Aisha"), true);
  }
  // ---- user with view-only permission: list visible, no Register button
  {
    const { page, f } = await open(390, 844, "?as=nopres"); await seed(page, 2); await f.locator(".pt").first().waitFor();
    assert.equal(await f.locator("#showFormBtn").isVisible(), false); assert.equal(await f.locator("#dupScanBtn").isVisible(), false);
    ok("View-only operator sees the list but no Register button and no merge scan");
  }
  // ---- tablet and desktop
  for (const [w, h, name] of [[768, 1024, "tablet"], [1280, 800, "desktop"]]) {
    const { page, f } = await open(w, h); await seed(page, 40); await f.locator(".pt").first().waitFor();
    const bb = await f.locator("#showFormBtn").boundingBox(), sb = await f.locator("#q").boundingBox();
    assert.ok(bb.y < 200 && sb.y < 200 && Math.abs(sb.y - bb.y) < 20, name + ": beside the search");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, name + " no sideways scroll");
    await page.screenshot({ path: OUT + "/list-" + name + ".png" }); ok(w + "x" + h + " " + name + ": Register beside search, no sideways scroll");
  }
  const own = errors.filter(e => !/favicon/i.test(e)); assert.equal(own.length, 0, "page errors: " + own.join(" | "));
  ok("No JavaScript errors on any run");
  await browser.close(); console.log("list-check: " + results.length + " checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
