/* MediStock Cloud — shared menu, offline helpers, sync status, calculator and install button.
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
    ["migrate.html", "Import from Pro"],
    ["settings.html", "Settings"]
  ];
  var FB = "https://www.gstatic.com/firebasejs/12.19.0/";
  var body = document.body || document.documentElement;

  // ---------- menu ----------
  var panel = document.getElementById("navPanel");
  var out = null, installBtn = null;
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
    installBtn = document.createElement("button");
    installBtn.type = "button";
    installBtn.className = "theme-toggle";
    installBtn.id = "installBtn";
    installBtn.style.display = "none";
    installBtn.textContent = "\ud83d\udcf2 Install app on this phone";
    panel.appendChild(installBtn);
    out = document.createElement("button");
    out.type = "button";
    out.className = "theme-toggle";
    out.id = "logoutBtn";
    out.textContent = "\ud83d\udeaa Log out";
    panel.appendChild(out);
  }

  // ---------- install as an app (home-screen icon, opens full screen, works offline) ----------
  var deferredInstall = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferredInstall = e;
    if (installBtn) installBtn.style.display = "";
  });
  window.addEventListener("appinstalled", function () { deferredInstall = null; if (installBtn) installBtn.style.display = "none"; });
  if (installBtn) installBtn.addEventListener("click", function () {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall.userChoice.then(function () { deferredInstall = null; installBtn.style.display = "none"; });
  });

  // ---------- sync status: a small note under the online/offline badge, on the green bar ----------
  var pending = 0, problem = null, bootPending = false, dbHandle = null;
  var bar = document.querySelector(".nav-bar");
  var pill = document.createElement("div");
  pill.id = "syncPill";
  if (bar) {
    if (getComputedStyle(bar).position === "static") bar.style.position = "relative";
    pill.style.cssText = "position:absolute;right:10px;bottom:3px;padding:1px 9px;border-radius:999px;font:700 10.5px/1.5 system-ui,sans-serif;display:none;z-index:2;";
    bar.appendChild(pill);
  } else {
    pill.style.cssText = "position:fixed;right:10px;top:6px;padding:2px 10px;border-radius:999px;font:700 11px system-ui,sans-serif;display:none;z-index:9999;";
    body.appendChild(pill);
  }
  function paint() {
    var show = true;
    if (problem) { pill.style.background = "#e5534b"; pill.style.color = "#fff"; pill.textContent = "\u26a0 A change was not saved \u2014 tap"; }
    else if (pending > 0 || bootPending) { pill.style.background = "#f0b429"; pill.style.color = "#222"; pill.textContent = "\u23f3 Changes waiting to sync" + (pending > 1 ? " (" + pending + ")" : ""); }
    else show = false;
    pill.style.display = show ? "block" : "none";
    if (bar) bar.style.paddingBottom = show ? "20px" : "";
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

  // ---------- calculator: slides up from the bottom, answers as you type, never touches the page behind it ----------
  (function () {
    var lastField = null;
    document.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !t.closest("#mcCalc") && t.type !== "checkbox" && t.type !== "radio" && t.type !== "button") lastField = t;
    });

    // --- the round button: drag it anywhere, tap it to open ---
    var fab = document.createElement("button");
    fab.type = "button"; fab.id = "mcCalcBtn"; fab.setAttribute("aria-label", "Calculator"); fab.textContent = "\ud83e\uddee";
    fab.style.cssText = "position:fixed;left:0;top:0;z-index:9997;width:48px;height:48px;border-radius:50%;border:none;background:#2abfa0;color:#fff;font-size:23px;box-shadow:0 2px 10px rgba(0,0,0,.4);cursor:grab;padding:0;touch-action:none;user-select:none;-webkit-user-select:none;";
    var SIZE = 48;
    function clampPos(x, y) {
      return { x: Math.max(4, Math.min(window.innerWidth - SIZE - 4, x)), y: Math.max(4, Math.min(window.innerHeight - SIZE - 4, y)) };
    }
    function place(x, y) { var p = clampPos(x, y); fab.style.left = p.x + "px"; fab.style.top = p.y + "px"; return p; }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("mcCalcPos") || "null"); } catch (e) {}
    if (saved && typeof saved.x === "number") place(saved.x * window.innerWidth, saved.y * window.innerHeight);
    else place(window.innerWidth - SIZE - 12, window.innerHeight - SIZE - 80);
    window.addEventListener("resize", function () { place(parseFloat(fab.style.left) || 0, parseFloat(fab.style.top) || 0); });

    var drag = null;
    fab.addEventListener("pointerdown", function (e) {
      drag = { sx: e.clientX, sy: e.clientY, ox: parseFloat(fab.style.left) || 0, oy: parseFloat(fab.style.top) || 0, moved: false, id: e.pointerId };
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); // keep focus (and the keyboard) where it was
    });
    fab.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
      if (drag.moved) place(drag.ox + dx, drag.oy + dy);
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null;
      if (d.moved) {
        var x = parseFloat(fab.style.left) || 0, y = parseFloat(fab.style.top) || 0;
        try { localStorage.setItem("mcCalcPos", JSON.stringify({ x: x / window.innerWidth, y: y / window.innerHeight })); } catch (err) {}
      } else openSheet();
    }
    fab.addEventListener("pointerup", endDrag);
    fab.addEventListener("pointercancel", function () { drag = null; });

    // --- the sheet ---
    var box = document.createElement("div");
    box.id = "mcCalc";
    box.style.cssText = "position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:520px;z-index:9998;background:#16201e;color:#fff;border:1px solid #2abfa0;border-bottom:none;border-radius:18px 18px 0 0;padding:8px 12px calc(14px + env(safe-area-inset-bottom));box-shadow:0 -6px 24px rgba(0,0,0,.5);font-family:system-ui,sans-serif;transform:translateY(105%);transition:transform .22s ease;pointer-events:none;";
    var keys = ["C", "\u232b", "%", "\u00f7", "7", "8", "9", "\u00d7", "4", "5", "6", "\u2212", "1", "2", "3", "+", "0", ".", "(", ")"];
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;"><div style="width:38px;height:4px;border-radius:2px;background:#3a4a46;margin:0 auto 0 calc(50% - 19px);position:absolute;left:0;top:6px;"></div><b style="font-size:13px;color:#2abfa0;margin-top:8px;">Calculator</b><button type="button" id="mcCalcClose" aria-label="Close" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;padding:4px 6px;margin-top:6px;">\u2715</button></div>' +
      '<div id="mcCalcExpr" style="min-height:18px;font-size:14px;color:#9fb3ae;text-align:right;word-break:break-all;"></div>' +
      '<div id="mcCalcOut" style="font-size:32px;font-weight:700;text-align:right;margin:2px 0 8px;word-break:break-all;">0</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;">';
    keys.forEach(function (k) {
      var op = "\u00f7\u00d7\u2212+%".indexOf(k) >= 0, c = k === "C" || k === "\u232b";
      h += '<button type="button" data-k="' + k + '" style="padding:15px 0;font-size:20px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:' + (op ? "#2abfa0" : c ? "#6b3a3a" : "#26332f") + ';color:#fff;">' + k + '</button>';
    });
    h += '</div><div style="display:flex;gap:8px;margin-top:10px;"><button type="button" id="mcCalcIns" style="flex:1;padding:12px;border-radius:10px;border:1px solid #2abfa0;background:none;color:#2abfa0;font-weight:700;font-size:14px;cursor:pointer;">Use in field</button><button type="button" id="mcCalcCopy" style="flex:1;padding:12px;border-radius:10px;border:1px solid #2abfa0;background:none;color:#2abfa0;font-weight:700;font-size:14px;cursor:pointer;">Copy</button></div>';
    box.innerHTML = h;
    body.appendChild(fab);
    body.appendChild(box);

    var expr = "", result = "";
    try { expr = localStorage.getItem("mcCalcExpr") || ""; } catch (e) {}

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
    // answer as you type: ignore a dangling operator, close any open brackets
    function live(src) {
      var s = src.replace(/[+\u2212\u00d7\u00f7.]+$/, "");
      var open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
      while (open-- > 0) s += ")";
      if (!s) return "";
      try { return String(evaluate(s)); } catch (e) { return ""; }
    }
    function show() {
      result = live(expr);
      box.querySelector("#mcCalcExpr").textContent = expr;
      var out = box.querySelector("#mcCalcOut");
      out.textContent = result !== "" ? Number(result).toLocaleString(undefined, { maximumFractionDigits: 8 }) : (expr ? "…" : "0");
      try { localStorage.setItem("mcCalcExpr", expr); } catch (e) {}
    }
    function press(k) {
      var ops = "+\u2212\u00d7\u00f7";
      if (k === "C") expr = "";
      else if (k === "\u232b") expr = expr.slice(0, -1);
      else if (ops.indexOf(k) >= 0) {
        if (!expr && k !== "\u2212") return;
        if (ops.indexOf(expr.slice(-1)) >= 0) expr = expr.slice(0, -1); // replace, don't stack operators
        expr += k;
      } else expr += k;
      show();
    }
    function openSheet() { box.style.transform = "translateY(0)"; box.style.pointerEvents = "auto"; fab.style.display = "none"; show(); }
    function closeSheet() { box.style.transform = "translateY(105%)"; box.style.pointerEvents = "none"; fab.style.display = ""; }
    box.addEventListener("pointerdown", function (e) { if (e.target.closest("button")) e.preventDefault(); }); // keep focus where it was
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.id === "mcCalcClose") { closeSheet(); return; }
      if (b.id === "mcCalcCopy") { if (result !== "" && navigator.clipboard) navigator.clipboard.writeText(result).catch(function () {}); return; }
      if (b.id === "mcCalcIns") {
        if (lastField && result !== "") {
          lastField.value = result;
          lastField.dispatchEvent(new Event("input", { bubbles: true }));
          lastField.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (b.dataset.k) press(b.dataset.k);
    });
    window.mcCalcLive = live; // (used by tests)
  })();

  // ---------- keep the app available with no internet ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
