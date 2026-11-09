/* MediStock Cloud — Patient Care form helpers.
   Dates: type them (05/05/1990, 5/5/1990, 05051990) OR tap the calendar button. Stored as yyyy-mm-dd.
   Use: <div class="dateField"><input type="text" id="x" ...><button type="button" class="cal-btn">…</button><input type="date" class="cal-native"></div>
   then PCF.initDates();  PCF.dateInfo("x") -> {state, iso};  PCF.setDate("x", iso). */
(function (root) {
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function toTyped(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function parseTyped(s) {
    s = String(s || "").trim(); if (!s) return "";
    var m = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/.exec(s) || /^(\d{2})(\d{2})(\d{4})$/.exec(s);
    if (!m) return "";
    var d = +m[1], mo = +m[2], y = +m[3], dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
    return y + "-" + pad(mo) + "-" + pad(d);
  }
  // keeps what the person types tidy: 0505 -> 05/05, 5/5/1990 -> 05/05/1990
  function formatTyped(raw) {
    raw = String(raw || "").replace(/[^\d\/\-. ]/g, "");
    var endsSep = /[\/\-. ]$/.test(raw);
    var toks = raw.split(/[\/\-. ]+/).filter(function (x) { return x !== ""; });
    if (!toks.length) return "";
    if (toks.length === 1 && !endsSep) { // digits only: slashes appear by themselves
      var d = toks[0].slice(0, 8), o = d.slice(0, 2);
      if (d.length > 2) o += "/" + d.slice(2, 4);
      if (d.length > 4) o += "/" + d.slice(4);
      return o;
    }
    for (var i = 0; i < 2; i++) {
      if (toks[i] && toks[i].length > 2) {
        var over = toks[i].slice(2); toks[i] = toks[i].slice(0, 2);
        if (i + 1 < toks.length) toks[i + 1] = over + toks[i + 1]; else toks.push(over);
      }
    }
    toks = toks.slice(0, 3);
    var out = toks.map(function (t, i) {
      var last = i === toks.length - 1;
      if (i < 2) return (last && !endsSep) ? t : (t.length === 1 ? "0" + t : t);
      return t.slice(0, 4);
    }).join("/");
    if (endsSep && toks.length < 3) out += "/";
    return out;
  }
  function dateInfo(id) {
    var t = document.getElementById(id), v = t ? t.value.trim() : "";
    if (!v) return { state: "empty", iso: "" };
    var iso = parseTyped(v);
    if (!iso) return { state: "bad", iso: "" };
    if (iso > todayISO()) return { state: "future", iso: iso };
    if (iso < "1900-01-01") return { state: "old", iso: iso };
    return { state: "ok", iso: iso };
  }
  function setDate(id, iso) { var t = document.getElementById(id); if (t) t.value = toTyped(iso); }
  function initDates() {
    var wraps = document.querySelectorAll(".dateField");
    Array.prototype.forEach.call(wraps, function (w) {
      if (w.getAttribute("data-ready")) return; w.setAttribute("data-ready", "1");
      var t = w.querySelector('input[type="text"]'), n = w.querySelector('input[type="date"]'), b = w.querySelector("button");
      if (!t || !n || !b) return;
      n.max = todayISO(); n.min = "1900-01-01";
      t.setAttribute("inputmode", "numeric"); t.setAttribute("autocomplete", "off"); t.setAttribute("maxlength", "10");
      if (!t.placeholder) t.placeholder = "DD/MM/YYYY";
      t.addEventListener("input", function (e) {
        var it = (e && e.inputType) || "";
        if (it.indexOf("delete") === 0) { var c = t.value.replace(/[^\d\/\-. ]/g, ""); if (c !== t.value) t.value = c; return; }
        var f = formatTyped(t.value); if (f !== t.value) t.value = f;
      });
      t.addEventListener("blur", function () { var iso = parseTyped(t.value); if (iso) t.value = toTyped(iso); });
      b.addEventListener("click", function () {
        var iso = parseTyped(t.value); n.value = iso || "";
        try { if (n.showPicker) { n.showPicker(); return; } } catch (e) {}
        n.focus(); n.click();
      });
      n.addEventListener("change", function () {
        if (!n.value) return; t.value = toTyped(n.value);
        t.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }
  var api = { pad: pad, todayISO: todayISO, toTyped: toTyped, parseTyped: parseTyped, formatTyped: formatTyped, dateInfo: dateInfo, setDate: setDate, initDates: initDates };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCF = api;
})(typeof window !== "undefined" ? window : this);
