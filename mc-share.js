/* MediStock Cloud — sharing and saving text (receipts, reports, lists, logins).
   mcShareText(text, title): opens a small box with "Share to an app" (the phone's own app list: WhatsApp, Telegram, email...) and "Copy".
   mcSaveText(name, text, mime): saves a file into the phone's Downloads/MediStock folder (in the app) or downloads it (in Chrome).
   Works the same in the Android app and in Chrome. Screens call window.top.mcShareText / window.top.mcSaveText. */
(function () {
  function plug(n) {
    var c = window.Capacitor;
    try { var p = c && c.Plugins && c.Plugins[n]; if (p) return p; if (c && typeof c.registerPlugin === "function") return c.registerPlugin(n); } catch (e) {}
    return null;
  }
  function isNative() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }

  async function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
    try {
      var t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(t); t.focus(); t.select(); var ok = document.execCommand("copy"); document.body.removeChild(t); return !!ok;
    } catch (e) { return false; }
  }
  async function shareToApps(text, title) {
    if (isNative()) {
      var SH = plug("Share");
      if (SH) { await SH.share({ title: title || "MediStock", text: text, dialogTitle: "Share with…" }); return true; }
      if (!navigator.share) throw new Error("this app build has no share plugin. Use Copy text instead.");
    }
    if (navigator.share) { await navigator.share({ title: title || "MediStock", text: text }); return true; }
    throw new Error("This browser cannot open the app list. Use Copy instead.");
  }

  window.mcShareText = function (text, title) {
    return new Promise(function (resolve) {
      var dark = document.documentElement.getAttribute("data-theme") !== "light";
      var bg = dark ? "#16241f" : "#ffffff", fg = dark ? "#e7f2ee" : "#16241f", mut = dark ? "#9fb6ae" : "#5b6b66", bd = dark ? "#2a3934" : "#d6e0dc";
      var o = document.createElement("div");
      o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:flex-end;justify-content:center;font-family:-apple-system,Roboto,Arial,sans-serif";
      var btn = "width:100%;box-sizing:border-box;border-radius:11px;padding:13px;font-size:16px;font-weight:700;margin-top:8px;border:1px solid #2bbfa0;";
      o.innerHTML = '<div style="background:' + bg + ';color:' + fg + ';width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:16px;box-sizing:border-box">' +
        '<div id="mcsTitle" style="font-size:17px;font-weight:700;margin-bottom:8px"></div>' +
        '<pre id="mcsText" style="margin:0 0 6px;max-height:140px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;color:' + mut + ';border:1px solid ' + bd + ';border-radius:8px;padding:8px"></pre>' +
        '<button id="mcsApps" style="' + btn + 'background:#2bbfa0;color:#06201a">Share to an app (WhatsApp, Telegram, email…)</button>' +
        '<button id="mcsCopy" style="' + btn + 'background:transparent;color:#2bbfa0">Copy text</button>' +
        '<button id="mcsCancel" style="' + btn + 'background:transparent;color:' + mut + ';border-color:' + bd + '">Cancel</button>' +
        '<div id="mcsMsg" style="font-size:13px;margin-top:8px;min-height:16px;color:' + mut + '"></div></div>';
      o.querySelector("#mcsTitle").textContent = title || "Share";
      o.querySelector("#mcsText").textContent = text;
      var msg = o.querySelector("#mcsMsg");
      function done(r) { try { o.remove(); } catch (e) {} resolve(r); }
      o.addEventListener("click", function (e) { if (e.target === o) done("cancel"); });
      o.querySelector("#mcsCancel").onclick = function () { done("cancel"); };
      o.querySelector("#mcsCopy").onclick = async function () {
        var ok = await copyText(text);
        if (!ok) { try { var rg = document.createRange(); rg.selectNodeContents(o.querySelector("#mcsText")); var sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(rg); } catch (e) {} }
        msg.textContent = ok ? "Copied. Paste it into any app." : "Could not copy automatically. The text above is selected: press and hold it, then tap Copy.";
        msg.style.color = ok ? "#2bbfa0" : "#e5484d";
        if (ok) setTimeout(function () { done("copied"); }, 900);
      };
      o.querySelector("#mcsApps").onclick = async function () {
        try { await shareToApps(text, title); done("shared"); }
        catch (e) { var m = String((e && (e.message || e.code)) || e); if (/cancel|abort/i.test(m)) return; msg.textContent = m; msg.style.color = "#e5484d"; }
      };
      document.body.appendChild(o);
    });
  };

  window.mcSaveText = async function (name, text, mime) {
    mime = mime || "text/plain";
    if (isNative()) {
      var MS = plug("MediaSaver");
      try {
        if (!MS) throw new Error("this app build has no save plugin");
        var r = await MS.save({ name: name, data: text, mime: mime });
        return "Saved to your phone: " + r.path + " (Files app > Downloads > MediStock)";
      } catch (e) {
        var why = String((e && (e.message || e.code)) || e);
        await window.mcShareText(text, name);
        return "Could not save directly (" + why + "). Use Share to keep a copy.";
      }
    }
    var blob = new Blob([text], { type: mime }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    return "Downloaded: " + name + " (see your Downloads folder)";
  };
  // ---- print (PC) and PDF (PC and phone) ----
  function asciiSafe(s) {
    return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00b7\u2022]/g, "-").replace(/[\u2014\u2013]/g, "-")
      .replace(/\u2026/g, "...").replace(/\u00d7/g, "x").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\t/g, "    ").replace(/[^\x20-\x7e\n]/g, "?");
  }
  // A small plain-text PDF made by hand (pure ASCII, so it also saves correctly through the phone's text saver).
  function makePdf(text, title) {
    var lines = [], W = 62, LPP = 64, LH = 11.5, FS = 9;
    asciiSafe(text).split("\n").forEach(function (l) { l = l.replace(/\s+$/, ""); if (!l) { lines.push(""); return; } while (l.length > W) { var cut = l.lastIndexOf(" ", W); if (cut < 20) cut = W; lines.push(l.slice(0, cut)); l = l.slice(cut).replace(/^\s+/, ""); } lines.push(l); });
    var longest = 0; lines.forEach(function (l) { if (l.length > longest) longest = l.length; });
    var pw = Math.max(240, Math.round(longest * FS * 0.6 + 56)), pages = [];
    for (var i = 0; i < lines.length; i += LPP) pages.push(lines.slice(i, i + LPP));
    if (!pages.length) pages.push([""]);
    var objs = [], n = 4 + pages.length * 2;
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = pages.map(function (p, k) { return (4 + k * 2) + " 0 R"; }).join(" ");
    objs[2] = "<< /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
    pages.forEach(function (p, k) {
      var ph = Math.round(p.length * LH + 56), y = ph - 30, c = "BT /F1 " + FS + " Tf " + LH + " TL 28 " + y + " Td\n";
      p.forEach(function (l) { c += "(" + l.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ") '\n"; });
      c += "ET";
      objs[4 + k * 2] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Resources << /Font << /F1 3 0 R >> >> /Contents " + (5 + k * 2) + " 0 R >>";
      objs[5 + k * 2] = "<< /Length " + c.length + " >>\nstream\n" + c + "\nendstream";
    });
    var out = "%PDF-1.4\n", off = [];
    for (var o = 1; o < n; o++) { off[o] = out.length; out += o + " 0 obj\n" + objs[o] + "\nendobj\n"; }
    var xr = out.length; out += "xref\n0 " + n + "\n0000000000 65535 f \n";
    for (o = 1; o < n; o++) out += ("0000000000" + off[o]).slice(-10) + " 00000 n \n";
    out += "trailer\n<< /Size " + n + " /Root 1 0 R >>\nstartxref\n" + xr + "\n%%EOF\n";
    return out;
  }
  window.mcSavePdf = async function (name, text, title) {
    var msg = await window.mcSaveText(name.replace(/\.[a-z]+$/i, "") + ".pdf", makePdf(text, title), "application/pdf");
    return msg;
  };
  window.mcPrintText = function (text, title) {
    var f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(f);
    var d = f.contentWindow.document;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title></title><style>@page{size:80mm auto;margin:4mm}body{margin:0}' +
      'pre{font:12px/1.35 "Courier New",monospace;white-space:pre-wrap;word-break:break-word;margin:0;color:#000}</style></head><body><pre id="t"></pre></body></html>');
    d.close();
    d.title = title || "Receipt";
    d.getElementById("t").textContent = text;
    setTimeout(function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { alert("Printing is not available here. Use Save PDF instead."); }
      setTimeout(function () { try { f.remove(); } catch (e) {} }, 60000);
    }, 150);
  };
})();
