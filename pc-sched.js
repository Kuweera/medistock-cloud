/* MediStock Cloud — Patient Care scheduling and safety helpers (pure functions, no database access).
   Used by the visit workspace (to build orders) and the treatment screen (to extend schedules).
   Nothing in here contains dosing knowledge: doses come from the clinician or from a dosing rule the facility approved. */
(function (root) {
  var MAX_EVENTS = 400;
  function pad(n) { return String(n).padStart(2, "0"); }
  function tzOffsetMs(ms, tz) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }
  // wall-clock time in a time zone -> UTC milliseconds (handles daylight saving)
  function localToUtc(dateStr, timeStr, tz) {
    var d = dateStr.split("-").map(Number), t = timeStr.split(":").map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1] || 0);
    var off = tzOffsetMs(guess, tz), utc = guess - off, off2 = tzOffsetMs(utc, tz);
    if (off2 !== off) utc = guess - off2;
    return utc;
  }
  function utcToLocal(ms, tz) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, time: pad(+p.hour % 24) + ":" + p.minute };
  }
  function addDays(dateStr, n) { var d = dateStr.split("-").map(Number), dt = new Date(Date.UTC(d[0], d[1] - 1, d[2] + n)); return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate()); }
  function weekday(dateStr) { var d = dateStr.split("-").map(Number); return new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay(); }
  function cleanTimes(times) { var out = []; (times || []).forEach(function (t) { if (/^\d{1,2}:\d{2}$/.test(t)) { var p = t.split(":"); var v = pad(+p[0]) + ":" + p[1]; if (+p[0] < 24 && +p[1] < 60 && out.indexOf(v) < 0) out.push(v); } }); return out.sort(); }

  // Builds the FULL list of planned administrations for an order, always in the same order with the same numbers,
  // so writing it again can never create duplicates (event id = order id + number).
  function generate(o) {
    var s = o.sched || {}, tz = o.tz || "Africa/Kampala", start = o.startAt, ev = [];
    var type = o.scheduleType === "weight" ? (s.pattern || "interval") : o.scheduleType;
    var sl = utcToLocal(start, tz);
    function dayTimes(dayOffsetFromStart, times, dose, weekdays) {
      var date = addDays(sl.date, dayOffsetFromStart);
      if (weekdays && weekdays.length && weekdays.indexOf(weekday(date)) < 0) return;
      times.forEach(function (t) {
        if (dayOffsetFromStart === 0 && t < sl.time) return; // earlier times on the first day have already passed
        ev.push({ plannedAt: localToUtc(date, t, tz), doseValue: dose });
      });
    }
    if (type === "once") ev.push({ plannedAt: start, doseValue: null });
    else if (type === "interval") {
      var n = Math.max(0, Math.floor(s.count || 0)), step = (s.everyHours || 0) * 3600000;
      for (var k = 0; k < n && step > 0; k++) ev.push({ plannedAt: start + k * step, doseValue: null });
    } else if (type === "daily" || type === "fixed") {
      var times = cleanTimes(s.times), days = Math.max(0, Math.floor(s.days || 0));
      for (var d = 0; d < days; d++) dayTimes(d, times, null, type === "fixed" ? s.weekdays : null);
    } else if (type === "taper") {
      var cursor = 0;
      (s.stages || []).forEach(function (st) {
        var tms = cleanTimes(st.times), dd = Math.max(0, Math.floor(st.days || 0));
        for (var i = 0; i < dd; i++) dayTimes(cursor + i, tms, st.doseValue, null);
        cursor += dd;
      });
    } else if (type === "custom") {
      (s.items || []).forEach(function (it) { if (it.date && /^\d{1,2}:\d{2}$/.test(it.time || "")) ev.push({ plannedAt: localToUtc(it.date, cleanTimes([it.time])[0], tz), doseValue: it.doseValue != null ? it.doseValue : null }); });
    }
    ev.sort(function (a, b) { return a.plannedAt - b.plannedAt; });
    return ev.map(function (e, i) {
      var l = utcToLocal(e.plannedAt, tz);
      return { idx: i, idKey: String(i).padStart(4, "0"), plannedAt: e.plannedAt, plannedLocal: l.date + " " + l.time, plannedDay: l.date, tz: tz, doseValue: e.doseValue };
    });
  }
  function validate(o) {
    var s = o.sched || {}, type = o.scheduleType;
    if (!o.startAt || isNaN(o.startAt)) return "Choose when the treatment starts.";
    if (type === "prn") {
      if (!(s.minIntervalHours >= 0)) return "Enter the shortest time allowed between doses (0 if none).";
      if (!(s.maxPerDay >= 1)) return "Enter the most doses allowed in a day.";
      if (!s.indication || String(s.indication).trim().length < 2) return "Say what the as-needed dose is for.";
      return "";
    }
    var inner = type === "weight" ? s.pattern : type;
    if (inner === "interval" && !(s.everyHours > 0 && s.count >= 1)) return "Enter the hours between doses and how many doses.";
    if ((inner === "daily" || inner === "fixed") && (!cleanTimes(s.times).length || !(s.days >= 1))) return "Choose at least one time of day and the number of days.";
    if (inner === "taper") {
      if (!(s.stages || []).length) return "Add at least one stage.";
      for (var i = 0; i < s.stages.length; i++) { var st = s.stages[i]; if (!(st.days >= 1) || !cleanTimes(st.times).length || !(st.doseValue > 0)) return "Stage " + (i + 1) + " needs days, times of day and a dose."; }
    }
    if (inner === "custom" && !(s.items || []).length) return "Add at least one date and time.";
    var n = generate(o).length;
    if (!n) return "This schedule gives no administrations. Check the start time and the days.";
    if (n > MAX_EVENTS) return "This schedule has " + n + " administrations; the most allowed for one order is " + MAX_EVENTS + ". Use a shorter course or two orders.";
    return "";
  }
  function describe(o) {
    var s = o.sched || {}, t = o.scheduleType, inner = t === "weight" ? s.pattern : t, base = "";
    if (t === "prn") return "As needed for " + s.indication + " · at least " + s.minIntervalHours + " h apart · at most " + s.maxPerDay + " a day" + (s.maxDailyDose ? " · up to " + s.maxDailyDose + " " + (o.doseUnit || "") + " a day" : "");
    if (inner === "once") base = "Once";
    else if (inner === "interval") base = "Every " + s.everyHours + " hours, " + s.count + " dose" + (s.count === 1 ? "" : "s");
    else if (inner === "daily") base = cleanTimes(s.times).length + " time" + (cleanTimes(s.times).length === 1 ? "" : "s") + " a day (" + cleanTimes(s.times).join(", ") + ") for " + s.days + " day" + (s.days === 1 ? "" : "s");
    else if (inner === "fixed") { var wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; base = "At " + cleanTimes(s.times).join(", ") + (s.weekdays && s.weekdays.length ? " on " + s.weekdays.map(function (x) { return wd[x]; }).join(", ") : " every day") + " for " + s.days + " day" + (s.days === 1 ? "" : "s"); }
    else if (inner === "taper") base = "Tapering: " + (s.stages || []).map(function (x) { return x.doseValue + " " + (o.doseUnit || "") + " × " + cleanTimes(x.times).length + "/day for " + x.days + "d"; }).join(" then ");
    else if (inner === "custom") base = "At " + (s.items || []).length + " chosen time" + ((s.items || []).length === 1 ? "" : "s");
    return (t === "weight" ? "Weight-based dose · " : "") + base;
  }
  // dose from a facility-approved weight-based rule; the clinician must still confirm it
  function weightDose(rule, weightKg, ageMonths) {
    var r = { dose: null, capped: false, errors: [], warnings: [] };
    if (!rule || !(rule.dosePerKg > 0)) { r.errors.push("This rule has no dose per kg."); return r; }
    if (!(weightKg > 0)) { r.errors.push("Enter the patient's weight."); return r; }
    if (rule.minWeightKg != null && weightKg < rule.minWeightKg) r.errors.push("Weight " + weightKg + " kg is below the lowest weight this rule supports (" + rule.minWeightKg + " kg).");
    if (rule.maxWeightKg != null && weightKg > rule.maxWeightKg) r.errors.push("Weight " + weightKg + " kg is above the highest weight this rule supports (" + rule.maxWeightKg + " kg).");
    if (ageMonths != null) {
      if (rule.minAgeMonths != null && ageMonths < rule.minAgeMonths) r.errors.push("The patient is younger than this rule supports.");
      if (rule.maxAgeMonths != null && ageMonths > rule.maxAgeMonths) r.errors.push("The patient is older than this rule supports.");
    } else if (rule.minAgeMonths != null || rule.maxAgeMonths != null) r.warnings.push("The patient's age is not known, so the rule's age range could not be checked.");
    var d = Math.round(weightKg * rule.dosePerKg * 100) / 100;
    if (rule.maxDosePerAdmin != null && d > rule.maxDosePerAdmin) { d = rule.maxDosePerAdmin; r.capped = true; r.warnings.push("The calculated dose was above the rule's maximum per dose, so it is limited to " + d + "."); }
    r.dose = d; return r;
  }
  // checks a dose against the facility's approved rule for the medicine; with no rule nothing is checked and it says so
  function checkDose(rule, o, dosesPerDay) {
    var out = { status: "norule", messages: [] };
    if (!rule) { out.messages.push("No approved dosing rule is on file for this medicine, so the dose is NOT checked."); return out; }
    out.status = "ok";
    var dose = o.doseValue;
    if (rule.minDosePerAdmin != null && dose < rule.minDosePerAdmin) { out.status = "warn"; out.messages.push("Dose " + dose + " is below the rule's lowest dose (" + rule.minDosePerAdmin + ")."); }
    if (rule.maxDosePerAdmin != null && dose > rule.maxDosePerAdmin) { out.status = "warn"; out.messages.push("Dose " + dose + " is above the rule's highest dose (" + rule.maxDosePerAdmin + ")."); }
    if (rule.maxDailyDose != null && dosesPerDay > 0 && dose * dosesPerDay > rule.maxDailyDose) { out.status = "warn"; out.messages.push("The daily total (" + Math.round(dose * dosesPerDay * 100) / 100 + ") is above the rule's maximum per day (" + rule.maxDailyDose + ")."); }
    if (rule.doseUnit && o.doseUnit && String(rule.doseUnit).toLowerCase() !== String(o.doseUnit).toLowerCase()) { out.status = "warn"; out.messages.push("The rule is written in " + rule.doseUnit + " but this order uses " + o.doseUnit + ". Check the dose."); }
    if (rule.allowedRoutes && rule.allowedRoutes.length && o.route && rule.allowedRoutes.map(function (x) { return x.toLowerCase(); }).indexOf(String(o.route).toLowerCase()) < 0) { out.status = "warn"; out.messages.push("The route '" + o.route + "' is not one of the routes in the rule (" + rule.allowedRoutes.join(", ") + ")."); }
    return out;
  }
  function maxPerDay(events) { var c = {}, m = 0; events.forEach(function (e) { c[e.plannedDay] = (c[e.plannedDay] || 0) + 1; if (c[e.plannedDay] > m) m = c[e.plannedDay]; }); return m; }
  function words(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean); }
  // matches by NAME only; class allergies (for example "penicillins") are not detected
  function allergyMatches(names, allergies) {
    var mw = []; names.forEach(function (n) { mw = mw.concat(words(n)); });
    return (allergies || []).filter(function (a) {
      if (a.status && a.status !== "active") return false;
      var aw = words(a.substance).filter(function (w) { return w.length >= 4; });
      return aw.some(function (w) { return mw.some(function (m) { return m === w || (m.length >= 5 && w.length >= 5 && (m.indexOf(w) === 0 || w.indexOf(m) === 0)); }); });
    });
  }
  function duplicateOrders(names, activeOrders) {
    var mw = []; names.forEach(function (n) { words(n).forEach(function (w) { if (w.length >= 4 && !/^\d/.test(w)) mw.push(w); }); });
    return (activeOrders || []).filter(function (o) {
      if (o.kind !== "medicine" || o.status !== "active") return false;
      var ow = []; [o.medicineName, o.generic].forEach(function (n) { words(n).forEach(function (w) { if (w.length >= 4 && !/^\d/.test(w)) ow.push(w); }); });
      return mw.some(function (m) { return ow.indexOf(m) >= 0; });
    });
  }
  // the approved rule in force for a medicine: every word of the rule's medicine name must appear in the medicine name; highest version wins
  function ruleFor(names, rules, todayIso) {
    var mw = []; names.forEach(function (n) { mw = mw.concat(words(n)); });
    var ok = (rules || []).filter(function (r) {
      if (r.approvalStatus !== "approved") return false;
      if (r.effectiveDate && todayIso && r.effectiveDate > todayIso) return false;
      var rw = words(r.medicineName).filter(function (w) { return w.length >= 4 && !/^\d/.test(w); });
      return rw.length > 0 && rw.every(function (w) { return mw.indexOf(w) >= 0; });
    });
    ok.sort(function (a, b) { return (b.version || 0) - (a.version || 0); });
    return ok[0] || null;
  }
  // what the dashboard shows for a pending administration (the stored status stays "pending")
  function dueState(e, now, graceMin, soonMin) {
    if (e.status !== "pending") return e.status;
    var diff = (e.plannedAt - now) / 60000;
    if (diff < -(graceMin || 30)) return "delayed";
    if (diff <= (soonMin || 30)) return "due";
    return "pending";
  }
  var api = { MAX_EVENTS: MAX_EVENTS, tzOffsetMs: tzOffsetMs, localToUtc: localToUtc, utcToLocal: utcToLocal, addDays: addDays, weekday: weekday, cleanTimes: cleanTimes, generate: generate, validate: validate, describe: describe,
    weightDose: weightDose, checkDose: checkDose, maxPerDay: maxPerDay, allergyMatches: allergyMatches, duplicateOrders: duplicateOrders, ruleFor: ruleFor, dueState: dueState };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCS = api;
})(typeof window !== "undefined" ? window : this);
