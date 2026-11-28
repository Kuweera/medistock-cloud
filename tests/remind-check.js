/* Developer 4, Stage 4: treatment alerts page and the device scheduling in mc-notify.js, in Chromium (phone and desktop sizes).
   IN-MEMORY Firestore stand-in and a FAKE Android notification plugin: NOT real Firebase, NO security rules, NOT a real Android device, NOT app-closed behaviour.
   TEST values only, invented. Run: python3 -m http.server 8765 (repo root), then node tests/remind-check.js [outdir] */
const { chromium } = require("playwright"), assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", B = "biz1", F = "shop1", M = 60000, TZ = "Africa/Kampala";
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const H = (as, extra) => "http://localhost:8765/tests/remind-harness.html?as=" + as + (extra || "");
(async () => {
  const browser = await chromium.launch(), errors = [];
  const open = async (vp, as, extra) => { const ctx = await browser.newContext({ viewport: vp }), page = await ctx.newPage(); page.on("pageerror", e => errors.push(as + ": " + String(e))); page.on("dialog", d => d.accept());
    await page.goto(H(as, extra)); const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]), wait = (ms = 300) => page.waitForTimeout(ms); return { page, db, wait, ctx }; };
  const seed = async (db, now) => {
    const O = (id, o) => db("add", "pc_treatment_orders", id, Object.assign({ businessId: B, facilityId: F, status: "active", kind: "medicine", administrationMode: "inpatient_mar", prescriberId: "doc1" }, o));
    const E = (id, o) => db("add", "pc_treatment_events", id, Object.assign({ businessId: B, facilityId: F, orderId: "o1", patientId: "p1", patientName: "TEST Alpha", label: "TEST med one", kind: "medicine", status: "pending", plannedAt: now, plannedDay: dayOf(now) }, o, { plannedDay: dayOf(o.plannedAt || now) }));
    await O("o1"); await O("o2", { administrationMode: "take_home" }); await O("o3", { status: "stopped" }); await O("o4", { administrationMode: "" }); await O("o5", { administrationMode: "facility_administered" });
    await E("eDue", { plannedAt: now + 10 * M }); await E("eOver", { plannedAt: now - 45 * M, patientName: "TEST Bravo", patientId: "p2", label: "TEST med two" }); await E("eFut", { plannedAt: now + 300 * M, patientName: "TEST Future" });
    await E("eTake", { orderId: "o2", plannedAt: now - 45 * M, patientName: "TEST Takehome" }); await E("eStop", { orderId: "o3", plannedAt: now - 45 * M, patientName: "TEST Stopped" }); await E("eHeld", { status: "held", plannedAt: now - 45 * M, patientName: "TEST Held" });
    await E("eDone", { status: "administered", plannedAt: now - 45 * M, patientName: "TEST Done" }); await E("eNoMode", { orderId: "o4", plannedAt: now - 50 * M, patientName: "TEST Oldorder" });
    await E("eDna", { orderId: "o5", status: "missed", attendance: "did_not_attend", plannedAt: now - 1440 * M, patientName: "TEST Dna", patientId: "p9", attendanceByName: "Nurse X" });
  };
  const text = async (f) => f.locator("#alertsList").innerText();

  for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
    // ------------------------------------------------------------------ the page, as a nurse
    let { page, db, wait } = await open(vp, "nurse"); let f = page.frameLocator("#f"); await f.locator("#tAlerts").waitFor(); const now = Date.now(); await seed(db, now); await wait(600);
    let t = await text(f);
    assert.match(t, /TEST Alpha/); assert.match(t, /Due at \d\d:\d\d \(in 10 min\)\. Not recorded yet\./); assert.match(t, /TEST Bravo/); assert.match(t, /Overdue: planned for \d\d:\d\d \(45 min ago\)\. Not recorded\./); assert.match(t, /TEST Oldorder/);
    ["TEST Takehome", "TEST Stopped", "TEST Held", "TEST Done", "TEST Future", "TEST Dna"].forEach(n => assert.doesNotMatch(t, new RegExp(n), n + " must not be listed"));
    assert.ok(t.indexOf("TEST Bravo") < t.indexOf("TEST Alpha"), "overdue before due"); assert.match(await f.locator("#tAlerts").innerText(), /Needs attention \(3\)/); assert.equal(await f.locator("#tSet").isVisible(), false, "a nurse has no timings tab");
    assert.match(await f.locator("#devBody").innerText(), /on this device/); assert.match(await f.locator("#devBody").innerText(), /time zone \(Africa\/Kampala\)/); assert.doesNotMatch(await f.locator("body").innerText(), /\bphone\b|delivered/i, "wording: device, never phone or delivered");
    // acknowledge: records "seen" only; the dose and the event are untouched; nothing is removed
    await f.locator('[data-ack="eOver_dose_overdue"]').click(); assert.match(await f.locator("#ackSummary").innerText(), /TEST Bravo/); await f.locator("#ackNote").fill("on my way"); await f.locator("#ackGo").click(); await wait(500);
    const ack = await db("get", "pc_reminder_acks", "rack_eOver_dose_overdue"); assert.equal(ack.eventId, "eOver"); assert.equal(ack.orderId, "o1"); assert.equal(ack.patientId, "p2"); assert.equal(ack.level, "dose_overdue"); assert.equal(ack.ackBy, "nurse1"); assert.equal(ack.ackByName, "Nurse T"); assert.equal(ack.note, "on my way");
    assert.equal(ack.businessId, B); assert.equal(ack.facilityId, F); assert.equal(ack.createdBy, "nurse1"); assert.equal(ack.schemaVersion, 1); assert.equal(Object.values(ack).includes(null), false); assert.deepEqual(Object.keys(ack).sort(), ["ackBy", "ackByName", "businessId", "clientCreatedAt", "createdAt", "createdBy", "eventId", "facilityId", "level", "note", "orderId", "patientId", "schemaVersion"]);
    assert.equal((await db("get", "pc_treatment_events", "eOver")).status, "pending", "an acknowledgement records no dose"); assert.equal((await db("all", "pc_audit_logs")).filter(x => x.action === "reminder.ack" && x.eventId === "eOver").length, 1);
    t = await text(f); assert.match(t, /Acknowledged by Nurse T/); assert.match(t, /on my way/); assert.match(t, /TEST Bravo/); assert.equal(await f.locator('[data-ack="eOver_dose_overdue"]').count(), 0, "no second acknowledge button");
    await f.locator('[data-ack="eDue_dose_due"]').click(); await f.locator("#ackGo").click(); await wait(400); assert.equal(await db("get", "pc_reminder_acks", "rack_eDue_dose_due").then(x => !!x), true); assert.equal("note" in (await db("get", "pc_reminder_acks", "rack_eDue_dose_due")), false, "no empty note is written");
    // a second acknowledgement of the same event and level is refused by the (stand-in) rules and reported plainly
    await db("remove", "pc_reminder_acks", "rack_eDue_dose_due"); await f.locator('[data-ack="eOver_dose_overdue"]').count();
    // the dose is recorded elsewhere: it leaves the list; an order is stopped: it leaves the list
    await db("add", "pc_treatment_events", "eDue", Object.assign(await db("get", "pc_treatment_events", "eDue"), { status: "administered" })); await wait(400); assert.doesNotMatch(await text(f), /TEST Alpha/);
    await db("add", "pc_treatment_orders", "o1", Object.assign(await db("get", "pc_treatment_orders", "o1"), { status: "stopped" })); await wait(400); assert.doesNotMatch(await text(f), /TEST Bravo/); await db("add", "pc_treatment_orders", "o1", Object.assign(await db("get", "pc_treatment_orders", "o1"), { status: "active" })); await wait(300);
    await f.locator("#tDna").click(); const dna = await f.locator("#dnaList").innerText(); assert.match(dna, /TEST Dna/); assert.match(dna, /recorded by Nurse X/); assert.doesNotMatch(dna, /TEST Alpha|TEST Bravo/);
    await f.locator('[data-patient="p9"]').click(); assert.equal(await page.evaluate(() => window.__went), "patient.html?id=p9");
    const over = await f.locator("body").evaluate(b => b.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1, name + ": sideways scroll " + over + "px"); await f.locator("#tAlerts").click(); await page.screenshot({ path: OUT + "/remind-" + name + ".png" });
    await page.context().close();

    // ------------------------------------------------------------------ prescriber, owner, clerk, manager
    ({ page, db, wait } = await open(vp, "doc")); f = page.frameLocator("#f"); await f.locator("#tAlerts").waitFor(); await seed(db, now); await db("add", "pc_reminder_settings", F, { businessId: B, facilityId: F, graceMin: 30, soonMin: 30, escalateAfterMin: 60, appointmentAdvanceMin: 0 }); await db("add", "pc_treatment_events", "eEsc", { businessId: B, facilityId: F, orderId: "o1", patientId: "p4", patientName: "TEST Escalate", label: "TEST med four", kind: "medicine", status: "pending", plannedAt: now - 70 * M, plannedDay: dayOf(now - 70 * M) }); await db("add", "pc_treatment_events", "eMiss", { businessId: B, facilityId: F, orderId: "o1", patientId: "p3", patientName: "TEST Missed", label: "TEST med three", kind: "medicine", status: "missed", plannedAt: now - 200 * M, plannedDay: dayOf(now - 200 * M) }); await wait(600);
    t = await text(f); assert.match(t, /TEST Escalate/); assert.match(t, /Escalated: still not recorded/); assert.doesNotMatch(t, /TEST Bravo/, "45 minutes is overdue, not yet escalated at 60"); assert.match(t, /TEST Missed/); assert.match(t, /Staff recorded this as missed/); assert.match(t, /Recorded as did not attend/); assert.doesNotMatch(t, /TEST Alpha/, "a prescriber does not get dose-due alerts"); assert.doesNotMatch(t, /TEST Oldorder/, "an escalation only for doses past the escalation time"); assert.equal(await f.locator('[data-ack="eMiss_missed_recorded"]').count(), 1);
    await page.context().close();
    ({ page, db, wait } = await open(vp, "owner")); f = page.frameLocator("#f"); await f.locator("#tAlerts").waitFor(); await seed(db, now); await wait(600);
    assert.match(await text(f), /Nothing needs attention/); assert.equal(await f.locator("#ownerBox").isVisible(), true); await f.locator("#ownerOn").check(); await wait(500); assert.match(await text(f), /TEST Bravo/); assert.equal(await page.evaluate(() => localStorage.getItem("mcOwnerTreatmentAlerts:owner1")), "1"); await f.locator("#ownerOn").uncheck(); await wait(400); assert.match(await text(f), /Nothing needs attention/);
    assert.equal(await f.locator("#tSet").isVisible(), true); await page.context().close();
    ({ page, db, wait } = await open(vp, "clerk")); f = page.frameLocator("#f"); await f.locator("#gateMsg").waitFor(); assert.match(await f.locator("#gateMsg").innerText(), /do not have access to treatment alerts/); await page.context().close();

    // ------------------------------------------------------------------ the timings (settings.manage)
    ({ page, db, wait } = await open(vp, "boss", "&tz=none")); f = page.frameLocator("#f"); await f.locator("#tSet").waitFor(); await f.locator("#tSet").click(); await wait(400);
    assert.equal(await f.locator("#sGrace").inputValue(), "30"); assert.equal(await f.locator("#sEsc").inputValue(), "0"); assert.match(await f.locator("#tzNote").innerText(), /no time zone set, so Africa\/Kampala/); assert.match(await f.locator("#sInfo").innerText(), /No timings saved yet/);
    await f.locator("#sGrace").fill("45"); await f.locator("#sEsc").fill("45"); await f.locator("#sSave").click(); await wait(200); assert.match(await f.locator("#sMsg").innerText(), /later than the overdue time/); assert.equal(await db("get", "pc_reminder_settings", F), null, "nothing written when invalid");
    await f.locator("#sGrace").fill("4"); await f.locator("#sEsc").fill("0"); await f.locator("#sSave").click(); await wait(200); assert.match(await f.locator("#sMsg").innerText(), /whole number from 5 to 240/);
    await f.locator("#sGrace").fill("45"); await f.locator("#sEsc").fill("90"); await f.locator("#sAdv").fill("20"); await f.locator("#sSave").click(); await wait(400);
    let s1 = await db("get", "pc_reminder_settings", F); assert.deepEqual([s1.graceMin, s1.soonMin, s1.escalateAfterMin, s1.appointmentAdvanceMin], [45, 30, 90, 20]); assert.equal(s1.facilityId, F); assert.equal(s1.businessId, B); assert.equal(s1.createdBy, "boss1"); assert.equal(s1.schemaVersion, 1);
    assert.equal((await db("all", "pc_audit_logs")).filter(x => x.action === "reminder.settings").length, 1);
    await f.locator("#sSoon").fill("15"); await f.locator("#sSave").click(); await wait(400); const s2 = await db("get", "pc_reminder_settings", F); assert.equal(s2.soonMin, 15); assert.equal(s2.createdBy, "boss1", "an update never changes the creator"); assert.equal(s2.updatedBy, "boss1"); assert.equal(s2.createdAt, s1.createdAt);
    assert.equal((await db("all", "pc_audit_logs")).filter(x => x.action === "reminder.settings").length, 2); assert.match(await f.locator("#sInfo").innerText(), /still shows "Late" after 30 minutes/);
    await page.context().close();
    console.log(name + " page: ok");
  }

  // ---------------------------------------------------------------------- the device scheduling (mc-notify.js) with a fake notification plugin
  const pend = (page) => page.evaluate(() => Array.from(window.__LN.pending.values()).map(n => ({ id: n.id, title: n.title, body: n.body, at: +new Date(n.schedule.at), target: n.extra && n.extra.target })));
  const shown = (page) => page.evaluate(() => window.__LN.shown.map(n => ({ title: n.title, body: n.body })));
  { // nurse
    const { page, db, wait } = await open({ width: 390, height: 844 }, "nurse", "&page=none"); const now = Date.now(); await seed(db, now);
    await page.evaluate(() => window.MCNotify.start()); await wait(300); await page.evaluate(() => window.MCNotify.rescan()); await wait(500); await page.evaluate(() => window.MCNotify.rescan()); await wait(300);
    let p = await pend(page), sh = await shown(page); const titles = p.map(x => x.title).sort();
    assert.ok(titles.includes("Treatment due") && titles.includes("Treatment overdue"), "future doses are scheduled: " + JSON.stringify(titles)); assert.equal(titles.every(x => /^Treatment (due|overdue)$/.test(x)), true, "a nurse gets no escalation: " + JSON.stringify(titles));
    assert.ok(p.every(x => x.target === "treatment-alerts.html" && x.at > now)); const all = JSON.stringify([p, sh]); assert.equal(/TEST (Alpha|Bravo|Future|Oldorder|Takehome|Stopped|Held|Done)|TEST med/.test(all), false, "no patient or medicine name in any notification");
    assert.equal(/phone|delivered/i.test(all), false); assert.deepEqual(sh.map(x => x.title).sort(), ["Treatment due", "Treatment overdue"], "what is active now and was never notified: shown once per level");
    const n1 = sh.length, ids = p.map(x => x.id).sort(); await page.evaluate(() => window.MCNotify.rescan()); await wait(300); await page.evaluate(() => window.MCNotify.rescan()); await wait(300);
    assert.equal((await shown(page)).length, n1, "no repeat of an alert already shown on this device"); assert.deepEqual((await pend(page)).map(x => x.id).sort(), ids, "rescheduling the same state gives the same set (no duplicates)");
    // acknowledged and recorded doses leave the schedule; the take-home, stopped and held ones were never in it
    const before = (await pend(page)).length; await db("add", "pc_treatment_events", "eFut", Object.assign(await db("get", "pc_treatment_events", "eFut"), { status: "administered" })); await db("add", "pc_treatment_events", "eDue", Object.assign(await db("get", "pc_treatment_events", "eDue"), { status: "cancelled" })); await wait(300); await page.evaluate(() => window.MCNotify.rescan()); await wait(300);
    assert.ok((await pend(page)).length < before, "recorded or cancelled doses are removed from the schedule"); const left = await pend(page); assert.equal(left.length, 0, "nothing left to schedule: " + JSON.stringify(left.map(x => x.title)));
    const st = await page.evaluate(() => window.MCNotify.treatmentStatus()); assert.equal(st.native, true); assert.equal(st.permission, "granted"); assert.equal(st.attached, true); assert.equal(st.scheduled, 0); assert.equal(st.facility, "Test Clinic");
    await page.context().close();
  }
  { // cap: 100 future doses become at most 40 notifications, the last one a summary
    const { page, db, wait } = await open({ width: 390, height: 844 }, "nurse", "&page=none"); const now = Date.now();
    await db("add", "pc_treatment_orders", "o1", { businessId: B, facilityId: F, status: "active", kind: "medicine", administrationMode: "inpatient_mar", prescriberId: "doc1" });
    for (let i = 0; i < 100; i++) await db("add", "pc_treatment_events", "ex" + i, { businessId: B, facilityId: F, orderId: "o1", patientId: "p1", patientName: "TEST Many", label: "TEST", kind: "medicine", status: "pending", plannedAt: now + (120 + i * 7) * M, plannedDay: dayOf(now + (120 + i * 7) * M) });
    await page.evaluate(() => window.MCNotify.start()); await wait(300); await page.evaluate(() => window.MCNotify.rescan()); await wait(600); await page.evaluate(() => window.MCNotify.rescan()); await wait(300);
    const p = await pend(page); assert.ok(p.length <= 40 && p.length >= 39, "at most 40: " + p.length); assert.equal(p.filter(x => x.title === "More treatment alerts").length, 1); assert.match(p.find(x => x.title === "More treatment alerts").body, /scheduled on this device for later/);
    await page.context().close();
  }
  { // treatment has priority up to 40 of the 60 notifications; the other alerts (here: expiring batches) keep the rest
    const { page, db, wait } = await open({ width: 390, height: 844 }, "nurse", "&page=none&batches=40"); const now = Date.now();
    await db("add", "pc_treatment_orders", "o1", { businessId: B, facilityId: F, status: "active", kind: "medicine", administrationMode: "inpatient_mar", prescriberId: "doc1" });
    for (let i = 0; i < 100; i++) await db("add", "pc_treatment_events", "ex" + i, { businessId: B, facilityId: F, orderId: "o1", patientId: "p1", patientName: "TEST Many", label: "TEST", kind: "medicine", status: "pending", plannedAt: now + (120 + i * 7) * M, plannedDay: dayOf(now + (120 + i * 7) * M) });
    await page.evaluate(() => window.MCNotify.start()); await wait(300); await page.evaluate(() => window.MCNotify.rescan()); await wait(600); await page.evaluate(() => window.MCNotify.rescan()); await wait(300);
    const p = await pend(page), tr = p.filter(x => x.target === "treatment-alerts.html"), other = p.length - tr.length;
    assert.ok(p.length <= 60, "at most 60 in all: " + p.length); assert.ok(tr.length >= 39 && tr.length <= 40, "treatment: " + tr.length); assert.ok(other >= 20, "the other alerts keep at least 20: " + other);
    await page.context().close();
  }
  { // who gets a device alert: the owner only when switched on; the prescriber only for escalation; permission off means nothing is scheduled and the page can say so
    const mk = async (as, extra, pre) => { const r = await open({ width: 390, height: 844 }, as, "&page=none" + (extra || "")); const now = Date.now(); if (pre) await pre(r.page); await seed(r.db, now); await r.db("add", "pc_reminder_settings", F, { businessId: B, facilityId: F, graceMin: 30, soonMin: 30, escalateAfterMin: 60, appointmentAdvanceMin: 0 }); await r.db("add", "pc_treatment_events", "eFut2", { businessId: B, facilityId: F, orderId: "o1", patientId: "p1", patientName: "TEST F2", label: "x", kind: "medicine", status: "pending", plannedAt: now + 100 * M, plannedDay: dayOf(now + 100 * M) });
      await r.page.evaluate(() => window.MCNotify.start()); await r.wait(300); await r.page.evaluate(() => window.MCNotify.rescan()); await r.wait(500); await r.page.evaluate(() => window.MCNotify.rescan()); await r.wait(300); return r; };
    let r = await mk("owner"); assert.equal((await pend(r.page)).length, 0); assert.equal((await shown(r.page)).length, 0); await r.page.evaluate(() => window.MCNotify.setOwnerTreatmentAlerts(true)); await r.wait(300); await r.page.evaluate(() => window.MCNotify.rescan()); await r.wait(300); assert.ok((await pend(r.page)).length >= 1, "switched on for this device"); await r.page.context().close();
    r = await mk("doc"); const dp = await pend(r.page); assert.ok(dp.length >= 1 && dp.every(x => x.title === "Treatment escalated"), JSON.stringify(dp.map(x => x.title))); assert.equal((await shown(r.page)).filter(x => x.title !== "Treatment escalated").length, 0); await r.page.context().close();
    r = await mk("clerk"); assert.equal((await pend(r.page)).length, 0); assert.equal((await r.page.evaluate(() => window.MCNotify.treatmentStatus())).attached, false); await r.page.context().close();
    r = await mk("nurse", "&perm=denied"); assert.equal((await pend(r.page)).length, 0); const sd = await r.page.evaluate(() => window.MCNotify.treatmentStatus()); assert.equal(sd.permission, "denied"); await r.page.context().close();
    r = await mk("nurse", "&native=no"); assert.equal((await pend(r.page)).length, 0, "a browser schedules nothing"); await r.page.context().close();
  }
  console.log("device scheduling: ok");
  await browser.close(); assert.deepEqual(errors, []); console.log("page errors: none");
})().catch(e => { console.error(e); process.exit(1); });
