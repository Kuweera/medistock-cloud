/* MediStock Cloud — shared menu, offline helpers and sync status.
   To add a page to the menu, add one line to ITEMS below and upload this file only. */
(function () {
  var ITEMS = [
    ["dashboard.html", "Dashboard"],
    ["sales.html", "Sell"],
    ["purchases.html", "Purchases"],
    ["inventory.html", "Inventory"],
    ["history.html", "Business History"],
    ["charts.html", "Charts"],
    ["reports.html", "Profit & Reports"],
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
    ["backup.html", "Backup & Export"],
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
  pill.style.cssText = "position:fixed;left:10px;bottom:66px;z-index:9999;padding:7px 13px;border-radius:999px;font:600 12px system-ui,sans-serif;display:none;box-shadow:0 2px 8px rgba(0,0,0,.35);";
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


  // ---------- drafts: unfinished carts / forms survive switching pages ----------
  window.mcDraft = {
    save: function (name, value) { try { localStorage.setItem("mcDraft:" + name, JSON.stringify({ t: Date.now(), v: value })); } catch (e) {} },
    load: function (name, maxAgeMs) {
      try {
        var r = JSON.parse(localStorage.getItem("mcDraft:" + name) || "null");
        if (!r) return null;
        if (maxAgeMs && Date.now() - r.t > maxAgeMs) return null;
        return r.v;
      } catch (e) { return null; }
    },
    clear: function (name) { try { localStorage.removeItem("mcDraft:" + name); } catch (e) {} }
  };

  // ---------- calculator: floats over the page, never touches what you're doing ----------
  (function () {
    var lastField = null;
    document.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !t.closest("#mcCalc") && t.type !== "checkbox" && t.type !== "radio" && t.type !== "button") lastField = t;
    });
    var fab = document.createElement("button");
    fab.type = "button"; fab.id = "mcCalcBtn"; fab.setAttribute("aria-label", "Calculator"); fab.textContent = "\ud83e\uddee";
    fab.style.cssText = "position:fixed;right:12px;bottom:66px;z-index:9998;width:46px;height:46px;border-radius:50%;border:none;background:#2abfa0;color:#fff;font-size:22px;box-shadow:0 2px 10px rgba(0,0,0,.4);cursor:pointer;padding:0;";
    var box = document.createElement("div");
    box.id = "mcCalc";
    box.style.cssText = "position:fixed;right:10px;bottom:120px;z-index:9998;width:min(300px,92vw);background:#16201e;color:#fff;border:1px solid #2abfa0;border-radius:14px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.55);display:none;font-family:system-ui,sans-serif;";
    var keys = ["C", "\u232b", "%", "\u00f7", "7", "8", "9", "\u00d7", "4", "5", "6", "\u2212", "1", "2", "3", "+", "0", ".", "(", ")"];
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><b style="font-size:13px;color:#2abfa0;">Calculator</b><button type="button" id="mcCalcClose" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px;">\u2715</button></div>' +
      '<div id="mcCalcExpr" style="min-height:20px;font-size:13px;color:#9fb3ae;text-align:right;word-break:break-all;"></div>' +
      '<div id="mcCalcOut" style="font-size:26px;font-weight:700;text-align:right;margin-bottom:8px;word-break:break-all;">0</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">';
    keys.forEach(function (k) {
      var op = "\u00f7\u00d7\u2212+%".indexOf(k) >= 0, c = k === "C" || k === "\u232b";
      h += '<button type="button" data-k="' + k + '" style="padding:12px 0;font-size:17px;font-weight:600;border:none;border-radius:9px;cursor:pointer;background:' + (op ? "#2abfa0" : c ? "#6b3a3a" : "#26332f") + ';color:#fff;">' + k + '</button>';
    });
    h += '<button type="button" data-k="=" style="grid-column:span 4;padding:12px 0;font-size:18px;font-weight:700;border:none;border-radius:9px;cursor:pointer;background:#2abfa0;color:#fff;">=</button></div>' +
      '<div style="display:flex;gap:6px;margin-top:8px;"><button type="button" id="mcCalcIns" style="flex:1;padding:9px;border-radius:9px;border:1px solid #2abfa0;background:none;color:#2abfa0;font-weight:600;cursor:pointer;">Use in field</button><button type="button" id="mcCalcCopy" style="flex:1;padding:9px;border-radius:9px;border:1px solid #2abfa0;background:none;color:#2abfa0;font-weight:600;cursor:pointer;">Copy</button></div>';
    box.innerHTML = h;
    (document.body || document.documentElement).appendChild(fab);
    (document.body || document.documentElement).appendChild(box);

    var expr = "", result = "";
    try { var sv = JSON.parse(localStorage.getItem("mcCalcState") || "null"); if (sv) { expr = sv.e || ""; result = sv.r || ""; } } catch (e) {}
    function persist() { try { localStorage.setItem("mcCalcState", JSON.stringify({ e: expr, r: result })); } catch (e) {} }
    function show() { box.querySelector("#mcCalcExpr").textContent = expr; box.querySelector("#mcCalcOut").textContent = result !== "" ? result : (expr || "0"); }
    // small safe parser: + - × ÷ % and brackets (no eval)
    function evaluate(src) {
      var t = src.replace(/\u00d7/g, "*").replace(/\u00f7/g, "/").replace(/\u2212/g, "-"), i = 0;
      // "1500 + 20%" means 1500 plus 20% OF 1500 (like a shop calculator), not 1500.2
      t = t.replace(/([0-9.]+)([+\-])([0-9.]+)%/g, "$1$2($1*$3/100)");
      function peek() { return t.charAt(i); }
      function num() {
        var st = i; while (/[0-9.]/.test(peek())) i++;
        if (st === i) throw new Error("x");
        var v = parseFloat(t.slice(st, i)); if (isNaN(v)) throw new Error("x");
        while (peek() === "%") { i++; v = v / 100; }
        return v;
      }
      function atom() {
        if (peek() === "(") { i++; var v = expr1(); if (peek() !== ")") throw new Error("x"); i++; while (peek() === "%") { i++; v = v / 100; } return v; }
        if (peek() === "-") { i++; return -atom(); }
        return num();
      }
      function term() { var v = atom(); while (peek() === "*" || peek() === "/") { var o = t.charAt(i++), r = atom(); v = o === "*" ? v * r : v / r; } return v; }
      function expr1() { var v = term(); while (peek() === "+" || peek() === "-") { var o = t.charAt(i++), r = term(); v = o === "+" ? v + r : v - r; } return v; }
      var out = expr1(); if (i !== t.length) throw new Error("x");
      if (!isFinite(out)) throw new Error("x");
      return Math.round(out * 1e8) / 1e8;
    }
    function press(k) {
      if (k === "C") { expr = ""; result = ""; }
      else if (k === "\u232b") { expr = expr.slice(0, -1); result = ""; }
      else if (k === "=") { try { result = String(evaluate(expr)); } catch (e) { result = "Error"; } }
      else { if (result !== "" && result !== "Error" && /[0-9.(]/.test(k) && expr === "") expr = ""; if (result !== "" && result !== "Error" && "+\u2212\u00d7\u00f7%".indexOf(k) >= 0 && /^[0-9.\-]+$/.test(result)) expr = result; if (result !== "") result = ""; expr += k; }
      persist(); show();
    }
    box.addEventListener("pointerdown", function (e) { if (e.target.tagName === "BUTTON") e.preventDefault(); }); // keep focus where it was
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.id === "mcCalcClose") { box.style.display = "none"; return; }
      if (b.id === "mcCalcCopy") { var v = result !== "" && result !== "Error" ? result : ""; if (v && navigator.clipboard) navigator.clipboard.writeText(v).catch(function () {}); return; }
      if (b.id === "mcCalcIns") {
        if (result === "" || result === "Error") { press("="); }
        if (lastField && result !== "" && result !== "Error") {
          lastField.value = result;
          lastField.dispatchEvent(new Event("input", { bubbles: true }));
          lastField.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (b.dataset.k) press(b.dataset.k);
    });
    fab.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    fab.addEventListener("click", function () { box.style.display = box.style.display === "none" ? "block" : "none"; if (box.style.display === "block") show(); });
  })();

  // ---------- keep the app available with no internet ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
