/* MediStock Cloud — alerts (Android app only; does nothing in Chrome).
   Every phone works out its own alerts from the data it already holds, so they work with no internet and with the app closed.
   - Low stock: shown the moment a drug falls to its reorder level (after a sale, or when the update arrives from another phone),
     plus a 8:00 reminder while drugs stay low.
   - Expiring: 30, 14, 7 days before and on the day, grouped into one alert per day. Expired stock: 8:00 reminder.
   - Credit: day before and on the due date, plus an 8:00 overdue reminder.
   - Unsynced: if changes have not reached the server for 24 hours.
   - Treatment (Stage 4, contract section 19): doses and appointments that are due, overdue or escalated, from the treatment data this device already holds. Text carries counts and times only.
     A treatment alert is "scheduled on this device"; this file never claims one was delivered.
   Tapping an alert opens the matching screen. */
(function () {
  var Cap = window.Capacitor;
  var native = false;
  try { native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform()); } catch (e) {}
  var N = { native: native, permission: "unknown", started: false, lastError: "" };
  window.MCNotify = N;

  var CHANNEL = "mc-alerts", ICON = "ic_stat_notify", COLOR = "#2BBFA0";
  var DIGEST_HOUR = 8, UNSYNCED_HOURS = 24, MAX_SCHEDULED = 60, DIGEST_DAYS = 3;
  var LN = null, listening = false;
  // A page loaded from the web only gets plugins through Capacitor.Plugins (registerPlugin is not there), so look both ways, and again later if needed.
  function initLN() {
    if (LN) return LN;
    var c = window.Capacitor, p = null;
    try { p = c && c.Plugins && c.Plugins.LocalNotifications; } catch (e) {}
    if (!p) { try { if (c && typeof c.registerPlugin === "function") p = c.registerPlugin("LocalNotifications"); } catch (e) {} }
    if (!p) { var names = ""; try { names = (c && c.PluginHeaders || []).map(function (h) { return h.name; }).join(", "); } catch (e) {} N.lastError = "the notifications plugin is not in this app build. Plugins: " + (names || "none"); return null; }
    LN = p; N.lastError = "";
    if (!listening) {
      listening = true;
      try { LN.addListener("localNotificationActionPerformed", function (ev) { var x = ev && ev.notification && ev.notification.extra; openTarget(x && x.target); }); } catch (e) { N.lastError = "listener: " + (e && e.message); }
    }
    return LN;
  }

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function uid() { return (window.MC && MC.user && MC.user.uid) || "x"; }

  // ------------------------------------------------------------ tapping an alert opens its screen
  var pendingTarget = null;
  function openTarget(t) {
    if (!t) return;
    if (window.MC && MC.go && MC.__routed) { try { MC.go(t); } catch (e) {} } else pendingTarget = t;
  }
  N.takePending = function () { var t = pendingTarget; pendingTarget = null; return t; };
  if (native) initLN();

  // ------------------------------------------------------------ reading the phone's own data
  function rows(coll) {
    var seen = {}, out = [];
    ((window.MC && MC.entries) || []).forEach(function (e) {
      if (e.coll !== coll) return;
      e.rows.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = 1; var o = {}; for (var k in r.d) o[k] = r.d[k]; o.id = r.id; out.push(o); } });
    });
    return out;
  }
  function entryOf(coll) { var f = null; ((window.MC && MC.entries) || []).forEach(function (e) { if (e.coll === coll && !f) f = e; }); return f; }
  function shopNames() { var m = {}; rows("shops").forEach(function (s) { m[s.id] = s.name; }); return m; }
  function isOwner() { return !!(MC.profile && MC.profile.role === "owner"); }

  function parseDay(s) {
    if (!s) return null;
    if (s && typeof s.toDate === "function") { var t = s.toDate(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function at(day, hour) { var d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0); return d; }
  function todayDay() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function names(list, key, max) {
    var u = []; list.forEach(function (x) { var n = x[key]; if (n && u.indexOf(n) < 0) u.push(n); });
    return u.slice(0, max || 3).join(", ") + (u.length > (max || 3) ? " +" + (u.length - (max || 3)) + " more" : "");
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (Math.abs(h) % 2000000000) + 1; }

  // ------------------------------------------------------------ low stock
  function lowDrugs() {
    return rows("drugs").filter(function (d) {
      return d.active !== false && Number(d.reorderLevel) > 0 && Number(d.currentStockBase || 0) <= Number(d.reorderLevel) * Number(d.baseUnitsPerStock || 1);
    });
  }
  function leftText(d) {
    var per = Number(d.baseUnitsPerStock) || 1, v = Math.round(Number(d.currentStockBase || 0) / per * 10) / 10;
    return v + " " + (d.stockUnit || "unit") + (v === 1 ? "" : "s") + " left";
  }

  async function show(n) {   // immediate alert
    if (!LN) return;
    await LN.schedule({ notifications: [{ id: Math.floor(Math.random() * 2000000000) + 1, title: n.title, body: n.body, channelId: CHANNEL, smallIcon: ICON, iconColor: COLOR, extra: { target: n.target } }] });
  }

  // Runs after every data change. Fires only for drugs that were NOT low before (so one alert per drop, not one per sale).
  async function checkLow() {
    var de = entryOf("drugs");
    if (!LN || !de || !de.synced || N.permission !== "granted") return;
    var key = "mcNotifLow:" + uid(), cur = lowDrugs(), curIds = cur.map(function (d) { return d.id; });
    var raw = ls(key), prev = null;
    try { prev = raw ? JSON.parse(raw) : null; } catch (e) {}
    ls(key, JSON.stringify(curIds));
    if (!prev) return;                         // first run on this phone: remember what is low, stay quiet
    var fresh = cur.filter(function (d) { return prev.indexOf(d.id) < 0; });
    if (!fresh.length) return;
    var sn = isOwner() ? shopNames() : null, multi = sn && Object.keys(sn).length > 1;
    if (fresh.length === 1) {
      var d = fresh[0];
      await show({ title: d.name + " is low on stock", body: leftText(d) + " (reorder level " + d.reorderLevel + ")" + (multi && sn[d.shopId] ? " · " + sn[d.shopId] : ""), target: "inventory.html?low=1" });
    } else {
      await show({ title: fresh.length + " drugs are low on stock", body: names(fresh, "name", 3), target: "inventory.html?low=1" });
    }
  }

  // ------------------------------------------------------------ the scheduled alerts
  function build() {
    var want = [], now = Date.now(), today = todayDay();
    function add(key, when, title, body, target) { if (when.getTime() > now + 60000) want.push({ key: key, at: when, title: title, body: body, target: target }); }

    // low stock reminder, 8:00 for the next days while drugs stay low
    var low = lowDrugs();
    if (low.length) for (var i = 0; i < DIGEST_DAYS; i++) add("low" + i, at(addDays(today, i), DIGEST_HOUR), "Low stock: " + low.length + " drug" + (low.length > 1 ? "s" : ""), names(low, "name", 4), "inventory.html?low=1");

    // expiring batches: grouped by the day the alert falls on
    var groups = {}, expiredNow = [];
    rows("batches").forEach(function (b) {
      if (!(Number(b.quantity) > 0)) return;
      var ex = parseDay(b.expiryDate); if (!ex) return;
      var days = Math.round((ex - today) / 86400000);
      if (days < 0) { expiredNow.push(b); return; }
      [30, 14, 7, 0].forEach(function (m) {
        var d = addDays(ex, -m);
        if (d < today) return;
        var k = d.getTime() + "|" + m; (groups[k] = groups[k] || { day: d, m: m, items: [] }).items.push(b);
      });
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k]; if ((g.day - today) / 86400000 > 75) return;
      var n = g.items.length;
      if (g.m === 0) add("exp" + k, at(g.day, DIGEST_HOUR), "Expired today: " + n + " batch" + (n > 1 ? "es" : ""), names(g.items, "drugName", 4), "batches.html?filter=expired");
      else add("exp" + k, at(g.day, DIGEST_HOUR), "Expiring in " + g.m + " days: " + n + " batch" + (n > 1 ? "es" : ""), names(g.items, "drugName", 4), "expiring.html?w=30");
    });
    if (expiredNow.length) for (var j = 0; j < DIGEST_DAYS; j++) add("expd" + j, at(addDays(today, j), DIGEST_HOUR), "Expired stock: " + expiredNow.length + " batch" + (expiredNow.length > 1 ? "es" : ""), names(expiredNow, "drugName", 4), "batches.html?filter=expired");

    // credit due
    var bal = {}, due = {}, nm = {}, overdue = {};
    rows("credit_accounts").forEach(function (a) { nm[a.id] = a.name; });
    rows("credit_transactions").forEach(function (t) {
      var c = t.customerId; if (!c) return;
      bal[c] = (bal[c] || 0) + (Number(t.balanceChange) || 0);
      if (t.customerName && !nm[c]) nm[c] = t.customerName;
      if (t.type === "CREDIT_SALE" && t.dueDate) { var dd = parseDay(t.dueDate); if (dd) (due[c] = due[c] || {})[dd.getTime()] = dd; }
    });
    var ow = [];
    Object.keys(bal).forEach(function (c) {
      if (bal[c] <= 0.5) return;
      var any = false;
      Object.keys(due[c] || {}).forEach(function (t) {
        var d = due[c][t];
        if (d < today) { any = true; return; }
        if ((d - today) / 86400000 > 30) return;
        var who = (nm[c] || "A customer"), amt = fmt(bal[c]);
        add("cdue" + c + t, at(d, DIGEST_HOUR), "Credit due today: " + who, who + " owes " + amt, "credit.html");
        add("cdue1" + c + t, at(addDays(d, -1), DIGEST_HOUR), "Credit due tomorrow: " + who, who + " owes " + amt, "credit.html");
      });
      if (any) ow.push({ name: nm[c] || "A customer", amt: bal[c] });
    });
    if (ow.length) for (var q = 0; q < DIGEST_DAYS; q++) add("cov" + q, at(addDays(today, q), DIGEST_HOUR), "Overdue credit: " + ow.length + " customer" + (ow.length > 1 ? "s" : ""), ow.slice(0, 3).map(function (o) { return o.name + " " + fmt(o.amt); }).join(", ") + (ow.length > 3 ? " +" + (ow.length - 3) + " more" : ""), "credit.html");

    // changes that have not reached the server
    var pend = (MC.pendingDocs && MC.pendingDocs()) || 0, sk = "mcPendingSince:" + uid();
    if (pend > 0) {
      var since = Number(ls(sk)) || 0; if (!since) { since = now; ls(sk, String(since)); }
      var when = new Date(since + UNSYNCED_HOURS * 3600000); if (when.getTime() <= now + 60000) when = new Date(now + 5 * 60000);
      want.push({ key: "unsynced", at: when, title: "Changes not synced", body: pend + " change" + (pend > 1 ? "s have" : " has") + " not reached the server for " + UNSYNCED_HOURS + " hours. Connect to the internet.", target: "dashboard.html" });
    } else ls(sk, null);

    want.sort(function (a, b) { return a.at - b.at; });
    var trw = []; try { trw = trBuild(now); } catch (e) { TR.err = String((e && (e.message || e.code)) || e); trw = []; }
    want = want.slice(0, MAX_SCHEDULED - trw.length).concat(trw);   // treatment first (at most TR_MAX), the other alerts keep the rest
    want.sort(function (a, b) { return a.at - b.at; });
    return want.slice(0, MAX_SCHEDULED);
  }


  // ------------------------------------------------------------ treatment reminders (Stage 4, contract section 19)
  // The rules of what is due, overdue, escalated, acknowledged or stopped live in pc-remind.js (pure, tested). This part only loads the data and hands the plan to the notification plugin.
  // Treatment reminders take priority up to TR_MAX of the 60 scheduled notifications; the other alerts keep the rest.
  var TR_MAX = 40;
  var TR = { api: null, unsubs: [], sig: "", ev: {}, orders: null, settings: null, acks: [], acksLimited: false, fac: null, lastPlan: null, err: "", loading: null, timer: null };
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("could not load " + src)); }; document.head.appendChild(s); });
  }
  function trPerms() { var p = MC.profile || {}, k = p.perms || {}; return p.role === "owner" || k["treatment.administer"] === true || k["treatment.prescribe"] === true; }
  function trUser() { var p = MC.profile || {}; return { uid: uid(), role: p.role, perms: p.perms || {}, ownerAlertsOn: ls("mcOwnerTreatmentAlerts:" + uid()) === "1" }; }
  function trFac() {
    var p = MC.profile || {}; if (!p.businessId) return null;
    var shops = rows("shops"), sh = null;
    if (p.role === "owner") { var want = ls("mc_activeShopId"); sh = shops.filter(function (x) { return x.id === want; })[0] || shops.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })[0] || null; }
    else sh = shops.filter(function (x) { return x.id === p.shopId; })[0] || null;
    if (!sh || !(Array.isArray(sh.enabledServices) && sh.enabledServices.indexOf("patient_care") >= 0)) return null;
    return { businessId: p.businessId, id: sh.id, name: sh.name || "", tz: sh.timezone || "Africa/Kampala", tzSet: !!sh.timezone };
  }
  function trDetach() { TR.unsubs.splice(0).forEach(function (u) { try { u(); } catch (e) {} }); TR.sig = ""; TR.fac = null; TR.ev = {}; TR.orders = null; TR.settings = null; TR.acks = []; TR.acksLimited = false; TR.lastPlan = null; }
  async function trAttach() {
    try {
      if (!native || !trPerms()) { if (TR.sig) trDetach(); return; }
      if (!window.PCRM || !window.PCS) {
        if (!TR.loading) TR.loading = (async function () { if (!window.PCS) await loadScript("pc-sched.js"); if (!window.PCRM) await loadScript("pc-remind.js"); })().catch(function (e) { TR.err = String(e && e.message || e); }).then(function () { TR.loading = null; });
        await TR.loading; if (!window.PCRM || !window.PCS) return;
      }
      var fac = trFac(), days = fac ? PCRM.windowDays(Date.now(), fac.tz) : [], sig = fac ? [fac.businessId, fac.id, days.join(",")].join("|") : "";
      if (sig === TR.sig) return;
      trDetach(); TR.sig = sig; TR.fac = fac; TR.err = ""; if (!fac) return;
      if (!TR.api) TR.api = MC.api(window);
      var api = TR.api, db = api.getFirestore(), B = fac.businessId, F = fac.id, bad = function (e) { TR.err = String((e && (e.code || e.message)) || e); };
      var map = function (s) { return s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); };
      var base = function (c) { return [api.collection(db, c), api.where("businessId", "==", B), api.where("facilityId", "==", F)]; };
      days.forEach(function (d) { TR.unsubs.push(api.onSnapshot(api.query.apply(null, base("pc_treatment_events").concat([api.where("plannedDay", "==", d), api.limit(500)])), function (s) { TR.ev[d] = map(s); soon(); }, bad)); });
      TR.unsubs.push(api.onSnapshot(api.query.apply(null, base("pc_treatment_orders").concat([api.where("status", "==", "active"), api.limit(500)])), function (s) { TR.orders = map(s); soon(); }, bad));
      TR.unsubs.push(api.onSnapshot(api.doc(db, "pc_reminder_settings", F), function (s) { TR.settings = s.exists() ? s.data() : null; soon(); }, bad));
      // acknowledgements: the newest 1000 (needs the index on pc_reminder_acks: businessId, facilityId, createdAt desc). Without it, fall back to any 1000 and say so on the alerts page.
      var unAck = null, listenAcks = function (ordered) {
        var qs = base("pc_reminder_acks"); if (ordered) qs.push(api.orderBy("createdAt", "desc")); qs.push(api.limit(1000));
        unAck = api.onSnapshot(api.query.apply(null, qs), function (s) { TR.acks = map(s); TR.acksLimited = !ordered; soon(); }, function (e) { if (ordered && e && e.code === "failed-precondition") { try { unAck(); } catch (x) {} listenAcks(false); } else bad(e); });
      };
      listenAcks(true); TR.unsubs.push(function () { if (unAck) unAck(); });
      if (!TR.timer) TR.timer = setInterval(function () { if (TR.fac) soon(); }, 60000);   // levels start and days roll over while the app stays open
    } catch (e) { TR.err = String((e && (e.message || e.code)) || e); }
  }
  // the plan for right now: pure engine, then what this device already did
  function trBuild(now) {
    if (!TR.fac || TR.orders === null || !window.PCRM) { TR.lastPlan = null; return []; }
    var evs = []; Object.keys(TR.ev).forEach(function (d) { evs = evs.concat(TR.ev[d]); });
    var k1 = "mcTrNotified:" + uid() + ":" + TR.fac.id, k2 = "mcTrSched:" + uid() + ":" + TR.fac.id, read = function (k) { try { return new Set(JSON.parse(ls(k) || "[]")); } catch (e) { return new Set(); } };
    var plan = PCRM.plan({ events: evs, orders: TR.orders, settings: TR.settings, acks: TR.acks, now: now, tz: TR.fac.tz, user: trUser(), notified: read(k1), scheduledPrev: read(k2), max: TR_MAX });
    TR.lastPlan = { plan: plan, k1: k1, k2: k2, notified: read(k1), at: now };
    return plan.schedule.map(function (g) { return { key: g.key, at: new Date(g.at), title: g.title, body: g.body, target: "treatment-alerts.html" }; });
  }
  // after the schedule was accepted: show what is active and was never notified, then remember what this device has scheduled or shown
  async function trCommit() {
    var L = TR.lastPlan; if (!L) return;
    try {
      var p = L.plan, notified = L.notified;
      for (var i = 0; i < p.showNow.length; i++) {
        var g = p.showNow[i];
        await LN.schedule({ notifications: [{ id: hash(g.key + "|" + g.items.join(",")), title: g.title, body: g.body, channelId: CHANNEL, smallIcon: ICON, iconColor: COLOR, extra: { target: "treatment-alerts.html" } }] });
        g.items.forEach(function (k) { notified.add(k); });
      }
      var keep = new Set(p.activeKeys); notified.forEach(function (k) { if (!keep.has(k)) notified.delete(k); });
      ls(L.k1, JSON.stringify(Array.from(notified))); ls(L.k2, JSON.stringify(p.scheduledKeys));
    } catch (e) { TR.err = String((e && (e.message || e.code)) || e); }
  }
  N.setOwnerTreatmentAlerts = function (on) { ls("mcOwnerTreatmentAlerts:" + uid(), on ? "1" : null); soon(); };
  N.treatmentStatus = async function () {
    var st = await N.status(), L = TR.lastPlan;
    return { native: native, permission: st.permission, attached: !!TR.fac, facility: TR.fac ? TR.fac.name : "", tzSet: TR.fac ? TR.fac.tzSet : true, ownerAlertsOn: trUser().ownerAlertsOn, scheduled: L ? L.plan.schedule.length : 0, overflow: L ? L.plan.overflow : 0, acksLimited: TR.acksLimited, error: TR.err };
  };

  var busy = null, again = false;
  async function reconcile() {
    if (!LN || N.permission !== "granted") return;
    if (busy) { again = true; return busy; }
    busy = (async function () {
      try {
        var want = build();
        var p = await LN.getPending();
        if (p && p.notifications && p.notifications.length) await LN.cancel({ notifications: p.notifications.map(function (n) { return { id: n.id }; }) });
        if (want.length) await LN.schedule({ notifications: want.map(function (w) { return { id: hash(w.key), title: w.title, body: w.body, schedule: { at: w.at, allowWhileIdle: true }, channelId: CHANNEL, smallIcon: ICON, iconColor: COLOR, extra: { target: w.target } }; }) });
        N.scheduled = want.length; N.lastError = "";
        await trCommit();
      } catch (e) { N.lastError = String((e && (e.message || e.code)) || e); }
    })();
    await busy; busy = null;
    if (again) { again = false; return reconcile(); }
  }

  var timer = null;
  function soon() { if (timer) return; timer = setTimeout(function () { timer = null; checkLow().catch(function () {}); trAttach().catch(function () {}).then(function () { return reconcile(); }).catch(function () {}); }, 3000); }

  // ------------------------------------------------------------ start, test, first-run tip
  function tip() {
    if (ls("mcNotifTipShown")) return;
    ls("mcNotifTipShown", "1");
    var o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,Roboto,Arial,sans-serif";
    o.innerHTML = '<div style="background:#16241f;color:#e7f2ee;border-radius:14px;padding:18px;max-width:340px;font-size:14px;line-height:1.45">' +
      '<div style="font-size:17px;font-weight:700;margin-bottom:8px">Alerts are on</div>' +
      'You will get alerts for low stock, expiring drugs, credit due and unsynced changes. Tap an alert to open that screen.<br><br>' +
      '<b>Keep them working:</b><br>• Leave banners ON for MediStock in the phone\'s notification settings.<br>' +
      '• On Tecno, Infinix and Itel phones, allow MediStock to <b>auto-start</b> and set battery to <b>No restrictions</b> (Phone Master or Settings &gt; Battery). Otherwise the phone may stop alerts when the app is closed.' +
      '<button style="margin-top:14px;width:100%;background:#2bbfa0;color:#06201a;border:0;border-radius:10px;padding:12px;font-size:16px;font-weight:700">OK</button></div>';
    o.querySelector("button").onclick = function () { o.remove(); };
    document.body.appendChild(o);
  }

  N.start = async function () {
    if (N.started) return; N.started = true;
    if (!initLN()) { N.started = false; return; }
    try {
      try { await LN.createChannel({ id: CHANNEL, name: "MediStock alerts", description: "Low stock, expiring drugs, credit due and sync reminders", importance: 4, visibility: 1, vibration: true, lights: true }); } catch (e) {}
      var p = await LN.checkPermissions();
      if (p.display !== "granted" && p.display !== "denied") p = await LN.requestPermissions();
      N.permission = p.display;
      if (p.display === "granted") tip();
    } catch (e) { N.lastError = String((e && (e.message || e.code)) || e); return; }
    var prevOnData = MC.onData;
    MC.onData = function (e) { if (prevOnData) prevOnData(e); soon(); };
    try { MC.onSync(soon); } catch (e) {}
    document.addEventListener("visibilitychange", function () { if (!document.hidden) soon(); });
    soon();
  };

  N.status = async function () {
    if (native) initLN();
    var out = { native: native, permission: N.permission, scheduled: N.scheduled || 0, error: N.lastError };
    if (LN) { try { var p = await LN.checkPermissions(); out.permission = N.permission = p.display; var pn = await LN.getPending(); out.pending = pn.notifications.length; } catch (e) { out.error = String(e && e.message || e); } }
    return out;
  };
  N.test = async function () {
    if (native) initLN();
    if (!native) return "Alerts work only in the MediStock Cloud app.";
    if (!LN) return "Alerts cannot start: " + N.lastError;
    var p = await LN.checkPermissions();
    if (p.display !== "granted") p = await LN.requestPermissions();
    N.permission = p.display;
    if (p.display !== "granted") return "Notifications are switched off for MediStock. Turn them on in the phone settings (Apps > MediStock Cloud > Notifications).";
    await show({ title: "MediStock test alert", body: "Tap me: I open the dashboard.", target: "dashboard.html" });
    return "Test alert sent. If you saw nothing, check that banners are ON for MediStock in the phone's notification settings.";
  };
  N.rescan = async function () { await checkLow(); await trAttach(); await reconcile(); return N.status(); };
})();
