/* Developer 2, Stage 2: read-first patient profile (patient.html) on the in-memory stand-in (NOT real Firebase).
   Run: python3 -m http.server 8765, then node tests/profile-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", BASE = "http://localhost:8765/tests/patient-profile-harness.html";
const B = "biz1", F = "shop1", yr = new Date().getFullYear(), NOW = Date.now();
(async () => {
  const browser = await chromium.launch(), errors = [], results = [];
  const ok = n => { results.push(n); console.log("PASS " + n); };
  async function open(w, h, qs) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(BASE + qs); await page.evaluate(() => { window.MC.go = function (u) { window.__went = u; }; }); const f = page.frameLocator("#f"); await page.waitForTimeout(250); return { page, f };
  }
  const add = (page, c, id, d) => page.evaluate(a => window.__db.add(a[0], a[1], a[2]), [c, id, d]);
  const sc = { businessId: B, facilityId: F };
  async function seed(page) {
    const person = n => ({ businessId: B, registeredFacilityId: F, fullName: n, sex: "female", dob: (yr - 30) + "-02-02", dobApprox: (yr - 30) + "-02-02", dobPrecision: "exact", phone: "0772000111", village: "Kyebando", status: "active", clientCreatedAt: NOW });
    await add(page, "pc_patients", "pold", person("TEST Old Patient")); await add(page, "pc_patients", "pnew", person("TEST New Patient"));
    await add(page, "pc_patient_facility_links", "pold_" + F, Object.assign({ patientId: "pold", localRegNo: "P-O-7", status: "active" }, sc));
    await add(page, "pc_allergies", "a1", Object.assign({ patientId: "pold", substance: "TESTpenicillin", reaction: "Rash", severity: "severe", status: "active", recordedDate: "2026-01-05", recordedByName: "Dr Owner" }, sc));
    await add(page, "pc_medical_history", "h1", Object.assign({ patientId: "pold", type: "chronic_illness", text: "TEST asthma since childhood", status: "active", recordedByName: "Dr Owner", clientCreatedAt: NOW - 86400000 }, sc));
    await add(page, "pc_encounters", "e1", Object.assign({ patientId: "pold", encounterNo: "E-0001", type: "outpatient", status: "closed", arrivalAt: NOW - 5 * 86400000, arrivalDay: "2026-11-15", reason: "Cough" }, sc));
    await add(page, "pc_encounters", "e2", Object.assign({ patientId: "pold", encounterNo: "E-0002", type: "outpatient", status: "open", stage: "in_consultation", arrivalAt: NOW, arrivalDay: "2026-11-21", reason: "Review", journey: { v: 1, next: "pharmacy", waiting: [], note: "Collect antibiotics" } }, sc));
    await add(page, "pc_triage", "t1", Object.assign({ patientId: "pold", encounterId: "e1", temperatureC: 38.4, bpSys: 120, bpDia: 80, pulse: 96, weightKg: 61, clientCreatedAt: NOW - 5 * 86400000 }, sc));
    await add(page, "pc_diagnoses", "d1", Object.assign({ patientId: "pold", encounterId: "e1", name: "TEST Bronchitis", icd10: "J20.9", role: "primary", certainty: "confirmed", status: "active", authorName: "Dr Owner", clientCreatedAt: NOW - 5 * 86400000 }, sc));
    await add(page, "pc_diagnoses", "d0", Object.assign({ patientId: "pold", encounterId: "e1", name: "TEST Superseded Dx", status: "superseded", clientCreatedAt: NOW - 6 * 86400000 }, sc));
    await add(page, "pc_treatment_orders", "o9", Object.assign({ patientId: "pold", encounterId: "e1", kind: "medicine", medicineName: "TESTmycin 250 mg", doseValue: 1, doseUnit: "tablet", route: "by mouth", status: "active", prescribedAt: NOW - 5 * 86400000, prescriberName: "Dr Owner" }, sc));
    await add(page, "pc_treatment_orders", "o8", Object.assign({ patientId: "pold", encounterId: "e1", kind: "medicine", medicineName: "TESTold 100 mg", status: "completed", prescribedAt: NOW - 60 * 86400000, prescriberName: "Dr Owner" }, sc));
    await add(page, "pc_inv_orders", "i1", Object.assign({ patientId: "pold", encounterId: "e1", name: "TEST Haemoglobin", status: "verified", priority: "routine", requestedAt: NOW - 5 * 86400000, requestedByName: "Dr Owner", currentResultId: "i1" }, sc));
    await add(page, "pc_inv_results", "i1", Object.assign({ patientId: "pold", orderId: "i1", value: 9.1, unit: "g/dL", flag: "low", status: "verified", resultAt: NOW - 4 * 86400000, enteredByName: "Lab Tech" }, sc));
    // a patient shared from another business: their allergy is visible, their visits/diagnoses must NOT be
    await add(page, "pc_shares", "s1", { businessId: "bizX", facilityId: "shopX", granteeBusinessId: B, granteeFacilityId: F, patientId: "pshared", sourceFacilityName: "TEST Source Hospital", sourceBusinessName: "TEST Source Ltd", purpose: "Referral", patientSnapshot: { fullName: "TEST Shared Person", sex: "male", dob: (yr - 40) + "-01-01", dobPrecision: "exact", phone: "0701000222", sourceRegNo: "P-X-42", nextOfKin: {} }, clientCreatedAt: NOW });
    await add(page, "pc_allergies", "ax", { businessId: "bizX", facilityId: "shopX", patientId: "pshared", substance: "TESTsulfa", severity: "moderate", status: "active", recordedDate: "2026-02-02" });
    await add(page, "pc_diagnoses", "dx9", { businessId: "bizX", facilityId: "shopX", patientId: "pshared", name: "TEST Secret Diagnosis", status: "active" });
    await add(page, "pc_directory", "dir1", { listed: true, businessId: "bizB", businessName: "TEST Other Health", facilityId: "shopB", facilityName: "TEST Radiology", services: ["X-ray"] });
  }
  // the page reads the patient once on open, so seed first and then reopen the page
  const reload = page => page.evaluate(() => { document.getElementById("f").contentWindow.location.reload(); });
  const vis = (f, sel) => f.locator(sel).isVisible();

  // ---------- existing patient, phone: saved information first, forms closed
  {
    const { page, f } = await open(390, 844, "?go=" + encodeURIComponent("?id=pold")); await seed(page); await reload(page); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(500);
    const t = id => f.locator(id).innerText();
    assert.match(await t("#tab-overview"), /Demographics[\s\S]*P-O-7[\s\S]*Contact[\s\S]*0772000111[\s\S]*Kyebando/);
    assert.match(await t("#aList"), /TESTpenicillin[\s\S]*Severe[\s\S]*Rash/); assert.match(await t("#hList"), /asthma/);
    assert.match(await t("#encList"), /E-0001[\s\S]*Closed/); assert.match(await t("#vitalsBox"), /38\.4[\s\S]*120\/80[\s\S]*during visit E-0001[\s\S]*not today's readings/);
    assert.match(await t("#dxList"), /TEST Bronchitis[\s\S]*J20\.9[\s\S]*Primary[\s\S]*Recorded[\s\S]*Dr Owner[\s\S]*visit E-0001/); assert.doesNotMatch(await t("#dxList"), /Superseded/);
    assert.match(await t("#txList"), /Current[\s\S]*TESTmycin[\s\S]*Earlier[\s\S]*TESTold[\s\S]*Prescribed/);
    assert.match(await t("#invList"), /TEST Haemoglobin[\s\S]*Verified[\s\S]*9\.1 g\/dL[\s\S]*LOW[\s\S]*Resulted[\s\S]*Lab Tech[\s\S]*Requested/);
    assert.match(await t("#encList"), /E-0002[\s\S]*Open[\s\S]*Next: Pharmacy[\s\S]*Collect antibiotics/); assert.doesNotMatch((await f.locator("#encList .pt", { hasText: "E-0001" }).innerText()), /Next:/);
    ok("Existing patient: demographics, contact, allergies, history, visits, last measurements (dated, not presented as today's), diagnoses, treatment, tests all show saved data with date and source");
    for (const sel of ["#aAddCard", "#hAddCard", "#sNewCard", "#aSubstance", "#hText", "#sBiz"]) assert.equal(await vis(f, sel), false, sel + " must be closed on open");
    for (const sel of ["#aOpenBtn", "#hOpenBtn", "#sOpenBtn", "#newVisitBtn"]) assert.equal(await vis(f, sel), true, sel);
    assert.equal(await vis(f, "#newNote"), false);
    ok("Add forms are closed when the profile opens; clear Add buttons are available");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("390px: no sideways scroll");
    await page.screenshot({ path: OUT + "/profile-390-mobile.png", fullPage: false });
    // add allergy only when the user chooses
    await f.locator("#aOpenBtn").click(); assert.equal(await vis(f, "#aAddCard"), true);
    await f.locator("#aCancelBtn").click(); assert.equal(await vis(f, "#aAddCard"), false);
    await f.locator("#aOpenBtn").click(); await f.locator("#aSubstance").fill("TESTaspirin"); await f.locator("#aAddBtn").click(); await page.waitForTimeout(400);
    assert.equal(await vis(f, "#aAddCard"), false); assert.match(await t("#aList"), /TESTaspirin/);
    assert.equal((await page.evaluate(() => window.__db.all("pc_audit_logs"))).filter(a => a.action === "allergy.add").length, 1);
    ok("Add allergy: opens on demand, cancel works, save writes the record and audit entry, form closes, list updates");
    await f.locator("#hOpenBtn").click(); await f.locator("#hText").fill("TEST appendectomy 2015"); await f.locator("#hAddBtn").click(); await page.waitForTimeout(400);
    assert.match(await t("#hList"), /appendectomy/); assert.equal(await vis(f, "#hAddCard"), false); ok("Add history works the same way");
    // jump pills
    await f.locator('#tabs [data-t="inv"]').click(); await page.waitForTimeout(700);
    const y = await f.locator("#sec-inv").boundingBox(); assert.ok(y.y >= 0 && y.y < 600, "jump scrolls to the tests section, y=" + y.y); ok("Section pills jump to the section");
    // share form + source reg no
    await f.locator("#sOpenBtn").click(); await f.locator("#sBiz").fill("TEST Other Health"); await f.locator("#sBiz").dispatchEvent("change");
    await f.locator("#sTarget").selectOption("shopB"); await f.locator("#sPurpose").fill("Referral for X-ray"); await f.locator("#sBy").fill("Patient herself"); await f.locator("#sAgree").check(); await f.locator("#sGrantBtn").click(); await page.waitForTimeout(400);
    const sh = (await page.evaluate(() => window.__db.all("pc_shares"))).find(x => x.patientId === "pold");
    assert.equal(sh.patientSnapshot.sourceRegNo, "P-O-7"); assert.equal(await vis(f, "#sNewCard"), false); assert.match(await t("#sOutList"), /TEST Radiology[\s\S]*Sharing/);
    ok("Sharing: list first, form on demand, consent recorded, snapshot carries our registration number");
  }
  // ---------- new patient: empty states
  {
    const { page, f } = await open(390, 844, "?go=" + encodeURIComponent("?id=pnew")); await seed(page); await reload(page); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(600);
    assert.equal(await vis(f, "#newNote"), true); assert.match(await f.locator("#newNote").innerText(), /nothing recorded yet[\s\S]*allergies and medical history[\s\S]*start a visit/i);
    assert.equal(await vis(f, "#newNoteVisitBtn"), true);
    assert.match(await f.locator("#aList").innerText(), /No allergy recorded\. Add any known/); assert.match(await f.locator("#hList").innerText(), /No medical history recorded\. You can add/);
    assert.match(await f.locator("#dxList").innerText(), /A clinician adds diagnoses during a visit[\s\S]*Start a visit/); assert.match(await f.locator("#txList").innerText(), /No treatment or medicine ordered yet/);
    assert.match(await f.locator("#invList").innerText(), /No tests requested yet/); assert.match(await f.locator("#encList").innerText(), /No visits yet/);
    ok("New patient: clear empty states that explain what can be added, with Add / Start a visit actions");
    await f.locator("#newNoteVisitBtn").click(); assert.match(await page.evaluate(() => window.__went), /encounters\.html\?newFor=pnew/); ok("Start a visit goes to the visit queue for this patient");
    await page.screenshot({ path: OUT + "/profile-new-390.png" });
  }
  // ---------- view-only operator: no add actions
  {
    const { page, f } = await open(390, 844, "?as=nopres&go=" + encodeURIComponent("?id=pold")); await seed(page); await reload(page); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(500);
    for (const sel of ["#aOpenBtn", "#hOpenBtn", "#sOpenBtn", "#newVisitBtn"]) assert.equal(await vis(f, sel), false, sel + " hidden without permission");
    assert.match(await f.locator("#aList").innerText(), /TESTpenicillin/); ok("Operator without add permissions sees the data but no Add / Share / Start visit buttons");
  }
  // ---------- patient shared from another business: read-only, no foreign clinical records
  {
    const { page, f } = await open(390, 844, "?go=" + encodeURIComponent("?share=s1")); await seed(page); await reload(page); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(600);
    assert.match(await f.locator("#sharedNote").innerText(), /Shared with you by TEST Source Hospital/); assert.match(await f.locator("#tab-overview").innerText(), /P-X-42/);
    assert.match(await f.locator("#aList").innerText(), /TESTsulfa/);
    for (const sel of ["#tab-encounters", "#sec-dx", "#sec-tx", "#sec-inv", "#tab-sharing", "#aOpenBtn", "#hOpenBtn", "#newNote"]) assert.equal(await vis(f, sel), false, sel + " hidden for a shared patient");
    assert.doesNotMatch(await page.frameLocator("#f").locator("body").innerText(), /Secret Diagnosis/); ok("Shared patient: read-only, source registration number and allergies shown, other facility's visits/diagnoses/treatment never shown");
  }
  // ---------- tablet + desktop
  for (const [w, h, n] of [[768, 1024, "tablet"], [1280, 900, "desktop"], [360, 640, "small-phone"]]) {
    const { page, f } = await open(w, h, "?go=" + encodeURIComponent("?id=pold")); await seed(page); await reload(page); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, n + " sideways scroll");
    assert.equal(await vis(f, "#aAddCard"), false); await page.screenshot({ path: OUT + "/profile-" + n + ".png" }); ok(w + "x" + h + " " + n + ": no sideways scroll, forms closed");
  }
  const own = errors.filter(e => !/favicon/i.test(e)); assert.equal(own.length, 0, "page errors: " + own.join(" | ")); ok("No JavaScript errors");
  await browser.close(); console.log("profile-check: " + results.length + " checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
