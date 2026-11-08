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
    ["guide.html", "User Guide"],
    ["about.html", "Developer & Support"],
    ["settings.html", "Settings"]
  ];
  var FB = "https://www.gstatic.com/firebasejs/12.19.0/";
  var body = document.body || document.documentElement;
  var MC = (window.top !== window && window.top.MC) ? window.top.MC : null;

  // Moving between screens: inside the app shell this just switches screens (nothing reloads).
  window.mcGo = function (u) {
    if (MC && MC.go) MC.go(u, window); else if (window.top !== window) window.top.location.href = u; else window.location.href = u;
  };
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || !MC || e.defaultPrevented || e.metaKey || e.ctrlKey || a.target === "_blank" || a.hasAttribute("download")) return;
    var h = a.getAttribute("href");
    if (!h || /^(https?:|mailto:|tel:|#|javascript:|blob:)/i.test(h) || !/\.html(\?|$)/i.test(h)) return;
    e.preventDefault(); window.mcGo(h);
  }, true);
  // the Home button always goes to the dashboard, whatever screen the app is on
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".nav-bar-brand") : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (MC && MC.home) MC.home(); else window.mcGo("dashboard.html");
  }, true);
  // dark/light chosen on one screen applies to the screens kept open behind it
  window.addEventListener("storage", function (e) {
    if (e.key !== "mcThemePreference") return;
    var pref = e.newValue || "auto", dark = pref === "dark" || (pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  });

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
    installBtn.textContent = "\ud83d\udcf2 Install app on this device";
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
  function checkShellInstall() { if (MC && MC.deferredInstall && installBtn) installBtn.style.display = ""; }
  setTimeout(checkShellInstall, 600);
  window.addEventListener("mc-show", checkShellInstall);
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferredInstall = e;
    if (installBtn) installBtn.style.display = "";
  });
  window.addEventListener("appinstalled", function () { deferredInstall = null; if (installBtn) installBtn.style.display = "none"; });
  if (installBtn) installBtn.addEventListener("click", function () {
    if (!deferredInstall && MC && MC.deferredInstall) {
      var ev = MC.deferredInstall; MC.deferredInstall = null; ev.prompt(); installBtn.style.display = "none"; return;
    }
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall.userChoice.then(function () { deferredInstall = null; installBtn.style.display = "none"; });
  });

  // ---------- sync status: a small note under the online/offline badge, on the green bar ----------
  var pending = 0, problem = null, bootPending = false;
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
    else if (pending > 0 || bootPending || (MC && MC.pendingDocs && MC.pendingDocs() > 0)) { pill.style.background = "#f0b429"; pill.style.color = "#222"; pill.textContent = "\u23f3 Changes waiting to sync" + (function () { var n = Math.max(pending, MC && MC.pendingDocs ? MC.pendingDocs() : 0); return n > 1 ? " (" + n + ")" : ""; })(); }
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

  if (MC && MC.onSync) { MC.onSync(paint); paint(); }

  // ---------- log out (warns if anything hasn't reached the server yet) ----------
  if (out) out.addEventListener("click", async function () {
    var unsynced = pending > 0 || (MC && MC.pendingDocs && MC.pendingDocs() > 0);
    try { if (MC && MC.waitForPendingWrites) { var ok = await MC.waitForPendingWrites(1500); if (!ok) unsynced = true; } } catch (e) {}
    var msg = unsynced
      ? "Some changes have NOT reached the server yet. Logging out now can lose them.\n\nStay signed in until the \u201cwaiting to sync\u201d note disappears.\n\nLog out anyway?"
      : "Log out of MediStock?";
    if (!confirm(msg)) return;
    try {
      if (MC && MC.logout) await MC.logout();
      window.top.location.href = "login.html";
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
    // keep the position as a fraction of the window so it stays in the same corner when a PC window is resized
    // or when screens that were loaded at another size are shown (pixel positions drifted to the middle of the page)
    var frac = (saved && typeof saved.x === "number") ? { x: saved.x, y: saved.y } : { x: (window.innerWidth - SIZE - 12) / window.innerWidth, y: (window.innerHeight - SIZE - 80) / window.innerHeight };
    function placeFrac() { if (window.innerWidth > 0) place(frac.x * window.innerWidth, frac.y * window.innerHeight); }
    placeFrac();
    window.addEventListener("resize", placeFrac);

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
        frac = { x: x / window.innerWidth, y: y / window.innerHeight };
        try { localStorage.setItem("mcCalcPos", JSON.stringify(frac)); } catch (err) {}
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
  if (window.top === window && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();


/* Remembers where you were on a long list, so after editing something you come back to the same place instead of the top.
   mcPos.save("key") when opening an edit/detail view, mcPos.restore("key") when closing it. */
(function () {
  var m = {};
  window.mcPos = {
    save: function (k) { m[k] = window.pageYOffset || document.documentElement.scrollTop || 0; },
    restore: function (k, delay) {
      if (m[k] == null) return;
      var y = m[k]; delete m[k];
      var go = function () { window.scrollTo({ top: y, behavior: "auto" }); };
      setTimeout(go, delay || 60); setTimeout(go, (delay || 60) + 250);   // again after lists finish redrawing
    },
    focus: function (id, delay) { setTimeout(function () { var el = document.getElementById(id); if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } } }, delay || 380); }
  };
})();

/* PC extras: keyboard shortcuts, the alerts bell (low stock / expiring / expired, from the data already on this device),
   and hiding Print buttons inside the phone app (the phone saves a PDF instead). */
(function () {
  var top = window.top, MC = null;
  try { MC = top.MC; } catch (e) {}
  try {
    var C = top.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform()) { var st = document.createElement("style"); st.textContent = ".mc-print{display:none!important}"; document.head.appendChild(st); }
  } catch (e) {}
  function wide() { return window.innerWidth >= 900; }
  function typing(el) { return el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); }

  // ---------- shortcuts ----------
  var KEYS = [["F2", "sales.html", "Sell"], ["F3", "purchases.html", "Purchases"], ["F4", "inventory.html", "Inventory"], ["F8", "history.html", "Business History"], ["F9", "reports.html", "Profit & Reports"]];
  function help() {
    var o = document.getElementById("mcKeyHelp");
    if (o) { o.remove(); return; }
    o = document.createElement("div"); o.id = "mcKeyHelp";
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center";
    var rows = KEYS.map(function (k) { return "<tr><td><kbd>" + k[0] + "</kbd></td><td>" + k[2] + "</td></tr>"; }).join("") +
      "<tr><td><kbd>/</kbd></td><td>Jump to the search box</td></tr><tr><td><kbd>Enter</kbd></td><td>In Sell: add the first match / add to cart</td></tr><tr><td><kbd>?</kbd></td><td>Show or hide this list</td></tr><tr><td><kbd>Esc</kbd></td><td>Close</td></tr>";
    o.innerHTML = '<div style="background:var(--card,#fff);color:var(--text,#16241f);border-radius:14px;padding:20px 24px;min-width:300px;box-shadow:0 10px 40px rgba(0,0,0,.4)"><div style="font-weight:800;font-size:17px;margin-bottom:10px">Keyboard shortcuts</div><table style="border-collapse:collapse;font-size:14px;line-height:2">' + rows + "</table></div>";
    o.querySelectorAll("kbd").forEach(function (k) { k.style.cssText = "border:1px solid var(--border,#ccc);border-radius:6px;padding:1px 8px;font:700 12px monospace;margin-right:14px;background:rgba(127,127,127,.12)"; });
    o.addEventListener("click", function () { o.remove(); });
    document.body.appendChild(o);
  }
  function onKey(e) {
    if (!wide() || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === "Escape") { var h = document.getElementById("mcKeyHelp"); if (h) h.remove(); closeBell(); return; }
    for (var i = 0; i < KEYS.length; i++) if (k === KEYS[i][0]) { e.preventDefault(); window.mcGo(KEYS[i][1]); return; }
    if (typing(document.activeElement)) return;
    if (k === "/") { var s = document.getElementById("searchBox"); if (s) { e.preventDefault(); s.focus(); s.select && s.select(); } }
    else if (k === "?") { e.preventDefault(); help(); }
  }
  // keys are heard whether the cursor is inside the screen or on the app frame around it; only the visible screen answers
  function mine() { try { var fe = window.frameElement; return !fe || (fe.isConnected && fe.getClientRects().length > 0 && getComputedStyle(fe).visibility !== "hidden"); } catch (e) { return true; } }
  function onKeyOnce(e) { if (e.__mcKey || !mine()) return; e.__mcKey = 1; onKey(e); }
  document.addEventListener("keydown", onKeyOnce);
  try { if (top !== window) top.document.addEventListener("keydown", onKeyOnce); } catch (e) {}
  setTimeout(function () { try { if (wide() && mine() && !typing(document.activeElement)) window.focus(); } catch (e) {} }, 500);
  window.addEventListener("mc-show", function () { setTimeout(function () { try { if (wide()) window.focus(); } catch (e) {} }, 100); });
  // "Save to Phone" only makes sense in the phone app; on a computer the same button downloads a file
  var isNat = false; try { isNat = !!(top.Capacitor && top.Capacitor.isNativePlatform && top.Capacitor.isNativePlatform()); } catch (e) {}
  if (!isNat) {
    var relabel = function () { document.querySelectorAll("button").forEach(function (b) { if (b.textContent.trim() === "Save to Phone") b.textContent = "Download text"; }); };
    var rt = null;
    new MutationObserver(function () { clearTimeout(rt); rt = setTimeout(relabel, 60); }).observe(document.documentElement, { childList: true, subtree: true });
    relabel();
  }
  window.mcKeyHelp = help;

  // ---------- alerts bell ----------
  var bar = document.querySelector(".nav-bar"), bell = null, box = null;
  function rows(coll) {
    var seen = {}, out = [];
    ((MC && MC.entries) || []).forEach(function (e) { if (e.coll !== coll) return; e.rows.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = 1; var o = {}; for (var k in r.d) o[k] = r.d[k]; o.id = r.id; out.push(o); } }); });
    return out;
  }
  function day(s) {
    if (!s) return null;
    if (typeof s.toDate === "function") { var t = s.toDate(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(s)); if (!m) return null;
    return m[3] ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(+m[1], +m[2], 0);   // "YYYY-MM" means the end of that month
  }
  function alerts() {
    var out = [], now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var low = rows("drugs").filter(function (d) { return d.active !== false && Number(d.reorderLevel) > 0 && Number(d.currentStockBase || 0) <= Number(d.reorderLevel) * Number(d.baseUnitsPerStock || 1); });
    var exp = [], soon = [];
    rows("batches").forEach(function (b) {
      if (!(Number(b.quantity) > 0)) return;
      var ex = day(b.expiryDate); if (!ex) return;
      var n = Math.round((ex - today) / 86400000);
      if (n < 0) exp.push(b); else if (n <= 30) soon.push(b);
    });
    function nm(l, k) { var u = []; l.forEach(function (x) { if (x[k] && u.indexOf(x[k]) < 0) u.push(x[k]); }); return u.slice(0, 3).join(", ") + (u.length > 3 ? " +" + (u.length - 3) + " more" : ""); }
    if (exp.length) out.push({ c: "#e5484d", t: exp.length + " expired batch" + (exp.length > 1 ? "es" : "") + " still in stock", s: nm(exp, "drugName"), u: "batches.html?filter=expired" });
    if (low.length) out.push({ c: "#f0b429", t: low.length + " drug" + (low.length > 1 ? "s" : "") + " low on stock", s: nm(low, "name"), u: "inventory.html?low=1" });
    if (soon.length) out.push({ c: "#f0b429", t: soon.length + " batch" + (soon.length > 1 ? "es" : "") + " expiring within 30 days", s: nm(soon, "drugName"), u: "expiring.html?w=30" });
    return out;
  }
  function closeBell() { if (box) box.style.display = "none"; }
  function paintBell() {
    if (!bell) return;
    var a = alerts();
    bell.textContent = "🔔" + (a.length ? " " + a.length : "");
    bell.style.background = a.length ? "#f0b429" : "rgba(255,255,255,.2)"; bell.style.color = a.length ? "#222" : "#fff";
    box.innerHTML = a.length ? a.map(function (x, i) { return '<div data-i="' + i + '" style="padding:9px 12px;border-left:4px solid ' + x.c + ';cursor:pointer;border-bottom:1px solid rgba(127,127,127,.2)"><b style="font-size:13.5px"></b><div style="font-size:12px;opacity:.75"></div></div>'; }).join("") : '<div style="padding:12px;font-size:13px;opacity:.75">No alerts. Stock levels and expiry dates look fine.</div>';
    a.forEach(function (x, i) { var d = box.querySelector('[data-i="' + i + '"]'); d.querySelector("b").textContent = x.t; d.querySelector("div").textContent = x.s; d.onclick = function () { closeBell(); window.mcGo(x.u); }; });
  }
  function initBell() {
    if (bell || !bar || !MC || !wide()) return;
    bell = document.createElement("button"); bell.type = "button"; bell.id = "mcBell";
    bell.style.cssText = "border:0;border-radius:999px;padding:3px 12px;font:700 13px system-ui,sans-serif;cursor:pointer;margin-right:10px;color:#fff;background:rgba(255,255,255,.2)";
    bell.title = "Alerts";
    box = document.createElement("div");
    box.style.cssText = "display:none;position:absolute;right:14px;top:100%;width:340px;max-width:92vw;background:var(--card,#fff);color:var(--text,#16241f);border:1px solid var(--border,#ccc);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);z-index:40;overflow:hidden";
    var kb = document.createElement("button"); kb.type = "button"; kb.textContent = "⌨ Shortcuts"; kb.title = "Keyboard shortcuts (press ?)";
    kb.style.cssText = "border:0;border-radius:999px;padding:3px 12px;font:700 12.5px system-ui,sans-serif;cursor:pointer;margin-right:10px;color:#fff;background:rgba(255,255,255,.2)";
    kb.onclick = help;
    bar.appendChild(kb); bar.appendChild(bell); bar.appendChild(box);
    if (getComputedStyle(bar).position === "static") bar.style.position = "relative";
    bell.onclick = function (e) { e.stopPropagation(); paintBell(); box.style.display = box.style.display === "block" ? "none" : "block"; };
    document.addEventListener("click", function (e) { if (!box.contains(e.target)) closeBell(); });
    paintBell();
    if (MC.onSync) MC.onSync(paintBell);
    setInterval(paintBell, 60000);
  }
  window.addEventListener("mc-show", function () { initBell(); paintBell(); });
  setTimeout(initBell, 800);
  window.addEventListener("resize", function () { if (bell) { var w = wide(); bell.style.display = w ? "" : "none"; if (bell.previousSibling) bell.previousSibling.style.display = w ? "" : "none"; } });
})();
