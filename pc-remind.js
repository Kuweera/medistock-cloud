/* MediStock Cloud — Developer 4, Stage 4: treatment reminders (pure logic, no database, no clinical values).
   Contract section 19 (rules v30). Alerts are DERIVED on each device from data that already syncs (events, orders, settings, acknowledgements). Nothing here is stored except
   the timings (pc_reminder_settings) and the "I have seen this" marks (pc_reminder_acks); an acknowledgement records no dose and changes no event.
   Wording rule: a notification is "scheduled on this device", never "delivered". Notification text carries no patient name and no medicine name (it can show on a locked screen). */
(function (root) {
  "use strict";
  var PCS = root.PCS || (typeof require !== "undefined" ? require("./pc-sched.js") : null);

  var LEVELS = ["dose_due", "dose_overdue", "dose_escalated", "appointment_soon", "appointment_overdue", "missed_recorded", "did_not_attend"];
  var PUSH_LEVELS = ["dose_due", "dose_overdue", "dose_escalated", "appointment_soon", "appointment_overdue"];
  var DEFAULTS = { graceMin: 30, soonMin: 30, escalateAfterMin: 0, appointmentAdvanceMin: 0 };   // operational timings, not clinical values; the same grace and soon as treatment.html
  var BOUNDS = { graceMin: [5, 240], soonMin: [5, 240], escalateAfterMin: [0, 720], appointmentAdvanceMin: [0, 1440] };
  var LABEL = { dose_due: "Due", dose_overdue: "Overdue", dose_escalated: "Escalated", appointment_soon: "Appointment soon", appointment_overdue: "Overdue: not arrived", missed_recorded: "Recorded as missed", did_not_attend: "Did not attend" };
  var SEVERITY = { dose_due: "warn", appointment_soon: "warn", dose_overdue: "bad", appointment_overdue: "bad", dose_escalated: "bad", missed_recorded: "info", did_not_attend: "info" };
  var RANK = { dose_escalated: 0, dose_overdue: 1, appointment_overdue: 2, dose_due: 3, appointment_soon: 4, missed_recorded: 5, did_not_attend: 6 };
  var MODES = ["inpatient_mar", "facility_administered"];
  var MIN = 60000, INF = Infinity;

  function str(v) { return v == null ? "" : String(v).trim(); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function inBounds(k, v) { return isInt(v) && v >= BOUNDS[k][0] && v <= BOUNDS[k][1]; }

  /* ---- settings. A missing or out-of-range value is replaced by the default; nothing is guessed beyond that. */
  function settingsOf(doc) {
    var s = { fromDoc: !!doc }, d = doc || {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = inBounds(k, d[k]) ? d[k] : DEFAULTS[k]; });
    return s;
  }
  /* settingsErrors(form) -> list of plain reasons. `form` holds raw text or numbers from the screen. Escalation, when used, must come AFTER the overdue time, or it would be announced before the dose is overdue. */
  function settingsErrors(form) {
    var e = [], f = form || {}, names = { graceMin: "Minutes before a dose is overdue", soonMin: "Minutes before a dose counts as due", escalateAfterMin: "Minutes before escalating", appointmentAdvanceMin: "Minutes of warning before an appointment" }, v = {};
    Object.keys(BOUNDS).forEach(function (k) {
      var raw = f[k]; if (raw === "" || raw === undefined || raw === null) raw = String(DEFAULTS[k]);
      var t = String(raw).trim(), n = /^\d+$/.test(t) ? Number(t) : NaN; v[k] = n;
      if (!inBounds(k, n)) e.push(names[k] + " must be a whole number from " + BOUNDS[k][0] + " to " + BOUNDS[k][1] + ".");
    });
    if (!e.length && v.escalateAfterMin > 0 && v.escalateAfterMin <= v.graceMin) e.push("Escalation must come later than the overdue time (" + v.graceMin + " minutes), or leave it at 0 for no escalation.");
    return e;
  }
  function settingsFields(form) { var o = {}; Object.keys(BOUNDS).forEach(function (k) { var raw = form[k]; o[k] = (raw === "" || raw === undefined || raw === null) ? DEFAULTS[k] : Number(String(raw).trim()); }); return o; }

  /* ---- which events and orders count */
  function modeOf(o) { return o && o.administrationMode ? o.administrationMode : ""; }
  function orderOk(o) { return !!o && o.status === "active" && modeOf(o) !== "take_home" && (o.kind === "medicine" || o.kind === "procedure"); }
  function hhmm(ms, tz) { return PCS.utcToLocal(ms, tz || "Africa/Kampala").time; }

  /* levelsFor(event, order, settings) -> [{ level, startsAt, endsAt }] for a PENDING event assuming it stays pending.
     Doses (inpatient_mar, or no mode: in-app only) have due / overdue / escalated. Facility-administered appointments have soon / overdue, and stop when arrival is recorded. */
  function levelsFor(e, o, s) {
    if (!e || e.status !== "pending" || typeof e.plannedAt !== "number" || !orderOk(o)) return [];
    var p = e.plannedAt, g = s.graceMin * MIN, out = [], mode = modeOf(o);
    if (mode === "facility_administered") {
      if (e.attendance) return [];
      if (s.appointmentAdvanceMin > 0) out.push({ level: "appointment_soon", startsAt: p - s.appointmentAdvanceMin * MIN, endsAt: p + g });
      out.push({ level: "appointment_overdue", startsAt: p + g, endsAt: INF });
      return out;
    }
    out.push({ level: "dose_due", startsAt: p - s.soonMin * MIN, endsAt: p + g });
    out.push({ level: "dose_overdue", startsAt: p + g, endsAt: INF });
    if (s.escalateAfterMin > 0) out.push({ level: "dose_escalated", startsAt: p + s.escalateAfterMin * MIN, endsAt: INF });
    return out;
  }
  function ackMap(acks) { var m = {}; (acks || []).forEach(function (a) { if (a && a.id) m[a.id] = a; }); return m; }
  function ackOf(m, eventId, level) { var a = m["rack_" + eventId + "_" + level]; return a ? { by: a.ackBy || "", byName: a.ackByName || "", at: a.createdAt != null ? a.createdAt : (a.clientCreatedAt || null), note: a.note || "" } : null; }   // the time is the acknowledgement document's own creation time
  function mk(e, o, level, startsAt, endsAt, acks, tz) {
    var plannedAt = e.plannedAt;
    return { id: e.id + "_" + level, ackId: "rack_" + e.id + "_" + level, key: e.id + "|" + level + "|" + plannedAt, level: level, label: LABEL[level], severity: SEVERITY[level], eventId: e.id, orderId: e.orderId, patientId: e.patientId, patientName: e.patientName || "",
      what: e.label || "", kind: e.kind || (o && o.kind) || "", mode: modeOf(o), prescriberId: o ? o.prescriberId || "" : "", plannedAt: plannedAt, plannedText: hhmm(plannedAt, tz), startsAt: startsAt, endsAt: endsAt,
      push: modeOf(o) !== "" && PUSH_LEVELS.indexOf(level) >= 0, ack: ackOf(acks, e.id, level) };
  }

  /* derive({ events, orders, settings, acks, now, tz }) -> alerts that apply NOW (not acknowledged ones are NOT removed: they stay, marked). Sorted: most urgent first.
     events: the events loaded for the window; orders: ACTIVE orders (an order not in the list is stopped, completed or unknown: no alert). */
  function derive(inp) {
    var now = inp.now, s = settingsOf(inp.settings), tz = inp.tz, acks = ackMap(inp.acks), ord = {}, out = [];
    (inp.orders || []).forEach(function (o) { ord[o.id] = o; });
    (inp.events || []).forEach(function (e) {
      var o = ord[e.orderId]; if (!e) return;
      if (e.status === "pending") {
        levelsFor(e, o, s).forEach(function (L) { if (now >= L.startsAt && now < L.endsAt) out.push(mk(e, o, L.level, L.startsAt, L.endsAt, acks, tz)); });
      } else if (e.status === "missed" && o && orderOk(o)) {
        out.push(mk(e, o, e.attendance === "did_not_attend" ? "did_not_attend" : "missed_recorded", e.attendanceAt || e.actualAt || e.plannedAt, INF, acks, tz));
      }
    });
    out.sort(function (a, b) { return (RANK[a.level] - RANK[b.level]) || (a.plannedAt - b.plannedAt) || (a.id < b.id ? -1 : 1); });
    return out;
  }

  /* scopeFor(alert, user) -> { inApp, push, as }.  user: { uid, role, perms, ownerAlertsOn }
     - dose and appointment alerts go to people with treatment.administer. The owner role holds every permission, so an owner gets them only when switched on for that device.
     - escalation goes to the prescriber of the order (push and in the list), and is also shown in the list to everyone with treatment.administer, labelled escalated.
     - recorded missed and did-not-attend: the prescriber only, in the list, never a push. */
  function can(u, k) { return !!u && (u.role === "owner" || (u.perms && u.perms[k] === true)); }
  function scopeFor(a, u) {
    var none = { inApp: false, push: false, as: "" }; if (!u || !u.uid) return none;
    var presc = !!a.prescriberId && a.prescriberId === u.uid, admin = can(u, "treatment.administer") && (u.role !== "owner" || u.ownerAlertsOn === true);
    if (a.level === "missed_recorded" || a.level === "did_not_attend") return presc ? { inApp: true, push: false, as: "prescriber" } : none;
    if (a.level === "dose_escalated") return presc ? { inApp: true, push: a.push && !a.ack, as: "prescriber" } : (admin ? { inApp: true, push: false, as: "administer" } : none);
    return admin ? { inApp: true, push: a.push && !a.ack, as: "administer" } : none;
  }
  function visible(alerts, u) { return alerts.map(function (a) { var sc = scopeFor(a, u); return sc.inApp ? Object.assign({}, a, { scope: sc }) : null; }).filter(Boolean); }

  /* the staff follow-up list (Q7): patients recorded as DID NOT ATTEND, from existing attendance data. No contact details, no schema. Newest first. */
  function didNotAttend(events, tz) {
    return (events || []).filter(function (e) { return e && e.attendance === "did_not_attend" && e.status === "missed"; })
      .map(function (e) { return { eventId: e.id, orderId: e.orderId, patientId: e.patientId, patientName: e.patientName || "", what: e.label || "", plannedAt: e.plannedAt, plannedDay: e.plannedDay || "", plannedText: hhmm(e.plannedAt, tz), at: e.attendanceAt || e.actualAt || e.plannedAt, byName: e.attendanceByName || "" }; })
      .sort(function (a, b) { return b.plannedAt - a.plannedAt; });
  }

  /* ---- notification text: counts and times only */
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  var TXT = {
    dose_due: function (n, t) { return ["Treatment due", plural(n, "scheduled item is", "scheduled items are") + " due around " + t + ". Open the treatment alerts."]; },
    dose_overdue: function (n, t) { return ["Treatment overdue", plural(n, "item is", "items are") + " not recorded after the planned time (" + t + "). Open the treatment alerts."]; },
    dose_escalated: function (n, t) { return ["Treatment escalated", plural(n, "item", "items") + " you ordered " + (n === 1 ? "is" : "are") + " still not recorded (planned " + t + "). Open the treatment alerts."]; },
    appointment_soon: function (n, t) { return ["Appointment soon", plural(n, "treatment appointment", "treatment appointments") + " around " + t + ". Open the treatment alerts."]; },
    appointment_overdue: function (n, t) { return ["Appointment overdue", plural(n, "patient has", "patients have") + " not arrived for the " + t + " appointment. Open the treatment alerts."]; }
  };
  function minuteOf(ms) { return Math.floor(ms / MIN); }

  /* plan({ events, orders, settings, acks, now, tz, user, notified, scheduledPrev, max }) -> { schedule, showNow, scheduledKeys, activeKeys, overflow }
     schedule: notifications for the FUTURE, grouped by level and minute: { key, at, title, body, level, count, target }, at most `max` in total (default 40), the rest folded into one digest.
     showNow: levels that are active now and were never notified on this device: one notification per level, { key, title, body, level, count }.
     notified / scheduledPrev: Sets of item keys (event|level|plannedAt) this device has already notified, or scheduled the last time it planned. A key whose time has passed and that was scheduled before counts as fired.
     scheduledKeys: the item keys covered by `schedule` (store them for next time). activeKeys: item keys active now (so the caller can forget keys that are no longer relevant). Rebuilt in full each time: the same state gives the same plan, so no duplicates. */
  function plan(inp) {
    var now = inp.now, s = settingsOf(inp.settings), tz = inp.tz, acks = ackMap(inp.acks), u = inp.user, max = inp.max || 40, ord = {}, future = [], active = [];
    var notified = inp.notified || new Set(), prev = inp.scheduledPrev || new Set();
    (inp.orders || []).forEach(function (o) { ord[o.id] = o; });
    (inp.events || []).forEach(function (e) {
      var o = ord[e && e.orderId]; if (!e || e.status !== "pending") return;
      levelsFor(e, o, s).forEach(function (L) {
        var a = mk(e, o, L.level, L.startsAt, L.endsAt, acks, tz), sc = scopeFor(a, u);
        if (!sc.push) return;
        if (L.endsAt <= now) return;
        if (L.startsAt > now + MIN) future.push(a); else active.push(a);
      });
    });
    var activeKeys = active.map(function (a) { return a.key; });
    var fresh = active.filter(function (a) { return !notified.has(a.key) && !prev.has(a.key); });
    var showNow = [];
    Object.keys(TXT).forEach(function (lv) {
      var g = fresh.filter(function (a) { return a.level === lv; }); if (!g.length) return;
      var first = g.reduce(function (m, a) { return Math.min(m, a.plannedAt); }, INF), t = TXT[lv](g.length, hhmm(first, tz));
      showNow.push({ key: "tr|now|" + lv, title: t[0], body: t[1], level: lv, count: g.length, items: g.map(function (a) { return a.key; }) });
    });
    var groups = {};
    future.forEach(function (a) { var k = a.level + "|" + minuteOf(a.startsAt); (groups[k] = groups[k] || { level: a.level, at: minuteOf(a.startsAt) * MIN, items: [], planned: a.plannedAt }).items.push(a); });
    var sched = Object.keys(groups).map(function (k) {
      var g = groups[k], t = TXT[g.level](g.items.length, hhmm(g.planned, tz));
      return { key: "tr|" + g.level + "|" + g.at, at: g.at, title: t[0], body: t[1], level: g.level, count: g.items.length, items: g.items.map(function (a) { return a.key; }) };
    }).sort(function (a, b) { return (a.at - b.at) || (a.key < b.key ? -1 : 1); });
    var overflow = 0;
    if (sched.length > max) {
      var keep = sched.slice(0, max - 1), rest = sched.slice(max - 1); overflow = rest.reduce(function (n, g) { return n + g.count; }, 0);
      keep.push({ key: "tr|digest", at: rest[0].at, title: "More treatment alerts", body: plural(overflow, "more alert is", "more alerts are") + " scheduled on this device for later. Open the treatment alerts.", level: "digest", count: overflow, items: [] });
      sched = keep;
    }
    var covered = []; sched.forEach(function (g) { g.items.forEach(function (k) { covered.push(k); }); });
    return { schedule: sched, showNow: showNow, scheduledKeys: covered, activeKeys: activeKeys, overflow: overflow };
  }

  /* the window of local days a device loads: two days back to tomorrow (four days), in the facility's time zone */
  function windowDays(now, tz) { var t = PCS.utcToLocal(now, tz || "Africa/Kampala").date; return [-2, -1, 0, 1].map(function (i) { return PCS.addDays(t, i); }); }

  var api = { LEVELS: LEVELS, PUSH_LEVELS: PUSH_LEVELS, DEFAULTS: DEFAULTS, BOUNDS: BOUNDS, LABEL: LABEL, settingsOf: settingsOf, settingsErrors: settingsErrors, settingsFields: settingsFields, levelsFor: levelsFor, derive: derive, scopeFor: scopeFor, visible: visible,
    didNotAttend: didNotAttend, plan: plan, windowDays: windowDays, orderOk: orderOk, modeOf: modeOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCRM = api;
})(typeof window !== "undefined" ? window : this);
