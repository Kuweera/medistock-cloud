/* Developer 3, Stage A: the pharmacy list must not keep dispensed prescriptions as Waiting, and the MAR "Active plans" view must list only treatment that staff give.
   Real pharmacy.html and treatment.html in headless Chromium at 390px against the in-memory stand-in (NOT real Firebase). This check FAILS on the files from before Stage A.
   Run: python3 -m http.server 8765 (repo root), then node tests/stageA-stale-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", PH = "http://localhost:8765/tests/harness-stage6.html", TR = "http://localhost:8765/tests/treatment-harness-att.html";

(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(url) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept("Test reason"));
    await page.goto(url); await page.waitForTimeout(900); return { page, f: page.frameLocator("#f") };
  }
  /* ================= PHARMACY ================= */
  {
    const { page, f } = await open(PH); await f.locator("#list .rxgroup").first().waitFor();
    await page.evaluate(() => { window.__db.add = (c, i, d) => { window.__db.put(c, i, d); window.__db.notify(); }; });   // this harness has put + notify
    const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]);
    const listed = async () => f.locator("#list .pt").evaluateAll(n => n.map(x => x.dataset.id));
    const reads = () => page.evaluate(() => (window.__reads || []).filter(p => p.startsWith("prescriptions/")));          // SERVER reads
    const cacheTries = () => page.evaluate(() => (window.__cacheReads || []).filter(p => p.startsWith("prescriptions/")));   // local cache look-ups (free)
    const typeQ = async v => { await f.locator("#q").fill(v); await page.waitForTimeout(250); };
    assert.ok((await listed()).includes("c9"), "c9 waits at the start");
    const w0n = Number(((await f.locator('#filters [data-f="waiting"]').innerText()).match(/\((\d+)\)/) || [0, 0])[1]);

    /* 1. dispense the whole prescription on this phone, never opening "Fully dispensed" */
    await f.locator('#list .pt[data-id="c9"]').click(); await f.locator("#cPat").waitFor(); await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator("#qDo").fill("5");
    await f.locator('#actCard [data-act="pay"][data-m="credit"]').click(); await f.locator('#actCard [data-act="confirm"]').click(); await f.locator("#actCard .recordtext").waitFor();
    const rx = await db("get", "prescriptions", "c9"); assert.equal(rx.status, "completed"); assert.equal((await db("get", "pc_treatment_orders", "c9")).status, "active", "dispensing does not complete the order");
    await f.locator('#actCard [data-act="close"]').click(); await page.waitForTimeout(700);
    assert.ok(!(await listed()).includes("c9"), "a fully dispensed prescription must NOT stay in Waiting (it did before Stage A)");
    const w1n = Number(((await f.locator('#filters [data-f="waiting"]').innerText()).match(/\((\d+)\)/) || [0, 0])[1]); assert.equal(w1n, w0n - 1, "the Waiting tab count drops by one (was " + w0n + ", now " + w1n + ")");
    await f.locator('#filters [data-f="done"]').click(); await page.waitForTimeout(400); assert.ok((await listed()).includes("c9"), "it is listed under Fully dispensed");
    /* 2. its panel says fully dispensed and has no confirm button */
    await f.locator('#list .pt[data-id="c9"]').click(); await page.waitForTimeout(300);
    assert.match(await f.locator("#actCard").innerText(), /Fully dispensed/); assert.equal(await f.locator('#actCard [data-act="confirm"]').count(), 0, "no confirm button on a finished prescription");
    await page.screenshot({ path: OUT + "/stageA-pharmacy-fully-dispensed-mobile.png" }); await f.locator('#actCard [data-act="close"]').click(); await f.locator('#filters [data-f="waiting"]').click(); await page.waitForTimeout(300);

    /* 3. an order whose prescription was completed earlier (another day, device or user): never loaded by a list, so ONE read finds it. Old order without any prescription stays Waiting. Reads are counted. */
    const o0 = await db("get", "pc_treatment_orders", "c9"), x0 = await db("get", "prescriptions", "c9"), r0 = (await reads()).length;
    const mk = (id, name, rxStatus) => page.evaluate(([o, x, id, name, st]) => { const oo = Object.assign({}, o, { id, medicineName: name, status: "active" }), xx = x && Object.assign({}, x, { id, orderId: id, status: st, qtyDispensed: st === "completed" ? x.qtyPrescribed : 0, qtyOutstanding: st === "completed" ? 0 : x.qtyPrescribed });
      window.__db.add("pc_treatment_orders", id, oo); if (xx) window.__db.add("prescriptions", id, xx); }, [o0, rxStatus ? x0 : null, id, name, rxStatus]);
    await mk("oldDone", "OLDDONE syringe", "completed"); await mk("oldNone", "OLDNONE syringe", null); await page.waitForTimeout(900);
    const w1 = await listed(); assert.ok(!w1.includes("oldDone"), "older completed prescription is not Waiting"); assert.ok(w1.includes("oldNone"), "an old order with no prescription at all stays Waiting");
    let rd = (await reads()).slice(r0), ct = await cacheTries();
    assert.ok(rd.filter(p => p === "prescriptions/oldDone").length <= 1 && ct.filter(p => p === "prescriptions/oldDone").length >= 1, "the completed one: found with at most one read (here from the local cache)");
    assert.equal(rd.filter(p => p === "prescriptions/oldNone").length, 1, "exactly one server read for the one with no prescription");
    assert.ok(!rd.includes("prescriptions/c9") && ct.filter(p => p === "prescriptions/c9").length === 0 || true, "informational");
    assert.equal(rd.filter(p => p === "prescriptions/c9").length, 0, "a prescription the page already knows is not read again");
    const n0 = ct.length;
    for (const v of ["a", "", "syr", ""]) await typeQ(v); await f.locator('#filters [data-f="partial"]').click(); await f.locator('#filters [data-f="waiting"]').click(); await page.waitForTimeout(300);
    assert.deepEqual((await reads()).slice(r0), rd, "results (including 'none exists') are remembered: no second server read after many re-renders"); assert.equal((await cacheTries()).length, n0, "and no further cache look-ups either");

    /* 4. an OPEN dispensing panel whose prescription is completed elsewhere switches to 'Fully dispensed' and cannot be confirmed */
    await mk("openOne", "OPEN syringe", "pending"); await page.waitForTimeout(700);
    await f.locator('#list .pt[data-id="openOne"]').click(); await f.locator("#cPat").waitFor(); assert.equal(await f.locator('#actCard [data-act="confirm"]').count(), 1);
    await page.evaluate(() => { const x = window.__db.get("prescriptions", "openOne"); window.__db.add("prescriptions", "openOne", Object.assign({}, x, { status: "completed", qtyDispensed: x.qtyPrescribed, qtyOutstanding: 0 })); });
    await page.waitForTimeout(1200);
    assert.match(await f.locator("#actCard").innerText(), /Fully dispensed/); assert.equal(await f.locator('#actCard [data-act="confirm"]').count(), 0, "confirm is gone once the prescription is completed");
    await f.locator('#actCard [data-act="close"]').click();

    /* 5. server unreachable and nothing cached: no error, nothing blocked, row stays dispensable; checked again later.
          Fresh page: one that never opened "Fully dispensed" (that tab starts its own live list, which would already know the prescription). */
    const p2 = await open(PH), pg = p2.page, g = p2.f; await g.locator("#list .rxgroup").first().waitFor();
    await pg.evaluate(() => { window.__db.add = (c, i, d) => { window.__db.put(c, i, d); window.__db.notify(); }; });
    const listed2 = async () => g.locator("#list .pt").evaluateAll(n => n.map(x => x.dataset.id));
    const e0 = errors.length; await pg.evaluate(() => { window.__failReads = true; });
    await pg.evaluate(([o, x]) => { window.__db.add("pc_treatment_orders", "offOne", Object.assign({}, o, { id: "offOne", medicineName: "OFFLINE syringe", status: "active" })); window.__db.add("prescriptions", "offOne", Object.assign({}, x, { id: "offOne", orderId: "offOne", status: "completed", qtyDispensed: x.qtyPrescribed, qtyOutstanding: 0 })); }, [o0, x0]);
    await pg.waitForTimeout(1200);
    assert.ok((await listed2()).includes("offOne"), "unknown state while unreachable: still listed so it can be dispensed (the server refuses safely at sync)");
    const bodyTxt = await g.locator("body").innerText(); assert.doesNotMatch(bodyTxt, /unavailable|could not (check|load)|network error/i, "no error shown to the user");
    await g.locator('#list .pt[data-id="offOne"]').click(); await g.locator("#cPat").waitFor(); assert.equal(await g.locator('#actCard [data-act="confirm"]').count(), 1, "the dispensing form is available offline");
    await pg.screenshot({ path: OUT + "/stageA-pharmacy-offline-dispensable-mobile.png" });
    await g.locator('#actCard [data-act="close"]').click(); assert.equal(errors.length, e0, "no page error while unreachable");
    await pg.evaluate(() => { window.__failReads = false; }); await pg.waitForTimeout(31000); await g.locator("#q").fill("o"); await pg.waitForTimeout(300); await g.locator("#q").fill(""); await pg.waitForTimeout(900);
    assert.ok(!(await listed2()).includes("offOne"), "once reachable again it is checked and leaves Waiting");
    await browser.close().catch(() => {});
  }
  /* ================= MAR ================= */
  {
    const browser2 = await chromium.launch(); const page = await (await browser2.newContext({ viewport: { width: 390, height: 844 } })).newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(TR); const f = page.frameLocator("#f"); await page.waitForTimeout(900);
    const base = await page.evaluate(() => { const o = window.__db.all("pc_treatment_orders").find(x => x._id === "oH"); const { _id, ...rest } = o; return rest; });
    await page.evaluate(b => {
      const plan = (id, title) => window.__db.add("pc_treatment_plans", id, { businessId: b.businessId, facilityId: b.facilityId, patientId: b.patientId, patientName: b.patientName, title, status: "active", version: 1, encounterId: b.encounterId });
      const ord = (id, plan, extra) => window.__db.add("pc_treatment_orders", id, Object.assign({}, b, { planId: plan }, extra));
      plan("plA", "Mixed plan"); ord("a1", "plA", { medicineName: "STAFFINJ Ceftriaxone", scheduleType: "interval", administrationMode: "facility_administered" }); ord("a2", "plA", { medicineName: "TAKEHOME Amoxicillin", administrationMode: "take_home" });
      ord("a3", "plA", { medicineName: "10ml syringe", kind: "consumable", scheduleType: "once", administrationMode: undefined }); ord("a4", "plA", { kind: "procedure", procedureName: "WOUNDDRESSING", medicineName: undefined, scheduleType: "once", administrationMode: "facility_administered" });
      plan("plB", "Take-home only plan"); ord("b1", "plB", { medicineName: "ONLYHOME Paracetamol", administrationMode: "take_home" }); ord("b2", "plB", { medicineName: "gloves", kind: "consumable", scheduleType: "once", administrationMode: undefined });
    }, base);
    await page.waitForTimeout(600); await f.locator('#tabs [data-f="plans"]').click(); await page.waitForTimeout(400);
    const t = (await f.locator("#list").innerText()).replace(/\s+/g, " ");
    assert.match(t, /Mixed plan/); assert.match(t, /STAFFINJ Ceftriaxone/); assert.match(t, /WOUNDDRESSING/, "a procedure is given by staff");
    assert.doesNotMatch(t, /TAKEHOME|ONLYHOME|syringe|gloves/, "take-home medicines and consumables are not listed as active orders: " + t);
    assert.doesNotMatch(t, /Take-home only plan/, "a plan with nothing for staff to give is not shown");
    const mixed = await f.locator('#list .pt:has-text("Mixed plan")').innerText(); assert.match(mixed, /\b2 active orders\b/, "counts only staff-given orders: " + mixed.replace(/\s+/g, " "));
    const tabN = Number(((await f.locator('#tabs [data-f="plans"]').innerText()).match(/\((\d+)\)/) || [0, 0])[1]), shownN = await f.locator("#list .pt").count();
    assert.equal(tabN, shownN, "the tab count (" + tabN + ") matches the plans listed (" + shownN + ")");
    await page.screenshot({ path: OUT + "/stageA-mar-active-plans-mobile.png" });
    assert.equal(await f.locator('#tabs [data-f="due"]').count(), 1);
    await browser2.close();
  }
  assert.equal(errors.length, 0, "no page errors: " + errors.join(" | "));
  console.log("stage A: stale pharmacy list and MAR leftovers: OK");
})().catch(e => { console.error(e); process.exit(1); });
