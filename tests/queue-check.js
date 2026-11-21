/* Developer 2, Stage 3: visit queue with department tabs and "Send to next step" (encounters.html).
   In-memory stand-in (NOT real Firebase). Run: python3 -m http.server 8765, then node tests/queue-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", BASE = "http://localhost:8765/tests/queue-harness.html";
const B = "biz1", F = "shop1", NOW = Date.now();
const day = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();
(async () => {
  const browser = await chromium.launch(), errors = [], results = [];
  const ok = n => { results.push(n); console.log("PASS " + n); };
  const sc = { businessId: B, facilityId: F };
  const add = (page, c, id, d) => page.evaluate(a => window.__db.add(a[0], a[1], a[2]), [c, id, d]);
  async function open(w, h, qs) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(BASE + (qs || "")); await page.evaluate(() => { window.MC.go = function (u) { window.__went = u; }; });
    const enc = (id, name, stage, extra) => Object.assign({ patientId: "p_" + id, patientName: name, patientSex: "female", patientDobPrecision: "exact", patientDob: "1990-01-01", encounterNo: "E-" + id, type: "outpatient", status: "open", stage, arrivalAt: NOW - 3600000 + Number(id) * 1000, arrivalDay: day, reason: "Cough" }, sc, extra || {});
    await add(page, "pc_encounters", "e1", enc("1", "TEST Triage Wait", "registered"));
    await add(page, "pc_encounters", "e2", enc("2", "TEST Consult Then Rx", "in_consultation", { journey: { v: 1, next: "pharmacy", waiting: [], note: "Give with food" } }));
    await add(page, "pc_encounters", "e3", enc("3", "TEST Lab Patient", "in_consultation"));
    await add(page, "pc_encounters", "e4", enc("4", "TEST Triaged Only", "triaged"));
    await add(page, "pc_encounters", "e5", enc("5", "TEST Dressing Pat", "in_consultation", { journey: { v: 1, next: "treatment", waiting: ["patient"], note: "" } }));
    await add(page, "pc_encounters", "e6", enc("6", "TEST Closed One", "in_consultation", { status: "closed" }));
    await add(page, "pc_treatment_orders", "m1", Object.assign({ encounterId: "e2", patientId: "p_2", kind: "medicine", medicineName: "TESTmed", status: "active" }, sc));
    await add(page, "pc_treatment_orders", "m2", Object.assign({ encounterId: "e5", patientId: "p_5", kind: "procedure", procedureName: "TEST dressing", status: "active" }, sc));
    await add(page, "pc_inv_orders", "l1", Object.assign({ encounterId: "e3", patientId: "p_3", name: "TEST Hb", status: "requested" }, sc));
    await add(page, "pc_inv_orders", "l2", Object.assign({ encounterId: "e3", patientId: "p_3", name: "TEST Malaria", status: "processing" }, sc));
    await add(page, "pc_inv_orders", "l3", Object.assign({ encounterId: "e2", patientId: "p_2", name: "TEST old", status: "reviewed" }, sc));
    const f = page.frameLocator("#f"); await f.locator("#qList .pt").first().waitFor(); await page.waitForTimeout(300); return { page, f };
  }
  const names = async f => (await f.locator("#qList .pt-name").allInnerTexts()).map(t => t.split("\n")[0].replace(/\s+(Outpatient|Emergency|Follow-up|Procedure|Pharmacy)\b.*$/, "").trim());
  const tab = (f, d) => f.locator('#deptTabs [data-d="' + d + '"]');

  {
    const { page, f } = await open(390, 844);
    const t = await f.locator("#deptTabs").innerText();
    assert.match(t, /All \(5\)/); assert.match(t, /Triage \(1\)/); assert.match(t, /Consultation \(2\)/); assert.match(t, /Laboratory \(1\)/); assert.match(t, /Pharmacy \(1\)/); assert.match(t, /Procedures \(1\)/);
    ok("Department tabs count the right open visits (records and hints), closed visits excluded");
    await tab(f, "laboratory").click(); assert.deepEqual(await names(f), ["TEST Lab Patient"]); assert.match(await f.locator("#qList").innerText(), /2 tests in the laboratory/);
    assert.equal(await f.locator("#deptLink").isVisible(), true); await f.locator("#deptLink a").click(); assert.equal(await page.evaluate(() => window.__went), "laboratory.html"); ok("Laboratory tab shows only patients with real pending tests, and links to the existing laboratory work list (no duplicate queue)");
    await tab(f, "pharmacy").click(); assert.deepEqual(await names(f), ["TEST Consult Then Rx"]); assert.match(await f.locator("#qList").innerText(), /Next: Pharmacy[\s\S]*Give with food/); ok("Pharmacy tab shows the patient sent to pharmacy, with the note and next step");
    await tab(f, "triage").click(); assert.deepEqual(await names(f), ["TEST Triage Wait"]);
    await tab(f, "consultation").click(); assert.deepEqual((await names(f)).sort(), ["TEST Lab Patient", "TEST Triaged Only"].sort());
    await tab(f, "treatment").click(); assert.deepEqual(await names(f), ["TEST Dressing Pat"]); assert.match(await f.locator("#qList").innerText(), /Procedure ordered[\s\S]*Waiting: Patient to return/);
    await tab(f, "all").click(); assert.equal((await names(f)).length, 5);
    ok("Triage, Consultation and Procedures tabs each show only the patients that need that team");
    assert.ok(!(await tab(f, "laboratory").innerText()).includes("(2)")); // the consult+Rx patient and the triage patient are never in the lab
    const all = await f.locator("#qList").innerText(); assert.equal(await f.locator("#qList .pt", { hasText: "TEST Triage Wait" }).innerText().then(x => /Medicine ordered/.test(x)), false, "no medicine chip without an order");
    assert.match(all, /Now: Waiting[\s\S]*Next: Triage/); assert.match(all, /Now: Triaged[\s\S]*Next: Consultation/);
    ok("Every open visit shows its current status and next step");
    await page.screenshot({ path: OUT + "/queue-390-mobile.png" });
  }
  {
    const { page, f } = await open(390, 844);
    // route: triage patient goes straight to consultation (triage skipped), nothing else forced
    const row = f.locator('#qList .pt', { hasText: "TEST Triage Wait" }); await row.locator("[data-route]").click(); assert.equal(await f.locator("#routeCard").isVisible(), true);
    await f.locator("#rNext").selectOption("consultation"); await f.locator("#rNote").fill("Walk-in for repeat prescription"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(500);
    const e1 = (await page.evaluate(() => window.__db.all("pc_encounters"))).find(e => e._id === "e1");
    assert.deepEqual(e1.journey, { v: 1, next: "consultation", waiting: [], note: "Walk-in for repeat prescription" }); assert.equal(e1.stage, "registered"); assert.ok(e1.updatedBy);
    assert.equal((await page.evaluate(() => window.__db.all("pc_audit_logs"))).filter(a => a.action === "journey.route" && a.encounterId === "e1").length, 1);
    assert.equal((await page.evaluate(() => window.__db.all("pc_inv_orders"))).length, 3, "routing creates no orders");
    const t = await f.locator("#deptTabs").innerText(); assert.match(t, /Triage \(0\)/); assert.match(t, /Consultation \(3\)/); assert.equal(await f.locator("#routeCard").isVisible(), false);
    ok("Send to next step: writes only the journey hint (+ audit), no stage change, no orders; patient moves from Triage to Consultation");
    // stale hint: lab hint with no tests does not put the patient in the lab
    await f.locator('#qList .pt', { hasText: "TEST Triaged Only" }).locator("[data-route]").click(); await f.locator("#rNext").selectOption("investigation"); await f.locator('#rWaiting input[value="laboratory"]').check(); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(400);
    await tab(f, "laboratory").click(); assert.deepEqual(await names(f), ["TEST Lab Patient"]); ok("A hint cannot create laboratory work: only real test orders put a patient in the laboratory queue");
    // validation: more than 4 waiting
    await tab(f, "all").click(); await f.locator('#qList .pt', { hasText: "TEST Dressing Pat" }).locator("[data-route]").click();
    for (const v of ["laboratory", "pharmacy", "treatment", "clinician", "patient"]) await f.locator('#rWaiting input[value="' + v + '"]').check();
    const before = (await page.evaluate(() => window.__db.writes.length)); await f.locator("#rSaveBtn").click(); assert.match(await f.locator("#rMsg").innerText(), /at most 4/); assert.equal(await page.evaluate(() => window.__db.writes.length), before);
    await f.locator("#rCancelBtn").click(); assert.equal(await f.locator("#routeCard").isVisible(), false); ok("More than 4 'waiting' items is refused with a message and nothing is written; Cancel closes the form");
    // closed visits have no route button
    await f.locator('#qTabs [data-f="closed"]').click(); assert.equal(await f.locator("[data-route]").count(), 0); ok("Closed visits cannot be routed");
  }
  {
    const { page, f } = await open(390, 844, "?as=view");
    assert.equal(await f.locator("[data-route]").count(), 0); assert.match(await f.locator("#qList").innerText(), /Next: Pharmacy/); ok("View-only user sees the journey and departments but has no 'Send to next step' button");
  }
  {
    const { page, f } = await open(390, 844); await f.locator('#qList .pt', { hasText: "TEST Consult Then Rx" }).click(); assert.match(await page.evaluate(() => window.__went), /encounter\.html\?id=e2/); ok("Tapping a visit still opens it");
  }
  for (const [w, h, n] of [[360, 640, "small-phone"], [768, 1024, "tablet"], [1280, 900, "desktop"]]) {
    const { page, f } = await open(w, h); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, n);
    await f.locator('#qList .pt', { hasText: "TEST Lab Patient" }).locator("[data-route]").click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, n + " with route form");
    await page.screenshot({ path: OUT + "/queue-" + n + ".png" }); ok(w + "x" + h + " " + n + ": no sideways scroll (list and route form)");
  }
  const own = errors.filter(e => !/favicon/i.test(e)); assert.equal(own.length, 0, "page errors: " + own.join(" | ")); ok("No JavaScript errors");
  await browser.close(); console.log("queue-check: " + results.length + " checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
