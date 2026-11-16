/* MediStock Cloud — guideline support strip for clinical screens (Developer 2).
   Draws the "Guideline support" box that sits at the top of a stage of the visit (triage, consultation, tests, diagnosis, treatment, follow-up).
   It only DISPLAYS what PCG.match() found. It never diagnoses, never prescribes, and never changes a record by itself:
   every button (Review / Accept / Dismiss / Use this regimen / Open full guideline) is a deliberate choice by the clinician, handled by the screen.

   PCGU.render(items, opts) -> html string
     items : result of PCG.match() for one stage, already filtered with PCG.shouldShow()
     opts  : { stage, open:{key:true}, accepted:{key:"Name"}, dismissedCount, canPrescribe, hasPlan }
   Buttons carry data-gact="review|accept|dismiss|use|open|undismiss" with data-gkey / data-gidx.
   Needs pc-guidelines.js (PCG). Styles are added once, using the page's own colour variables. */
(function (root) {
  var done = false;
  function css() {
    if (done || typeof document === "undefined") return; done = true;
    var st = document.createElement("style");
    st.textContent =
      ".gstrip{margin:0 0 12px}.gstrip:empty{display:none}" +
      ".gs-box{border:1px solid var(--accent,#0f6b5c);border-radius:12px;padding:10px 12px;background:var(--card,#fff)}" +
      ".gs-head{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;justify-content:space-between}.gs-head b{color:var(--accent,#0f6b5c);font-size:14px}.gs-head span{font-size:11.5px;color:var(--muted,#4b5f59)}" +
      ".gs-item{border-top:1px solid var(--border,#dbe4e0);margin-top:9px;padding-top:9px}.gs-item:first-of-type{border-top:none;margin-top:6px;padding-top:0}" +
      ".gs-title{font-size:14px;font-weight:700}.gs-why{font-size:12.5px;color:var(--muted,#4b5f59);margin-top:3px;line-height:1.45}.gs-note{font-size:12px;color:var(--warn,#c97a1f);margin-top:3px}" +
      ".gs-sec{margin-top:7px;border-radius:9px;padding:7px 10px;border:1px solid var(--border,#dbe4e0);font-size:13px;line-height:1.5}.gs-sec.warning{border-color:var(--danger,#b23b3b)}.gs-sec.recommend{border-color:var(--accent,#0f6b5c)}" +
      ".gs-sec h4{margin:0 0 3px;font-size:11px;letter-spacing:.3px;text-transform:uppercase}.gs-sec.warning h4{color:var(--danger,#b23b3b)}.gs-sec.recommend h4{color:var(--accent,#0f6b5c)}.gs-sec.info h4{color:var(--muted,#4b5f59)}" +
      ".gs-sec ul{margin:2px 0 2px 18px;padding:0}.gs-src{font-size:11px;color:var(--muted,#4b5f59);margin-top:3px}.gs-pre{white-space:pre-wrap}" +
      ".gs-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.gs-btns button{border-radius:9px;border:1px solid var(--accent,#0f6b5c);background:transparent;color:var(--accent,#0f6b5c);font-weight:600;font-size:13px;min-height:40px;padding:6px 12px;cursor:pointer}" +
      ".gs-btns button.gs-primary{background:var(--accent,#0f6b5c);color:#fff}.gs-btns button.gs-quiet{border-color:var(--border,#dbe4e0);color:var(--muted,#4b5f59)}.gs-btns button:disabled{opacity:.5;cursor:default}" +
      ".gs-reg{margin-top:7px;border:1px dashed var(--accent,#0f6b5c);border-radius:9px;padding:7px 10px;font-size:13px}.gs-reg .gs-btns{margin-top:5px}" +
      ".gs-foot{font-size:11.5px;color:var(--muted,#4b5f59);margin-top:8px}.gs-foot a,.gs-foot button{color:var(--accent,#0f6b5c);background:none;border:none;padding:0;font:inherit;text-decoration:underline;cursor:pointer}";
    document.head.appendChild(st);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function list(a) { return "<ul>" + a.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; }
  function section(sec, g) {
    var body = sec.key === "treatment" ? '<div class="gs-pre">' + esc(sec.items[0]) + "</div>" : list(sec.items);
    return '<div class="gs-sec ' + esc(sec.kind) + '"><h4>' + (sec.kind === "warning" ? "Warning · " : sec.kind === "recommend" ? "From the guideline · " : "") + esc(sec.title) + "</h4>" + body +
      '<div class="gs-src">Source: ' + esc(g.source || "") + (sec.page ? " · " + esc(sec.page) : "") + "</div></div>";
  }
  function itemHtml(it, o) {
    var g = it.g, key = it.key, open = !!(o.open && o.open[key]), acc = o.accepted && o.accepted[key];
    var h = '<div class="gs-item" data-gkey="' + esc(key) + '"><div class="gs-title">' + esc(g.title) +
      ' <span class="chip">' + (g.scope === "facility" ? "Local facility protocol" : "National / published") + '</span><span class="chip">v' + esc(g.version || 1) + "</span>" +
      (it.overdue ? '<span class="chip bad">Review overdue</span>' : "") + (acc ? '<span class="chip ok">Accepted' + (acc !== true ? " by " + esc(acc) : "") + "</span>" : "") + "</div>";
    h += '<div class="gs-why"><b>Why this is shown:</b> ' + it.reasons.map(function (r) { return esc(r.text); }).join("; ") + ".</div>";
    (it.notes || []).forEach(function (n) { h += '<div class="gs-note">' + esc(n) + "</div>"; });
    if (it.overdue) h += '<div class="gs-note">The review date has passed. This information may be out of date. Check the source.</div>';
    // warnings are always visible; the rest opens with Review
    var warn = it.sections.filter(function (s) { return s.kind === "warning"; }), rest = it.sections.filter(function (s) { return s.kind !== "warning"; });
    if (open || it.hasWarning) warn.forEach(function (s) { h += section(s, g); });
    if (open) { rest.forEach(function (s) { h += section(s, g); }); }
    if (o.stage === "treat" && it.regimens.length && (open || true)) {
      h += '<div class="gs-sec recommend"><h4>From the guideline · Regimens listed in the source</h4><div class="gs-src" style="margin:0 0 4px">Choose one to fill in the order form. You still check the patient, the dose and the schedule and confirm the order yourself.</div>';
      it.regimens.forEach(function (x, i) {
        h += '<div class="gs-reg">' + esc(root.PCG.regimenText(x.r)) + (x.r.instructions ? "<br>" + esc(x.r.instructions) : "") + (x.r.page ? '<div class="gs-src">Page: ' + esc(x.r.page) + "</div>" : "") +
          (x.notes || []).map(function (n) { return '<div class="gs-note">' + esc(n) + "</div>"; }).join("") +
          '<div class="gs-btns"><button type="button" class="gs-primary" data-gact="use" data-gkey="' + esc(key) + '" data-gidx="' + x.index + '"' + (o.canPrescribe === false ? " disabled" : "") + ">Use this regimen</button></div>" +
          (o.canPrescribe === false ? '<div class="gs-note">You do not have permission to prescribe.</div>' : (!o.hasPlan ? '<div class="gs-note">Start a treatment plan first, then choose the regimen.</div>' : "")) + "</div>";
      });
      if (it.regimensHidden) h += '<div class="gs-src">' + it.regimensHidden + " other regimen" + (it.regimensHidden === 1 ? "" : "s") + " in this guideline do not fit this patient’s age or weight and are not shown.</div>";
      h += "</div>";
    }
    h += '<div class="gs-btns"><button type="button" data-gact="review" data-gkey="' + esc(key) + '">' + (open ? "Hide details" : "Review") + "</button>" +
      '<button type="button" class="gs-primary" data-gact="accept" data-gkey="' + esc(key) + '"' + (acc ? " disabled" : "") + ">" + (acc ? "Accepted" : "Accept") + "</button>" +
      '<button type="button" class="gs-quiet" data-gact="dismiss" data-gkey="' + esc(key) + '">Dismiss</button>' +
      '<button type="button" class="gs-quiet" data-gact="open" data-gkey="' + esc(key) + '">Open full guideline</button></div></div>';
    return h;
  }
  function render(items, o) {
    css(); o = o || {};
    if (!items.length && !o.dismissedCount) return "";
    var h = '<div class="gs-box"><div class="gs-head"><b>Guideline support</b><span>Reference from approved guidelines. It is not a diagnosis and does not prescribe.</span></div>';
    h += items.map(function (it) { return itemHtml(it, o); }).join("");
    if (!items.length) h += '<div class="gs-foot">No new guidance for this stage.</div>';
    h += '<div class="gs-foot">Accept records that you reviewed it (it is saved in the visit notes). Dismiss hides it until something new about the patient matches or a newer version is approved.' +
      (o.dismissedCount ? ' <button type="button" data-gact="undismiss">Show ' + o.dismissedCount + " dismissed</button>" : "") + "</div></div>";
    return h;
  }
  root.PCGU = { render: render, esc: esc };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PCGU;
})(typeof window !== "undefined" ? window : this);
