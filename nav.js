/* MediStock Cloud — shared menu, offline helpers and sync status.
   To add a page to the menu, add one line to ITEMS below and upload this file only. */
(function () {
  var ITEMS = [
    ["dashboard.html", "Dashboard"],
    ["charts.html", "Charts"],
    ["reports.html", "Profit & Reports"],
    ["history.html", "Business History"],
    ["sales.html", "Sell"],
    ["inventory.html", "Inventory"],
    ["purchases.html", "Purchases"],
    ["batches.html", "Batches"],
    ["expiring.html", "Expiring Drugs"],
    ["stocktake.html", "Stock Taking"],
    ["whattobuy.html", "What to Buy"],
    ["expenses.html", "Expenses"],
    ["credit.html", "Credit / Loans"],
    ["cash-position.html", "Cash Position"],
    ["suppliers.html", "Suppliers"],
    ["users.html", "Users"],
    ["shops.html", "Shops"],
    ["settings.html", "Settings"]
  ];
  var FB = "https://www.gstatic.com/firebasejs/12.19.0/";

  // ---------- menu ----------
  var panel = document.getElementById("navPanel");
  var out = null;
  if (panel) {
    var current = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    panel.querySelectorAll("a").forEach(function (a) { a.parentNode.removeChild(a); });
    var before = panel.querySelector(".theme-toggle");
    ITEMS.forEach(function (it) {
      var a = document.createElement("a");
      a.href = it[0];
      a.textContent = it[1];
      if (it[0] === current) a.className = "active";
      panel.insertBefore(a, before);
    });
    out = document.createElement("button");
    out.type = "button";
    out.className = "theme-toggle";
    out.id = "logoutBtn";
    out.textContent = "\ud83d\udeaa Log out";
    panel.appendChild(out);
  }

  // ---------- sync status ----------
  var pending = 0, problem = null, bootPending = false, dbHandle = null;
  var pill = document.createElement("div");
  pill.id = "syncPill";
  pill.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:9999;padding:7px 13px;border-radius:999px;font:600 12px system-ui,sans-serif;display:none;box-shadow:0 2px 8px rgba(0,0,0,.35);";
  (document.body || document.documentElement).appendChild(pill);
  function paint() {
    if (problem) { pill.style.display = "block"; pill.style.background = "#e5534b"; pill.style.color = "#fff"; pill.textContent = "\u26a0 A change could not be saved \u2014 tap"; }
    else if (pending > 0 || bootPending) { pill.style.display = "block"; pill.style.background = "#f0b429"; pill.style.color = "#222"; pill.textContent = "\u23f3 Changes waiting to sync" + (pending > 1 ? " (" + pending + ")" : ""); }
    else pill.style.display = "none";
  }
  pill.addEventListener("click", function () { if (problem) { alert(problem); problem = null; paint(); } });

  // Pages call this instead of waiting for the server: the change is saved on the phone at once,
  // and uploaded whenever the internet allows.
  window.mcQueue = function (p) {
    pending++; paint();
    Promise.resolve(p).then(function () { pending--; paint(); }, function (err) {
      pending--;
      var msg = err && err.code === "permission-denied" ? "Your account isn't allowed to save that change (or the account was deactivated)." : (err && err.message) || "Unknown error.";
      problem = "A change could not be saved to the server: " + msg;
      paint();
    });
  };

  function getDb() {
    return Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-firestore.js")]).then(function (m) {
      var apps = m[0].getApps();
      if (!apps.length) return null;
      return { fs: m[1], db: m[1].getFirestore(apps[0]) };
    });
  }
  function waitDb(tries) {
    return getDb().then(function (x) {
      if (x || tries <= 0) return x;
      return new Promise(function (r) { setTimeout(r, 500); }).then(function () { return waitDb(tries - 1); });
    });
  }
  waitDb(40).then(function (x) {
    if (!x) return;
    dbHandle = x; bootPending = true; paint();
    x.fs.waitForPendingWrites(x.db).then(function () { bootPending = false; paint(); }, function () { bootPending = false; paint(); });
  }).catch(function () {});

  // ---------- log out (warns if anything hasn't reached the server yet) ----------
  if (out) out.addEventListener("click", async function () {
    var unsynced = pending > 0;
    try {
      var x = dbHandle || await waitDb(4);
      if (x) {
        var ok = await Promise.race([x.fs.waitForPendingWrites(x.db).then(function () { return true; }), new Promise(function (r) { setTimeout(function () { r(false); }, 1500); })]);
        if (!ok) unsynced = true;
      }
    } catch (e) {}
    var msg = unsynced
      ? "Some changes have NOT reached the server yet. Logging out now can lose them.\n\nStay signed in until the \u201cwaiting to sync\u201d note disappears.\n\nLog out anyway?"
      : "Log out of MediStock?";
    if (!confirm(msg)) return;
    try {
      var m = await import(FB + "firebase-auth.js");
      await m.getAuth().signOut();
      location.href = "login.html";
    } catch (e) {
      alert("Couldn't log out: " + (e && e.message ? e.message : e));
    }
  });

  // ---------- keep the app available with no internet ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
