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
    return "Saved to your phone: " + name;
  };
})();
