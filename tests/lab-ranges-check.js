/* Developer 4, Stage 3c: reference ranges at result entry, in the real laboratory.html, in Chromium (phone and desktop sizes).
   IN-MEMORY Firestore stand-in: NOT real Firebase, NO security rules. TEST values only, invented for testing.
   Run: python3 -m http.server 8765 (repo root), then node tests/lab-ranges-check.js [outdir] */
const { chromium } = require("playwright"), assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", B = "biz1", F = "shop1";
const d = new Date(), DAY = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage(); page.on("pageerror", e => errors.push(name + ": " + String(e))); page.on("dialog", dl => dl.accept("Test reason"));
    await page.goto("http://localhost:8765/tests/lab-harness.html"); const f = page.frameLocator("#f"); await f.locator("#list .pt").first().waitFor(); await page.waitForTimeout(300);
    const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]), wait = (ms = 250) => page.waitForTimeout(ms);
    const order = (id, nm, extra) => db("add", "pc_inv_orders", id, Object.assign({ id, name: nm, status: "processing", businessId: B, facilityId: F, patientId: "pA", patientName: "TEST Patient", encounterId: "e1", encounterNo: "V-1", priority: "routine", requestedBy: "doc1", requestedByName: "Dr Test", requestedAt: Date.now() - 600000, requestedDay: DAY, schemaVersion: 1, specimen: "Serum" }, extra));
    const patient = (id, extra) => db("add", "pc_patients", id, Object.assign({ businessId: B, registeredFacilityId: F, facilityId: F, fullName: "TEST " + id, dob: "1990-01-01", dobPrecision: "exact", sex: "female" }, extra));
    const range = (key, o, v = 1) => db("add", "pc_reference_ranges", "rr_" + key + "_v" + v, Object.assign({ businessId: B, facilityId: F, approvalStatus: "approved", rangeKey: key, version: v, subjectType: "lab_test", subjectId: "cA", paramKey: "", unit: "tu", refMin: 10, refMax: 20, sex: "any", pregnancy: "any", lactation: "any", source: "TEST source", effectiveDate: "2020-01-01" }, o));
    const open = async id => { await f.locator('#tabs [data-f="inlab"]').click(); await wait(150); await f.locator('#list .pt[data-ord="' + id + '"]').click(); await wait(500); };
    const ref = () => f.locator("#rRefBox").innerText(), flag = () => f.locator("#rFlag").inputValue();
    const NUM = { resultType: "number", units: "tu", investigationId: "cA", profile: { type: "number" } };
    await patient("pA"); await patient("pM", { sex: "male" });

    // A. no range anywhere: "Reference range not configured", no flag even for an extreme value, and the result says so
    await order("oA", "TEST A", NUM); await open("oA");
    assert.equal(await ref(), "Reference range not configured"); await f.locator("#rVal").fill("99999"); await wait(); assert.equal(await flag(), "none"); assert.equal(await ref(), "Reference range not configured");
    assert.equal(await f.locator("#rCtxBox").isVisible(), false);
    await f.locator("#rSaveBtn").click(); await wait(400);
    let r = await db("get", "pc_inv_results", "oA"); assert.equal(r.flag, "none"); assert.equal(r.refApplied.length, 1); assert.equal(r.refApplied[0].state, "unavailable"); assert.equal(r.refApplied[0].reason, "no_range"); assert.equal(r.refMin, null); assert.equal(r.refMax, null); assert.equal(r.refApplied[0].pregnancy, "unknown");
    // B. an approved range appears while the screen is open: shown at once; the flag follows the value
    await order("oB", "TEST B", NUM); await open("oB"); assert.equal(await ref(), "Reference range not configured");
    await range("kA", {}); await wait(400); assert.equal(await ref(), "Reference: 10 to 20 tu (TEST source, version 1)");
    await f.locator("#rVal").fill("25"); await wait(); assert.match(await ref(), /above the reference range/); assert.equal(await flag(), "high");
    await f.locator("#rVal").fill("5"); await wait(); assert.equal(await flag(), "low"); await f.locator("#rVal").fill("15"); await wait(); assert.equal(await flag(), "normal"); await f.locator("#rVal").fill("25"); await wait();
    await f.locator("#rSaveBtn").click(); await wait(400);
    r = await db("get", "pc_inv_results", "oB"); assert.equal(r.flag, "high"); assert.equal(r.refApplied[0].rangeId, "rr_kA_v1"); assert.equal(r.refApplied[0].basis, "context_range"); assert.equal(r.refApplied[0].min, 10); assert.equal(r.refMin, 10); assert.equal(r.refMax, 20); assert.equal(r.refSource, "TEST source"); assert.equal(r.refApplied[0].sex, "female"); assert.equal(r.refApplied[0].ageBasis, "exact");
    assert.equal(r.refApplied[0].resolvedAt, DAY); assert.equal(Object.values(r).includes(undefined), false);
    const au = (await db("all", "pc_audit_logs")).filter(x => x.action === "lab.result" && x.resultId === "oB")[0]; assert.match(au.refStates, /:context_range\/range/); assert.equal(au.flagPicked, false);
    // the verify screen shows the stored range
    await f.locator('#tabs [data-f="resulted"]').click(); await wait(150); await f.locator('#list .pt[data-ord="oB"]').click(); await wait(500);
    assert.match(await f.locator("#actCard").innerText(), /Reference: 10 to 20 tu \(TEST source, version 1\)/);
    // F. a newer version now exists: a notice on the unverified result, and the stored range is NOT rewritten
    await db("add", "pc_reference_ranges", "rr_kA_v1", Object.assign(await db("get", "pc_reference_ranges", "rr_kA_v1"), { approvalStatus: "superseded" })); await range("kA", { refMax: 30 }, 2); await wait(600);
    assert.match(await f.locator("#actCard").innerText(), /newer or different reference range/); r = await db("get", "pc_inv_results", "oB"); assert.equal(r.refApplied[0].rangeId, "rr_kA_v1"); assert.equal(r.refMax, 20); assert.match(await f.locator("#actCard").innerText(), /Reference: 10 to 20 tu/);
    // C. pregnancy: asked only because a range depends on it; 'not stated' never matches; stored with the result only
    await order("oC", "TEST C", Object.assign({}, NUM, { investigationId: "cB" })); await range("kP", { subjectId: "cB", pregnancy: "pregnant", refMin: 100, refMax: 200 }); await range("kN", { subjectId: "cB", pregnancy: "not_pregnant", refMin: 1, refMax: 2 }); await wait(300);
    await open("oC"); assert.equal(await f.locator("#rPregWrap").isVisible(), true); assert.equal(await f.locator("#rLactWrap").isVisible(), false); assert.match(await ref(), /^Reference range not configured\. Reference ranges for this test depend on pregnancy/);
    await f.locator("#rVal").fill("150"); await wait(); assert.equal(await flag(), "none"); await f.locator("#rPreg").selectOption("pregnant"); await wait(); assert.equal(await flag(), "normal"); assert.match(await ref(), /^Reference: 100 to 200 tu/);
    await f.locator("#rSaveBtn").click(); await wait(400); r = await db("get", "pc_inv_results", "oC"); assert.equal(r.refApplied[0].pregnancy, "pregnant"); assert.equal(r.refApplied[0].rangeId, "rr_kP_v1"); assert.equal((await db("get", "pc_patients", "pA")).pregnancy, undefined, "nothing is written to the patient");
    await order("oC2", "TEST C2", Object.assign({}, NUM, { investigationId: "cB", patientId: "pM" })); await open("oC2"); assert.equal(await f.locator("#rCtxBox").isVisible(), false, "never asked of a male patient"); await f.locator("#rVal").fill("1.5"); await wait();
    assert.equal(await flag(), "none"); await f.locator("#rSaveBtn").click(); await wait(400); assert.equal((await db("get", "pc_inv_results", "oC2")).refApplied[0].state, "unavailable");
    // D. the test's own catalogue range is a labelled fallback and behaves as before
    await order("oD", "TEST D", Object.assign({}, NUM, { investigationId: "cD", refMin: 1, refMax: 5, refSource: "TEST catalogue" })); await open("oD"); assert.match(await ref(), /^Reference: 1 to 5 tu \(facility setting, TEST catalogue\)/);
    await f.locator("#rVal").fill("0.5"); await wait(); assert.equal(await flag(), "low"); await f.locator("#rSaveBtn").click(); await wait(400); r = await db("get", "pc_inv_results", "oD"); assert.equal(r.refApplied[0].basis, "legacy_catalogue"); assert.equal(r.refMin, 1); assert.equal(r.flag, "low");
    // E. a multi-part test: each numeric part has its own reference and flag
    await order("oE", "TEST E", { resultType: "multi", investigationId: "cE", profile: { type: "multi", params: [{ key: "a", label: "Alpha", type: "number", unit: "tu" }, { key: "b", label: "Beta", type: "number", unit: "tv", refMin: 1, refMax: 2, refSource: "TEST catalogue" }, { key: "c", label: "Gamma", type: "qualitative", choices: ["Yes", "No"] }] } });
    await range("kE", { subjectType: "lab_param", subjectId: "cE", paramKey: "a", refMin: 10, refMax: 20 }); await wait(300); await open("oE");
    assert.match(await f.locator("#rrh_a").innerText(), /^Reference: 10 to 20 tu/); assert.match(await f.locator("#rrh_b").innerText(), /facility setting/); await f.locator("#rp_a").fill("25"); await f.locator("#rp_b").fill("1.5"); await wait(); assert.match(await f.locator("#rrh_a").innerText(), /above the reference range/); assert.match(await f.locator("#rrh_b").innerText(), /within the reference range/);
    await f.locator("#rp_c").selectOption("Yes"); await f.locator("#rSaveBtn").click(); await wait(400); r = await db("get", "pc_inv_results", "oE");
    assert.equal(r.values.a.flag, "high"); assert.equal(r.values.b.flag, "normal"); assert.equal(r.values.c.flag, "none"); assert.equal(r.flag, "abnormal"); assert.deepEqual(r.refApplied.map(e => e.param), ["a", "b"]); assert.equal(r.values.a.refMax, 20);
    // G. the patient cannot be read: ranges that need age or sex are not used, and the screen says so
    await order("oG", "TEST G", Object.assign({}, NUM, { investigationId: "cG", patientId: "pMissing" })); await range("kG", { subjectId: "cG", minAgeMonths: 216 }); await range("kG2", { subjectId: "cG2" }); await wait(300); await open("oG");
    assert.match(await ref(), /Reference range not configured\. Reference ranges for this test depend on age/); assert.match(await f.locator("#actCard").innerText(), /age and sex could not be read/);
    await order("oG2", "TEST G2", Object.assign({}, NUM, { investigationId: "cG2", patientId: "pMissing" })); await open("oG2"); assert.match(await ref(), /^Reference: 10 to 20 tu/, "a range that does not depend on the patient still applies"); await f.locator("#rVal").fill("15"); await wait(); assert.equal(await flag(), "normal");
    // H. results entered before this stage have no refApplied: shown exactly as stored, nothing added
    await db("add", "pc_inv_results", "oOld", { orderId: "oOld", businessId: B, facilityId: F, value: 3, valueType: "number", unit: "u/L", refMin: 10, refMax: 20, refSource: "Test source", flag: "low", status: "unverified", resultAt: Date.now(), enteredByName: "Lab Owner" });
    await order("oOld", "TEST old", { resultType: "number", units: "u/L", status: "resulted", currentResultId: "oOld", profile: { type: "number" } }); await f.locator('#tabs [data-f="resulted"]').click(); await wait(150); await f.locator('#list .pt[data-ord="oOld"]').click(); await wait(500);
    const oldTxt = await f.locator("#actCard").innerText(); assert.match(oldTxt, /3 u\/L/); assert.match(oldTxt, /Below reference range/); assert.doesNotMatch(oldTxt, /not configured|newer or different/, "an old result is shown as it was stored: it never claims a range is missing");
    // I. the existing text and qualitative tests are untouched: no reference box, no refApplied
    await db("add", "pc_inv_orders", "oQual", Object.assign(await db("get", "pc_inv_orders", "oQual"), { status: "processing" })); await open("oQual"); assert.equal(await f.locator("#rRefBox").count(), 0); await f.locator("#rVal").selectOption("Negative"); await f.locator("#rSaveBtn").click(); await wait(400); assert.equal((await db("get", "pc_inv_results", "oQual")).refApplied, undefined);
    const over = await f.locator("body").evaluate(b => b.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1, name + ": sideways scroll " + over + "px");
    await f.locator('#tabs [data-f="inlab"]').click(); await order("oS", "TEST shot", NUM); await open("oS"); await wait(300); await page.screenshot({ path: OUT + "/lab-ranges-" + name + ".png" });
    console.log(name + ": ok");
  }
  await browser.close(); assert.deepEqual(errors, []); console.log("page errors: none");
})().catch(e => { console.error(e); process.exit(1); });
