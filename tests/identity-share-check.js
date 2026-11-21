/* Developer 2, rules v21 screens: identity correction (reason + record in the same commit), snapshot refresh, optional share expiry.
   In-memory stand-in (NOT real Firebase, rules are NOT evaluated here: they are covered by tests-emulator/rules.test.js).
   "Offline" = the stand-in applies writes at once but never answers the server (?offline=1), so this proves the screens do not wait for the server;
   it does NOT prove real sync. Run: python3 -m http.server 8765, then node tests/identity-share-check.js [shots] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", BASE = "http://localhost:8765/tests/patient-profile-harness.html";
const B = "biz1", F = "shop1", NOW = Date.now(), DAY = 86400000;
const iso = ms => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
(async () => {
  const browser = await chromium.launch(), errors = [], results = [];
  const ok = n => { results.push(n); console.log("PASS " + n); };
  const sc = { businessId: B, facilityId: F };
  const add = (page, c, id, d) => page.evaluate(a => window.__db.add(a[0], a[1], a[2]), [c, id, d]);
  const all = (page, c) => page.evaluate(c => window.__db.all(c), c);
  const writes = page => page.evaluate(() => window.__db.writes);
  async function open(w, h, qs, go) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(BASE + "?" + (qs || "") + "&go=" + encodeURIComponent(go || "?id=pold"));
    await page.evaluate(() => { window.MC.go = function (u) { window.__went = u; }; });
    const person = (n, x) => Object.assign({ fullName: n, nameKey: n.toLowerCase().split(" ").sort().join(" "), sex: "female", phone: "0772000111", registeredFacilityId: F, status: "active", dobPrecision: "exact", dob: "1990-05-10", dobApprox: "1990-05-10", businessId: B }, x || {});
    await add(page, "pc_patients", "pold", person("TEST Old Patient")); await add(page, "pc_patients", "pest", person("TEST Estimated Person", { dobPrecision: "estimated", dob: null, dobApprox: iso(NOW - 20 * 365 * DAY), estimatedAge: { years: 20, months: 0, days: 0 } }));
    await add(page, "pc_patient_facility_links", "pold_" + F, Object.assign({ patientId: "pold", localRegNo: "P-O-7", status: "active" }, sc));
    const snap = { fullName: "TEST Old Patient", sex: "female", dob: "1990-05-10", dobApprox: "1990-05-10", dobPrecision: "exact", ageRecordedOn: null, estimatedAge: null, phone: "0772000111", village: "", district: "", nextOfKin: { name: "", relationship: "", phone: "" }, sourceRegNo: "P-O-7" };
    const sh = (gb, gn, x) => Object.assign({ businessId: B, facilityId: F, patientId: "pold", granteeBusinessId: gb, granteeBusinessName: gn, granteeFacilityId: "fac_" + gb, granteeFacilityName: "Fac " + gn, sourceFacilityName: "Test Clinic", purpose: "Referral", consentMethod: "verbal", consentGivenBy: "TEST Guardian", patientSnapshot: snap, grantedAt: { seconds: Math.floor((NOW - 10 * DAY) / 1000) }, snapshotAt: { seconds: Math.floor((NOW - 10 * DAY) / 1000) }, revokedAt: null }, x || {});
    await add(page, "pc_shares", "pold_" + F + "_bizB", sh("bizB", "TEST Radiology"));
    await add(page, "pc_shares", "pold_" + F + "_bizC", sh("bizC", "TEST Lab", { consentExpiresAt: new Date(NOW - 2 * DAY).toISOString() }));
    await add(page, "pc_shares", "pold_" + F + "_bizD", sh("bizD", "TEST Stopped", { revokedAt: { seconds: Math.floor((NOW - DAY) / 1000) } }));
    await add(page, "pc_directory", "fac_bizD", { listed: true, businessId: "bizD", businessName: "TEST Stopped", facilityId: "fac_bizD", facilityName: "Fac TEST Stopped", services: ["X-ray"] });
    await page.evaluate(() => { document.getElementById("f").contentWindow.location.reload(); });
    const f = page.frameLocator("#f"); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(500); return { page, f };
  }
  const vis = (f, s) => f.locator(s).isVisible(), txt = (f, s) => f.locator(s).innerText();
  const patientDoc = async (page, id) => (await all(page, "pc_patients")).find(x => x._id === id);

  // ---------- identity correction
  {
    const { page, f } = await open(390, 844, "as=nopres"); assert.equal(await vis(f, "#editIdBtn"), false); ok("Identity: no correction button without patient.edit");
  }
  {
    const { page, f } = await open(390, 844, ""); await f.locator("#editIdBtn").click();
    assert.equal(await f.locator("#idName").inputValue(), "TEST Old Patient"); assert.equal(await f.locator("#idSex").inputValue(), "female"); assert.equal(await vis(f, "#idCard"), true);
    await f.locator("#idSaveBtn").click(); assert.match(await txt(f, "#idMsg"), /Nothing was changed/);
    await f.locator("#idName").fill("TEST Corrected Name"); await f.locator("#idSaveBtn").click(); assert.match(await txt(f, "#idMsg"), /Say why/);
    await f.locator("#idReason").fill("ab"); await f.locator("#idSaveBtn").click(); assert.match(await txt(f, "#idMsg"), /at least 3/);
    await f.locator("#idReason").fill("x".repeat(301)); await f.locator("#idReason").evaluate(e => { e.maxLength = 1000; e.value = "x".repeat(301); }); await f.locator("#idSaveBtn").click(); assert.match(await txt(f, "#idMsg"), /too long/);
    await f.locator("#idName").fill("A"); await f.locator("#idReason").fill("typo"); await f.locator("#idSaveBtn").click(); assert.match(await txt(f, "#idMsg"), /Enter the patient's name/);
    const p = await patientDoc(page, "pold"); assert.equal(p.fullName, "TEST Old Patient"); assert.equal(p.identityVersion, undefined); assert.equal((await all(page, "pc_patient_corrections")).length, 0);
    ok("Identity: nothing changed, missing/short/long reason and empty name are refused and nothing is written");
    await f.locator("#idName").fill("TEST Corrected Name"); await f.locator("#idSex").selectOption("male"); await f.locator("#idReason").fill("Registered with the wrong name and sex"); await f.locator("#idSaveBtn").click(); await page.waitForTimeout(500);
    const q = await patientDoc(page, "pold"), cs = await all(page, "pc_patient_corrections");
    assert.equal(q.fullName, "TEST Corrected Name"); assert.equal(q.sex, "male"); assert.equal(q.identityVersion, 1); assert.equal(q.nameKey, "corrected name test"); assert.equal(q.dob, "1990-05-10"); assert.equal(q.phone, "0772000111");
    assert.equal(cs.length, 1); const c = cs[0]; assert.equal(c._id, "pold_1"); assert.equal(c.version, 1); assert.equal(c.patientId, "pold"); assert.equal(c.reason, "Registered with the wrong name and sex"); assert.equal(c.businessId, B); assert.equal(c.facilityId, F); assert.ok(c.correctedBy && c.createdBy && c.createdAt);
    assert.deepEqual(Object.keys(c.before).sort(), ["dob", "dobApprox", "dobPrecision", "fullName", "nameKey", "sex"]); assert.deepEqual(Object.keys(c.after).sort(), ["dob", "dobApprox", "dobPrecision", "fullName", "nameKey", "sex"]);
    assert.equal(c.before.fullName, "TEST Old Patient"); assert.equal(c.before.sex, "female"); assert.equal(c.after.fullName, "TEST Corrected Name"); assert.equal(c.after.sex, "male");
    const b = await page.evaluate(() => window.__db.batches); assert.equal(b.length, 1); assert.ok(b[0].includes("update:pc_patients/pold") && b[0].includes("set:pc_patient_corrections/pold_1"), "same commit: " + b[0]);
    const au = (await all(page, "pc_audit_logs")).filter(x => x.action === "patient.identity_correct"); assert.equal(au.length, 1); assert.deepEqual(au[0].changedFields.sort(), ["name", "sex"]);
    ok("Identity: name and sex corrected in ONE commit with identityVersion 1, record pold_1 (reason, full before/after, correctedBy) and an audit entry");
    assert.match(await txt(f, "#pName"), /TEST Corrected Name/); assert.match(await txt(f, "#corrList"), /Correction 1[\s\S]*TEST Old Patient[\s\S]*TEST Corrected Name[\s\S]*Registered with the wrong name/); ok("Identity: the new name shows at once and the correction history lists old value, new value and reason");
    await f.locator("#editIdBtn").click(); await f.locator("#idAgeMode").selectOption("unknown"); await f.locator("#idReason").fill("Date of birth was a guess"); await f.locator("#idSaveBtn").click(); await page.waitForTimeout(400);
    const q2 = await patientDoc(page, "pold"), cs2 = (await all(page, "pc_patient_corrections")).sort((x, y) => x.version - y.version);
    assert.equal(q2.identityVersion, 2); assert.equal(q2.dobPrecision, "unknown"); assert.equal(q2.dob, null); assert.equal(cs2.length, 2); assert.equal(cs2[1]._id, "pold_2"); assert.equal(cs2[0].reason, "Registered with the wrong name and sex");
    ok("Identity: a second correction is version 2 (pold_2); the first record is untouched (append-only)");
    await page.screenshot({ path: OUT + "/identity-390-mobile.png" });
  }
  {
    const { page, f } = await open(390, 844, "", "?id=pest"); await f.locator("#editIdBtn").click(); assert.equal(await f.locator("#idAgeMode").inputValue(), "est");
    const before = (await patientDoc(page, "pest")).dobApprox; await f.locator("#idName").fill("TEST Estimated Renamed"); await f.locator("#idReason").fill("Spelling"); await f.locator("#idSaveBtn").click(); await page.waitForTimeout(400);
    const c = (await all(page, "pc_patient_corrections"))[0]; assert.equal(c.after.dobApprox, before); assert.equal(c.before.dobApprox, before); assert.equal((await patientDoc(page, "pest")).dobApprox, before);
    const au = (await all(page, "pc_audit_logs")).filter(x => x.action === "patient.identity_correct")[0]; assert.deepEqual(au.changedFields, ["name"]);
    ok("Identity: renaming a patient with an estimated age does not silently change the estimated date of birth");
  }
  // ---------- snapshot refresh
  {
    const { page, f } = await open(390, 844, "");
    let t = await txt(f, "#sOutList"); assert.match(t, /TEST Radiology[\s\S]*Sharing/); assert.match(t, /details sent as of/); assert.equal(await f.locator("#sOutList .chip.warn", { hasText: "Details changed" }).count(), 0);
    await f.locator("#editIdBtn").click(); await f.locator("#idName").fill("TEST Fresh Name"); await f.locator("#idReason").fill("Spelling fix"); await f.locator("#idSaveBtn").click(); await page.waitForTimeout(400);
    assert.match(await txt(f, "#doneMsg"), /still show the old details/); assert.ok((await f.locator("#sOutList .chip.warn", { hasText: "Details changed" }).count()) >= 1, "stale chip on live shares");
    ok("Snapshot: after a correction the live shares are flagged 'Details changed since shared' and the message says what to do");
    const n0 = (await writes(page)).length;
    await f.locator('[data-refresh="bizB"]').click(); await page.waitForTimeout(400);
    const w = (await writes(page)).slice(n0).filter(x => x.path === "pc_shares/pold_" + F + "_bizB"); assert.equal(w.length, 1); assert.equal(w[0].kind, "update");
    assert.deepEqual(Object.keys(w[0].data).sort(), ["patientSnapshot", "snapshotAt", "updatedAt", "updatedBy"], "nothing else in the same update");
    assert.equal(w[0].data.patientSnapshot.fullName, "TEST Fresh Name"); assert.equal(w[0].data.patientSnapshot.sourceRegNo, "P-O-7"); assert.ok(w[0].data.snapshotAt);
    const sh = (await all(page, "pc_shares")).find(x => x._id === "pold_" + F + "_bizB"); assert.equal(sh.patientSnapshot.fullName, "TEST Fresh Name"); assert.equal(sh.revokedAt, null);
    assert.ok((await all(page, "pc_audit_logs")).some(x => x.action === "share.refresh")); await page.waitForTimeout(100);
    assert.equal(await f.locator('#sOutList .entry:has-text("TEST Radiology") .chip.warn', { hasText: "Details changed" }).count(), 0);
    ok("Snapshot: 'Update shared details' sends ONLY patientSnapshot, snapshotAt and the stamp, with the new name and our registration number; flag clears; audit entry written");
    assert.equal(await f.locator('[data-refresh="bizD"]').count(), 0); assert.equal(await f.locator('[data-exp="bizD"]').count(), 0); ok("Snapshot/expiry controls are not offered on a stopped share");
  }
  // ---------- expiry (source side)
  {
    const { page, f } = await open(390, 844, "");
    const entry = n => f.locator('#sOutList .entry:has-text("' + n + '")');
    assert.match(await entry("TEST Radiology").innerText(), /No end date/); assert.match(await entry("TEST Lab").innerText(), /Expired[\s\S]*Ended/); assert.match(await entry("TEST Lab").innerText(), /Extend/); ok("Expiry: a share with no date says 'No end date'; one past its date says 'Expired' and offers Extend");
    await f.locator('[data-exp="bizB"]').click(); assert.equal(await vis(f, "#sxCard"), true); await f.locator("#sxDate").fill(iso(NOW - DAY)); await f.locator("#sxSaveBtn").click(); assert.match(await txt(f, "#sxMsg"), /must be in the future/);
    await f.locator("#sxDate").fill(""); await f.locator("#sxSaveBtn").click(); assert.match(await txt(f, "#sxMsg"), /Choose an end date/);
    assert.equal((await writes(page)).filter(x => x.path.indexOf("pc_shares/") === 0).length, 0); ok("Expiry: a past date or no date is refused and nothing is written");
    const fut = iso(NOW + 30 * DAY); await f.locator("#sxDate").fill(fut); await f.locator("#sxSaveBtn").click(); await page.waitForTimeout(400);
    let w = (await writes(page)).filter(x => x.path === "pc_shares/pold_" + F + "_bizB"); assert.equal(w.length, 1); assert.deepEqual(Object.keys(w[0].data).sort(), ["consentExpiresAt", "updatedAt", "updatedBy"]);
    assert.ok(new Date(w[0].data.consentExpiresAt).getTime() > NOW + 29 * DAY); assert.match(await entry("TEST Radiology").innerText(), /Ends \d\d\/\d\d\/\d{4}/); ok("Expiry: a future date is set with ONLY consentExpiresAt and the stamp; the list shows 'Ends <date>'");
    await f.locator('[data-exp="bizB"]').click(); await f.locator("#sxDate").fill(iso(NOW + 60 * DAY)); await f.locator("#sxSaveBtn").click(); await page.waitForTimeout(300);
    await f.locator('[data-exp="bizB"]').click(); await f.locator("#sxClearBtn").click(); await page.waitForTimeout(300);
    w = (await writes(page)).filter(x => x.path === "pc_shares/pold_" + F + "_bizB"); assert.equal(w.length, 3); assert.equal(w[2].data.consentExpiresAt, null); assert.match(await entry("TEST Radiology").innerText(), /No end date/); ok("Expiry: extending then removing the date works (null = never expires)");
    await f.locator('[data-exp="bizC"]').click(); assert.match(await txt(f, "#sxTitle"), /Extend/); await f.locator("#sxDate").fill(iso(NOW + 10 * DAY)); await f.locator("#sxSaveBtn").click(); await page.waitForTimeout(300);
    const t = await entry("TEST Lab").innerText(); assert.match(t, /Sharing/); assert.doesNotMatch(t, /Expired/); ok("Expiry: an expired share can be extended and is active again");
    assert.ok((await all(page, "pc_audit_logs")).filter(x => x.action === "share.expiry").length >= 4); ok("Expiry: every change is in the audit log");
    await page.screenshot({ path: OUT + "/share-390-mobile.png" });
  }
  // ---------- grant / re-grant with the date
  {
    const { page, f } = await open(390, 844, ""); await f.locator("#sOpenBtn").click(); assert.equal(await vis(f, "#sUntil"), true);
    // Share again for the stopped share: the old date must be replaced by a new date or cleared (null), never left behind
    await f.locator('[data-again="bizD"]').click(); await f.locator("#sPurpose").fill("Second referral"); await f.locator("#sBy").fill("TEST Guardian"); await f.locator("#sAgree").check();
    await f.locator("#sUntil").fill(iso(NOW - DAY)); await f.locator("#sGrantBtn").click(); assert.match(await txt(f, "#sMsg"), /must be in the future/);
    assert.equal((await writes(page)).filter(x => x.path.indexOf("pc_shares/") === 0).length, 0); ok("Grant: a past end date is refused");
    await f.locator("#sUntil").fill(iso(NOW + 15 * DAY)); await f.locator("#sGrantBtn").click(); await page.waitForTimeout(400);
    const w = (await writes(page)).filter(x => x.path === "pc_shares/pold_" + F + "_bizD"); assert.equal(w.length, 1); assert.equal(w[0].kind, "update");
    assert.ok("consentExpiresAt" in w[0].data && new Date(w[0].data.consentExpiresAt).getTime() > NOW + 14 * DAY); assert.ok(w[0].data.snapshotAt); assert.equal(w[0].data.revokedAt, null); ok("Re-grant: the update carries a NEW future consentExpiresAt and a fresh snapshotAt");
  }
  {
    const { page, f } = await open(390, 844, ""); await f.locator('[data-again="bizD"]').click(); await f.locator("#sPurpose").fill("Third referral"); await f.locator("#sBy").fill("TEST Guardian"); await f.locator("#sAgree").check(); await f.locator("#sGrantBtn").click(); await page.waitForTimeout(400);
    const w = (await writes(page)).filter(x => x.path === "pc_shares/pold_" + F + "_bizD"); assert.equal(w.length, 1); assert.ok("consentExpiresAt" in w[0].data && w[0].data.consentExpiresAt === null); ok("Re-grant with no date sends consentExpiresAt explicitly as null (clears any old date, as the rules require)");
  }
  // ---------- receiving side
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(BASE + "?as=owner&go=" + encodeURIComponent("?share=sx1")); const f = page.frameLocator("#f");
    const shr = x => Object.assign({ businessId: "bizX", facilityId: "shopX", patientId: "pshared", granteeBusinessId: B, granteeFacilityId: F, sourceFacilityName: "TEST Source Hospital", sourceBusinessName: "TEST Source Ltd", purpose: "Referral", patientSnapshot: { fullName: "TEST Shared Person", sex: "female", dobPrecision: "unknown", sourceRegNo: "H-9" }, grantedAt: { seconds: Math.floor((NOW - 9 * DAY) / 1000) }, snapshotAt: { seconds: Math.floor((NOW - 3 * DAY) / 1000) }, revokedAt: null }, x);
    await add(page, "pc_shares", "sx1", shr({})); await add(page, "pc_shares", "sx2", shr({ consentExpiresAt: new Date(NOW - 3600000).toISOString(), patientSnapshot: { fullName: "TEST Expired Person", sex: "male", dobPrecision: "unknown" } })); await add(page, "pc_shares", "sx3", shr({ consentExpiresAt: new Date(NOW + 5 * DAY).toISOString() }));
    await add(page, "pc_allergies", "ax", { businessId: "bizX", facilityId: "shopX", patientId: "pshared", substance: "TESTsulfa", severity: "moderate", status: "active", recordedDate: "2026-02-02" });
    await page.evaluate(() => { document.getElementById("f").contentWindow.location.reload(); }); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(500);
    const sn = await txt(f, "#sharedNote"); assert.match(sn, /Details as of \d\d\/\d\d\/\d{4}/); assert.doesNotMatch(sn, /Access ends/); ok("Receiving: the shared patient shows 'Details as of <date of the last refresh>'");
    await page.goto(BASE + "?as=owner&go=" + encodeURIComponent("?share=sx3")); await add(page, "pc_shares", "sx3", shr({ consentExpiresAt: new Date(NOW + 5 * DAY).toISOString() })); await page.evaluate(() => { document.getElementById("f").contentWindow.location.reload(); }); await f.locator("#tab-overview:visible").waitFor(); await page.waitForTimeout(500);
    assert.match(await txt(f, "#sharedNote"), /Access ends \d\d\/\d\d\/\d{4}/); ok("Receiving: a share with a future end date says when access ends");
    await page.goto(BASE + "?as=owner&go=" + encodeURIComponent("?share=sx2")); await add(page, "pc_shares", "sx2", shr({ consentExpiresAt: new Date(NOW - 3600000).toISOString(), patientSnapshot: { fullName: "TEST Expired Person", sex: "male", dobPrecision: "unknown" } })); await page.evaluate(() => { document.getElementById("f").contentWindow.location.reload(); }); await f.locator("#gateCard").waitFor(); await page.waitForTimeout(300);
    const g = await f.locator("body").innerText(); assert.match(g, /ended on \d\d\/\d\d\/\d{4}[\s\S]*Expired/); assert.doesNotMatch(g, /TEST Expired Person|TESTsulfa/); assert.equal(await f.locator("#mainArea").isVisible(), false); ok("Receiving: an expired share shows 'Expired', who to ask, and no patient details or records");
    await page.screenshot({ path: OUT + "/expired-390-mobile.png" });
  }
  // ---------- receiving side: list
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); let dlg = ""; page.on("dialog", d => { dlg = d.message(); d.accept(); });
    await page.goto("http://localhost:8765/tests/patients-harness.html"); await page.waitForTimeout(500);
    const f = page.frameLocator("#f"); await f.locator("#q").waitFor(); const has = await page.evaluate(() => typeof window.__db.add === "function"); assert.ok(has);
    const shr = (x, n) => Object.assign({ businessId: "bizX", facilityId: "shopX", patientId: "p_" + n, granteeBusinessId: "biz1", granteeFacilityId: "shop1", sourceFacilityName: "TEST Source Hospital", sourceBusinessName: "TEST Source Ltd", purpose: "Referral", patientSnapshot: { fullName: "TEST " + n + " Shared", sex: "female", dobPrecision: "unknown", phone: "0711" + n.length + "00123" }, grantedAt: { seconds: Math.floor((NOW - 9 * DAY) / 1000) }, snapshotAt: { seconds: Math.floor((NOW - 2 * DAY) / 1000) }, revokedAt: null }, x);
    await add(page, "pc_shares", "gl1", shr({}, "Live")); await add(page, "pc_shares", "gl2", shr({ consentExpiresAt: new Date(NOW - 3600000).toISOString() }, "Gone")); await page.waitForTimeout(600);
    await f.locator("#q").fill("Shared"); await page.waitForTimeout(400); const rows = await f.locator("#results .pt").allInnerTexts();
    const live = rows.find(r => /Live Shared/.test(r)), gone = rows.find(r => /Gone Shared/.test(r)); assert.ok(live && gone, rows.join("|"));
    assert.match(live, /Details as of \d\d\/\d\d\/\d{4}/); assert.doesNotMatch(live, /Expired/); assert.match(gone, /Expired[\s\S]*Sharing ended \d\d\/\d\d\/\d{4}/); ok("List: shared rows show 'Details as of'; an expired share still shows, marked Expired, with the end date");
    await page.goto("http://localhost:8765/tests/patients-harness.html?go=" + encodeURIComponent("?fromShare=gl2")); await add(page, "pc_shares", "gl2", shr({ consentExpiresAt: new Date(NOW - 3600000).toISOString() }, "Gone")); await page.evaluate(() => { document.getElementById("f").contentWindow.location.reload(); }); await page.waitForTimeout(1200);
    assert.match(dlg, /has ended/); assert.equal(await page.frameLocator("#f").locator("#fName").inputValue().catch(() => ""), ""); ok("List: 'Register as our patient' from an expired share is refused");
  }
  // ---------- offline (server never answers) and phone widths
  {
    const { page, f } = await open(360, 640, "offline=1");
    await f.locator("#editIdBtn").click(); await f.locator("#idName").fill("TEST Offline Name"); await f.locator("#idReason").fill("Fixed offline"); await f.locator("#idSaveBtn").click(); await page.waitForTimeout(500);
    assert.match(await txt(f, "#pName"), /TEST Offline Name/); assert.match(await txt(f, "#doneMsg"), /Saved on this phone/); assert.equal(await vis(f, "#idCard"), false);
    assert.equal((await patientDoc(page, "pold")).identityVersion, 1); assert.equal((await all(page, "pc_patient_corrections")).length, 1); assert.match(await txt(f, "#corrList"), /Fixed offline/); ok("Offline: a correction is applied and listed at once with 'Saved on this phone'; the screen never waits for the server");
    await f.locator('[data-refresh="bizB"]').click(); await page.waitForTimeout(300); assert.match(await txt(f, "#doneMsg"), /Saved on this phone/); assert.equal((await all(page, "pc_shares")).find(x => x._id === "pold_" + F + "_bizB").patientSnapshot.fullName, "TEST Offline Name"); ok("Offline: refreshing shared details is applied locally at once");
    await f.locator('[data-exp="bizB"]').click(); await f.locator("#sxDate").fill(iso(NOW + 20 * DAY)); await f.locator("#sxSaveBtn").click(); await page.waitForTimeout(300); assert.match(await f.locator('#sOutList .entry:has-text("TEST Radiology")').innerText(), /Ends \d\d\/\d\d\/\d{4}/); ok("Offline: setting an end date is applied locally at once");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); await f.locator("#editIdBtn").click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); await page.screenshot({ path: OUT + "/identity-360-small-phone.png" }); ok("360x640 phone: forms open with no sideways scroll");
  }
  for (const [w, h, n] of [[768, 1024, "tablet"], [1280, 900, "desktop"]]) { const { page, f } = await open(w, h, ""); await f.locator("#editIdBtn").click(); await f.locator('[data-exp="bizB"]').click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); await page.screenshot({ path: OUT + "/identity-" + n + ".png" }); ok(n + ": forms open with no sideways scroll"); }
  const own = errors.filter(e => !/favicon/i.test(e)); assert.equal(own.length, 0, "page errors: " + own.join(" | ")); ok("No JavaScript errors");
  await browser.close(); console.log("identity-share-check: " + results.length + " checks passed (in-memory stand-in, rules not evaluated, offline simulated)");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
