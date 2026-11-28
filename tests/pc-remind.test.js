/* Developer 4, Stage 4: pc-remind.js (reminder engine, contract section 19). In memory, no Firebase. Every name, drug and time is invented test data. */
const test = require("node:test"), assert = require("node:assert/strict");
const R = require("../pc-remind.js"), PCS = require("../pc-sched.js");
const M = 60000, P = Date.UTC(2026, 10, 28, 10, 0);   // 13:00 in Africa/Kampala
const O = (o) => Object.assign({ id: "o1", status: "active", kind: "medicine", administrationMode: "inpatient_mar", prescriberId: "doc1" }, o);
const E = (o) => Object.assign({ id: "e1", orderId: "o1", patientId: "p1", patientName: "TEST Patient Zed", label: "TEST medicine X", kind: "medicine", status: "pending", plannedAt: P, plannedDay: "2026-11-28" }, o);
const NURSE = { uid: "n1", role: "nurse", perms: { "treatment.administer": true } }, DOC = { uid: "doc1", role: "clinician", perms: { "treatment.prescribe": true } }, OWNER = { uid: "own", role: "owner", perms: {} }, NOBODY = { uid: "x1", role: "clerk", perms: {} };
const S = (o) => o;
const lv = (now, o) => R.derive(Object.assign({ events: [E()], orders: [O()], settings: {}, acks: [], now, tz: "Africa/Kampala" }, o)).map(a => a.level);

test("settings: absent or invalid values fall back to the same 30 and 30 minutes as the treatment screen; bounds are those of the rules", () => {
  assert.deepEqual(R.settingsOf(null), { fromDoc: false, graceMin: 30, soonMin: 30, escalateAfterMin: 0, appointmentAdvanceMin: 0 });
  assert.deepEqual(R.settingsOf({ graceMin: 45, soonMin: 4, escalateAfterMin: 90.5, appointmentAdvanceMin: "20" }), { fromDoc: true, graceMin: 45, soonMin: 30, escalateAfterMin: 0, appointmentAdvanceMin: 0 });
  assert.equal(R.settingsOf({ graceMin: 240 }).graceMin, 240); assert.equal(R.settingsOf({ graceMin: 241 }).graceMin, 30); assert.equal(R.settingsOf({ escalateAfterMin: 720 }).escalateAfterMin, 720); assert.equal(R.settingsOf({ appointmentAdvanceMin: 1440 }).appointmentAdvanceMin, 1440); assert.equal(R.settingsOf({ appointmentAdvanceMin: 1441 }).appointmentAdvanceMin, 0);
});
test("settings screen checks: whole numbers in bounds; escalation only after the overdue time", () => {
  const ok = (f) => R.settingsErrors(f).join(" | ");
  assert.equal(ok({ graceMin: "30", soonMin: "30", escalateAfterMin: "0", appointmentAdvanceMin: "0" }), ""); assert.equal(ok({}), "", "blank = the defaults"); assert.equal(ok({ graceMin: 45, escalateAfterMin: 60 }), "");
  assert.match(ok({ graceMin: "4" }), /overdue/); assert.match(ok({ soonMin: "241" }), /due/); assert.match(ok({ graceMin: "1,5" }), /whole number/); assert.match(ok({ graceMin: "30.5" }), /whole number/); assert.match(ok({ appointmentAdvanceMin: "-1" }), /warning/); assert.match(ok({ escalateAfterMin: "721" }), /escalating/);
  assert.match(ok({ graceMin: 30, escalateAfterMin: 30 }), /later than the overdue time/); assert.match(ok({ graceMin: 60, escalateAfterMin: 45 }), /later than the overdue time/);
  assert.deepEqual(R.settingsFields({ graceMin: "45", soonMin: "", escalateAfterMin: "90" }), { graceMin: 45, soonMin: 30, escalateAfterMin: 90, appointmentAdvanceMin: 0 });
});
test("a dose: due from 30 minutes before, overdue after the grace time, escalated only when configured, none outside", () => {
  assert.deepEqual(lv(P - 31 * M), []); assert.deepEqual(lv(P - 30 * M), ["dose_due"]); assert.deepEqual(lv(P), ["dose_due"]); assert.deepEqual(lv(P + 29 * M), ["dose_due"]);
  assert.deepEqual(lv(P + 30 * M), ["dose_overdue"], "overdue replaces due at the grace time"); assert.deepEqual(lv(P + 600 * M), ["dose_overdue"]);
  const esc = { settings: { escalateAfterMin: 60 } }; assert.deepEqual(lv(P + 59 * M, esc), ["dose_overdue"]); assert.deepEqual(lv(P + 60 * M, esc), ["dose_escalated", "dose_overdue"], "escalation shows beside overdue, most urgent first");
  assert.deepEqual(lv(P - 10 * M, { settings: { soonMin: 5, graceMin: 10 } }), [], "the facility's own timings"); assert.deepEqual(lv(P - 5 * M, { settings: { soonMin: 5, graceMin: 10 } }), ["dose_due"]); assert.deepEqual(lv(P + 10 * M, { settings: { soonMin: 5, graceMin: 10 } }), ["dose_overdue"]);
});
test("an appointment: soon only when set, overdue when nobody has arrived, nothing once arrival is recorded", () => {
  const o = [O({ administrationMode: "facility_administered" })], ap = (x) => lv(x.now, { orders: o, events: [E(x.e || {})], settings: x.s || {} });
  assert.deepEqual(ap({ now: P - 60 * M }), [], "no advance warning unless configured"); assert.deepEqual(ap({ now: P - 60 * M, s: { appointmentAdvanceMin: 60 } }), ["appointment_soon"]); assert.deepEqual(ap({ now: P - 61 * M, s: { appointmentAdvanceMin: 60 } }), []);
  assert.deepEqual(ap({ now: P + 10 * M, s: { appointmentAdvanceMin: 60 } }), ["appointment_soon"], "stays until it is overdue"); assert.deepEqual(ap({ now: P + 30 * M }), ["appointment_overdue"]);
  assert.deepEqual(ap({ now: P + 90 * M, e: { attendance: "attended" } }), [], "arrival recorded: no appointment alert"); assert.deepEqual(ap({ now: P + 90 * M, e: { attendance: "did_not_attend", status: "pending" } }), []);
  assert.deepEqual(lv(P + 90 * M, { orders: o }).includes("dose_overdue"), false, "an appointment never becomes a dose alert");
});
test("stop rules: nothing for take-home, held, done, cancelled, stopped or completed, other kinds, or an unknown order", () => {
  const t = P + 90 * M, none = (o) => assert.deepEqual(lv(t, o), []);
  none({ orders: [O({ administrationMode: "take_home" })] }); ["held", "administered", "refused", "not_given", "cancelled"].forEach(st => none({ events: [E({ status: st })] }));
  ["stopped", "completed", "cancelled"].forEach(st => none({ orders: [O({ status: st })] })); none({ orders: [] }); none({ orders: [O({ id: "other" })] }); none({ orders: [O({ kind: "consumable" })] }); none({ events: [E({ plannedAt: "soon" })] }); none({ events: [E({ plannedAt: undefined })] });
  assert.deepEqual(lv(t, {}), ["dose_overdue"], "control: the same case with nothing stopped alerts");
});
test("acknowledgement marks an alert (who and when) and never removes it or the escalation", () => {
  const acks = [{ id: "rack_e1_dose_overdue", ackBy: "n1", ackByName: "Nurse T", createdAt: 123, note: "on my way" }], out = R.derive({ events: [E()], orders: [O()], settings: { escalateAfterMin: 60 }, acks: acks, now: P + 70 * M, tz: "Africa/Kampala" });
  assert.deepEqual(out.map(a => [a.level, !!a.ack]), [["dose_escalated", false], ["dose_overdue", true]]); assert.deepEqual(out[1].ack, { by: "n1", byName: "Nurse T", at: 123, note: "on my way" }); assert.equal(out[1].ackId, "rack_e1_dose_overdue");
  assert.equal(R.derive({ events: [E()], orders: [O()], settings: {}, acks: [{ id: "rack_e2_dose_overdue", ackBy: "n1", clientCreatedAt: 5 }], now: P + 70 * M }).every(a => a.ack === null), true, "another event's acknowledgement does not count");
});
test("recorded missed and did-not-attend: derived only from what staff recorded, for orders still active; an unrecorded dose is never 'missed'", () => {
  const t = P + 90 * M, d = (e, o) => R.derive({ events: [e], orders: o || [O()], settings: {}, acks: [], now: t }).map(a => a.level);
  assert.deepEqual(d(E({ status: "missed" })), ["missed_recorded"]); assert.deepEqual(d(E({ status: "missed", attendance: "did_not_attend" })), ["did_not_attend"]); assert.deepEqual(d(E({ status: "missed" }), []), []); assert.deepEqual(d(E({ status: "missed" }), [O({ administrationMode: "take_home" })]), []);
  assert.equal(lv(P + 9999 * M).includes("missed_recorded"), false, "never inferred from time");
});
test("who receives what: administer holders get dose alerts; the owner only when switched on for the device; escalation goes to the prescriber; recorded outcomes only to the prescriber and never by push", () => {
  const al = (level, o) => Object.assign(R.derive({ events: [E()], orders: [O()], settings: { escalateAfterMin: 60 }, acks: [], now: P + 70 * M }).find(a => a.level === level), o || {});
  const sc = (a, u) => R.scopeFor(a, u), overdue = al("dose_overdue"), esc = al("dose_escalated");
  assert.deepEqual(sc(overdue, NURSE), { inApp: true, push: true, as: "administer" }); assert.deepEqual(sc(overdue, NOBODY), { inApp: false, push: false, as: "" }); assert.deepEqual(sc(overdue, DOC), { inApp: false, push: false, as: "" }, "a prescriber is not an administrator");
  assert.equal(sc(overdue, OWNER).inApp, false); assert.deepEqual(sc(overdue, Object.assign({}, OWNER, { ownerAlertsOn: true })), { inApp: true, push: true, as: "administer" });
  assert.deepEqual(sc(esc, DOC), { inApp: true, push: true, as: "prescriber" }); assert.deepEqual(sc(esc, NURSE), { inApp: true, push: false, as: "administer" }, "shown to administrators, no push"); assert.deepEqual(sc(esc, NOBODY), { inApp: false, push: false, as: "" });
  assert.deepEqual(sc(esc, { uid: "doc2", role: "clinician", perms: { "treatment.prescribe": true } }), { inApp: false, push: false, as: "" }, "another doctor is not the prescriber");
  const miss = R.derive({ events: [E({ status: "missed" })], orders: [O()], settings: {}, acks: [], now: P + 90 * M })[0]; assert.deepEqual(sc(miss, DOC), { inApp: true, push: false, as: "prescriber" }); assert.deepEqual(sc(miss, NURSE), { inApp: false, push: false, as: "" });
  assert.equal(sc(Object.assign({}, overdue, { ack: { by: "n1" } }), NURSE).push, false, "acknowledged: no further push, still listed"); assert.equal(sc(Object.assign({}, overdue, { ack: { by: "n1" } }), NURSE).inApp, true);
  const nomode = R.derive({ events: [E()], orders: [O({ administrationMode: "" })], settings: {}, acks: [], now: P + 90 * M })[0]; assert.equal(nomode.level, "dose_overdue"); assert.deepEqual(sc(nomode, NURSE), { inApp: true, push: false, as: "administer" }, "an old order with no mode: in the list only, no push");
  assert.deepEqual(R.visible([overdue, esc], NURSE).map(a => a.scope.as), ["administer", "administer"]); assert.equal(R.visible([overdue], null).length, 0);
});
test("the staff follow-up list: only recorded did-not-attend, newest first, no contact details", () => {
  const evs = [E({ id: "a", status: "missed", attendance: "did_not_attend", plannedAt: P }), E({ id: "b", status: "missed", attendance: "did_not_attend", plannedAt: P + 1000 * M, patientName: "TEST Two" }), E({ id: "c", status: "missed" }), E({ id: "d", attendance: "attended" }), E({ id: "e", status: "pending", attendance: "did_not_attend" })];
  const l = R.didNotAttend(evs, "Africa/Kampala"); assert.deepEqual(l.map(x => x.eventId), ["b", "a"]); assert.equal(l[1].plannedText, "13:00"); assert.deepEqual(Object.keys(l[0]).sort(), ["at", "byName", "eventId", "orderId", "patientId", "patientName", "plannedAt", "plannedDay", "plannedText", "what"]);
});
const plan = (o) => R.plan(Object.assign({ events: [E()], orders: [O()], settings: {}, acks: [], now: P - 120 * M, tz: "Africa/Kampala", user: NURSE }, o));
test("plan: future triggers are scheduled once each at the exact time; texts carry counts and times only", () => {
  const p = plan({ settings: { escalateAfterMin: 60 } }); assert.deepEqual(p.schedule.map(g => [g.level, g.at]), [["dose_due", P - 30 * M], ["dose_overdue", P + 30 * M]], "escalation is for the prescriber, not this nurse");
  assert.deepEqual(p.showNow, []); assert.equal(p.schedule[0].title, "Treatment due"); assert.match(p.schedule[0].body, /1 scheduled item is due around 13:00/); assert.match(p.schedule[1].body, /1 item is not recorded after the planned time \(13:00\)/);
  const doc = plan({ settings: { escalateAfterMin: 60 }, user: DOC }); assert.deepEqual(doc.schedule.map(g => g.level), ["dose_escalated"]); assert.match(doc.schedule[0].body, /you ordered is still not recorded/);
  const all = JSON.stringify([p, doc]); assert.equal(/Zed|TEST medicine|TEST Patient/.test(all), false, "no patient or medicine name in any notification");
  assert.deepEqual(plan({ user: NOBODY }).schedule, []); assert.deepEqual(plan({ user: OWNER }).schedule, []); assert.equal(plan({ user: Object.assign({}, OWNER, { ownerAlertsOn: true }) }).schedule.length, 2);
});
test("plan: same-minute items of one level are grouped; a group is a count, not a list of people", () => {
  const evs = [E({ id: "e1" }), E({ id: "e2", patientName: "TEST Other" }), E({ id: "e3", plannedAt: P + 60 * M })], p = plan({ events: evs });
  assert.deepEqual(p.schedule.map(g => [g.level, g.count]), [["dose_due", 2], ["dose_due", 1], ["dose_overdue", 2], ["dose_overdue", 1]]); assert.match(p.schedule[0].body, /2 scheduled items are due/);
  assert.equal(new Set(p.scheduledKeys).size, p.scheduledKeys.length, "each item is in exactly one notification");
});
test("plan: levels already active are shown once; a key that was notified or scheduled before is not repeated (no duplicates)", () => {
  const now = P + 40 * M, p1 = plan({ now }); assert.deepEqual(p1.showNow.map(n => [n.level, n.count]), [["dose_overdue", 1]]); assert.deepEqual(p1.schedule, []);
  const key = "e1|dose_overdue|" + P;
  assert.deepEqual(plan({ now, notified: new Set([key]) }).showNow, [], "already notified on this device"); assert.deepEqual(plan({ now, scheduledPrev: new Set([key]) }).showNow, [], "it was scheduled before and its time has passed: counted as fired");
  assert.deepEqual(plan({ now }), plan({ now }), "the same state gives the same plan"); assert.deepEqual(plan({ now: P - 120 * M }), plan({ now: P - 120 * M }));
  assert.deepEqual(plan({ now }).activeKeys, [key]);
  const moved = plan({ now, events: [E({ plannedAt: P + 600 * M })] }); assert.deepEqual(moved.showNow, [], "a dose moved to later is not alerted now"); assert.equal(moved.schedule.length > 0, true);
});
test("plan: acknowledged levels, recorded doses, stopped orders and every stop rule leave nothing scheduled", () => {
  const acks = [{ id: "rack_e1_dose_due", ackBy: "n1" }, { id: "rack_e1_dose_overdue", ackBy: "n1" }]; assert.deepEqual(plan({ acks }).schedule, []);
  assert.equal(plan({ acks: [{ id: "rack_e1_dose_due" }] }).schedule.length, 1, "only the acknowledged level is dropped");
  [[{ events: [E({ status: "administered" })] }], [{ events: [E({ status: "held" })] }], [{ orders: [O({ status: "stopped" })] }], [{ orders: [O({ administrationMode: "take_home" })] }], [{ orders: [O({ administrationMode: "" })] }], [{ orders: [] }]].forEach(([o], i) => assert.deepEqual(plan(o).schedule, [], "case " + i));
  const fac = plan({ orders: [O({ administrationMode: "facility_administered" })], settings: { appointmentAdvanceMin: 60 } }); assert.deepEqual(fac.schedule.map(g => g.level), ["appointment_soon", "appointment_overdue"]); assert.equal(plan({ orders: [O({ administrationMode: "facility_administered" })], events: [E({ attendance: "attended" })] }).schedule.length, 0);
});
test("plan: at most 40 notifications; the rest become one digest at the time of the first dropped one", () => {
  const evs = []; for (let i = 0; i < 100; i++) evs.push(E({ id: "e" + i, plannedAt: P + i * 7 * M })); const p = plan({ events: evs, now: P - 600 * M });
  assert.equal(p.schedule.length, 40); const dig = p.schedule[39]; assert.equal(dig.key, "tr|digest"); assert.equal(dig.level, "digest"); assert.ok(p.schedule.slice(0, 39).every(g => g.key !== "tr|digest")); assert.equal(dig.at, p.schedule.slice(0, 39).reduce((m, g) => Math.max(m, g.at), 0) < dig.at ? dig.at : -1);
  assert.equal(p.overflow, dig.count); assert.match(dig.body, /scheduled on this device for later/); assert.equal(p.overflow + p.scheduledKeys.length, 200, "every trigger is either scheduled or counted in the digest");
  assert.deepEqual(p.schedule.map(g => g.at), p.schedule.map(g => g.at).slice().sort((a, b) => a - b), "in time order"); assert.equal(plan({ events: evs, now: P - 600 * M, max: 10 }).schedule.length, 10);
});
test("time zones and the day window: absolute times, local text, the window follows the facility's date", () => {
  assert.equal(R.derive({ events: [E()], orders: [O()], settings: {}, acks: [], now: P, tz: "Africa/Kampala" })[0].plannedText, "13:00"); assert.equal(R.derive({ events: [E()], orders: [O()], settings: {}, acks: [], now: P, tz: "America/New_York" })[0].plannedText, "05:00");
  assert.deepEqual(R.windowDays(Date.UTC(2026, 10, 28, 12), "Africa/Kampala"), ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]); assert.deepEqual(R.windowDays(Date.UTC(2026, 10, 28, 12), "Pacific/Auckland"), ["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"], "already the 29th in Auckland");
  assert.equal(R.windowDays(Date.UTC(2026, 10, 28, 23, 30), "Africa/Kampala")[2], "2026-11-29", "local midnight has passed in Kampala");
  const spring = Date.UTC(2026, 2, 8, 14, 30), a = PCS.utcToLocal(spring - 3600000, "America/New_York").time, b = PCS.utcToLocal(spring + 3600000, "America/New_York").time; assert.equal(R.derive({ events: [E({ plannedAt: spring })], orders: [O()], settings: {}, acks: [], now: spring, tz: "America/New_York" })[0].plannedText, PCS.utcToLocal(spring, "America/New_York").time); assert.notEqual(a, b);
  assert.equal(R.levelsFor(E({ plannedAt: spring }), O(), R.settingsOf({}))[0].startsAt, spring - 30 * M, "scheduling is by absolute time, so a clock change cannot move an alert");
});
test("PROPERTY: 3,000 random situations keep every rule", () => {
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = a => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rnd() * 6), evs = [], ors = [];
    for (let k = 0; k < n; k++) { ors.push(O({ id: "o" + k, status: pick(["active", "active", "stopped", "completed"]), administrationMode: pick(["inpatient_mar", "facility_administered", "take_home", ""]), prescriberId: pick(["doc1", "doc2"]), kind: pick(["medicine", "procedure", "consumable"]) })); evs.push(E({ id: "e" + k, orderId: "o" + k, plannedAt: P + Math.floor((rnd() - 0.5) * 2000) * M, status: pick(["pending", "pending", "pending", "held", "administered", "missed", "cancelled"]), attendance: pick([undefined, undefined, "attended", "did_not_attend"]) })); }
    const now = P + Math.floor((rnd() - 0.5) * 3000) * M, settings = pick([{}, { graceMin: 15, soonMin: 10, escalateAfterMin: 60, appointmentAdvanceMin: 30 }, { graceMin: 240, soonMin: 240, escalateAfterMin: 720, appointmentAdvanceMin: 1440 }]), user = pick([NURSE, DOC, OWNER, NOBODY, Object.assign({}, OWNER, { ownerAlertsOn: true })]);
    const inp = { events: evs, orders: ors, settings, acks: [], now, tz: "Africa/Kampala", user }, al = R.derive(inp), pl = R.plan(inp), oBy = {}; ors.forEach(o => { oBy[o.id] = o; });
    al.forEach(a => { const o = oBy[a.orderId], e = evs.find(x => x.id === a.eventId); assert.ok(o.status === "active" && o.administrationMode !== "take_home" && o.kind !== "consumable", "alert for a stopped, take-home or other order, iteration " + i); assert.notEqual(e.status, "held"); assert.notEqual(e.status, "administered"); assert.notEqual(e.status, "cancelled"); if (o.administrationMode === "") assert.equal(a.push, false, "an old order never pushes"); if (a.level === "missed_recorded" || a.level === "did_not_attend") assert.equal(R.scopeFor(a, user).push, false); });
    pl.schedule.forEach(g => { assert.ok(g.at > now + 60000 - 60000, "scheduled in the past"); assert.ok(g.at >= now - 60000); });
    assert.ok(pl.schedule.length <= 40); assert.equal(new Set(pl.scheduledKeys).size, pl.scheduledKeys.length); assert.ok(pl.schedule.every(g => g.level !== "digest" || g.key === "tr|digest"));
    pl.showNow.forEach(n => { n.items.forEach(k => assert.ok(pl.activeKeys.includes(k))); }); assert.equal(/TEST Patient|TEST medicine/.test(JSON.stringify(pl)), false); assert.deepEqual(R.plan(inp), pl, "deterministic");
    if (user === NOBODY) { assert.deepEqual(pl.schedule, []); assert.deepEqual(pl.showNow, []); }
    if (user === OWNER) assert.deepEqual(pl.schedule.filter(g => g.level !== "dose_escalated").length, 0, "an owner's device without the switch gets no dose alerts");
  }
});

test("an acknowledgement still waiting for the server time uses the device's own time", () => {
  const out = R.derive({ events: [E()], orders: [O()], settings: {}, acks: [{ id: "rack_e1_dose_overdue", ackBy: "n1", ackByName: "N", createdAt: null, clientCreatedAt: 777 }], now: P + 40 * M });
  assert.equal(out[0].ack.at, 777);
});
