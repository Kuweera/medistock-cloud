/* MediStock Cloud — "Import a document" card for guidelines.html (Developer 4, Stage 1).
   The page gives this file what it needs (database functions, the stamp, permission checks) through PCIUI.init(); this file never imports Firebase itself.

   What it does: choose a file -> check type and size -> read it in a Web Worker -> preview -> user states the source -> choose chapters -> save.
   The original file stays on THIS device (IndexedDB). Firestore gets the extracted text in sections plus the file name, type, size and SHA-256.
   Nothing saved here is a guideline. It is raw material for a reviewer and is not shown in clinical workflows. */
(function (root) {
  "use strict";
  var PCI = root.PCI, S = null, st = { file: null, res: null, hash: "", busy: false, reading: false }, worker = null, reqId = 0, sources = [], unsubSrc = null, viewId = null, viewUnsub = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function validISO(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; var d = new Date(s + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
  function when(v) { var ms = v && typeof v.toMillis === "function" ? v.toMillis() : (typeof v === "number" ? v : 0); return ms ? new Date(ms).toISOString().slice(0, 10) : ""; }

  // ---------------------------------------------------------------- the original file stays on this device
  function keepOriginal(file, hash) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open("mc-import-files", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("files", { keyPath: "sha256" }); };
        req.onerror = function () { resolve(false); };
        req.onsuccess = function () { try { var tx = req.result.transaction("files", "readwrite"); tx.objectStore("files").put({ sha256: hash, name: file.name, type: file.type || "", size: file.size, addedAt: Date.now(), blob: file }); tx.oncomplete = function () { resolve(true); }; tx.onerror = function () { resolve(false); }; } catch (e) { resolve(false); } };
      } catch (e) { resolve(false); }
    });
  }

  // ---------------------------------------------------------------- reading (Web Worker, with a plain fallback)
  function readInWorker(file) {
    return file.arrayBuffer().then(function (buffer) {
      var id = ++reqId;
      return new Promise(function (resolve, reject) {
        var done = false;
        function finish(m) { if (done) return; done = true; resolve(m); }
        function runHere() { PCI.sha256Hex(new Uint8Array(buffer)).then(function (hash) { var u8 = new Uint8Array(buffer), r = PCI.extract(file.name, u8), secs = r.ok ? PCI.toSections(r.blocks) : []; finish({ id: id, hash: hash, ext: r.ext, ok: r.ok, error: r.error, encoding: r.encoding || "", method: r.method || "", warnings: r.warnings || [], stats: r.stats || null, sections: secs, preview: r.ok ? r.blocks.slice(0, 40).map(function (b) { return b.kind === "table" ? { kind: "table", rows: b.rows.slice(0, 6) } : { kind: b.kind, level: b.level || 0, text: b.text.slice(0, 600) }; }) : [] }); }, reject); }
        if (typeof Worker === "undefined") return runHere();
        try {
          if (!worker) worker = new Worker("pc-import-worker.js");
          var w = worker;
          w.onmessage = function (e) { if (e.data && e.data.id === id) { if (e.data.error && !e.data.hash) reject(new Error(e.data.error)); else finish(e.data); } };
          w.onerror = function () { worker = null; runHere(); };
          w.postMessage({ id: id, name: file.name, buffer: buffer }, [buffer]);
        } catch (e) { runHere(); }
      });
    });
  }

  // ---------------------------------------------------------------- card
  function cardHtml() {
    return '<h2>Import a document</h2>' +
      '<div class="hint2" style="margin-top:0">Read a guideline document into the app so a reviewer can check it. <b>Nothing here becomes a guideline by itself.</b> The text is saved as raw material for review and is not shown to clinicians until it has been organised into a draft entry and approved.</div>' +
      '<div class="hint2"><b>Works without internet:</b> TXT, CSV, HTML, HTM, RTF. <b>PDF, Word and Excel files</b> need import tools that are not installed in this version yet. Old <b>.doc</b> files are not supported: save them as .docx or PDF. Maximum file size ' + (PCI.MAX_FILE_BYTES / 1048576) + ' MB.</div>' +
      '<label for="docFile">Choose the file</label><input type="file" id="docFile" accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.html,.htm,.rtf">' +
      '<div id="docMsg" class="msg" role="status"></div><div id="docOut"></div>';
  }
  function msg(text, cls) { var el = $("docMsg"); if (!el) return; el.className = "msg " + (cls || ""); el.textContent = text || ""; }

  function groupsOf(secs) {
    var g = [], idx = {};
    secs.forEach(function (s) { var k = s.headingPath[0] || "(no heading)"; if (idx[k] === undefined) { idx[k] = g.length; g.push({ name: k, secs: [], chars: 0 }); } var o = g[idx[k]]; o.secs.push(s); o.chars += s.text.length; });
    return g;
  }
  function renderResult() {
    var r = st.res, out = $("docOut"); if (!out) return;
    if (!r || !r.ok) { out.innerHTML = ""; return; }
    var t = r.stats || {}, groups = groupsOf(r.sections), h = "";
    h += '<div class="info-box"><b>' + esc(st.file.name) + "</b> (" + esc(mb(st.file.size)) + ", " + esc(r.ext.toUpperCase()) + (r.encoding ? ", " + esc(r.encoding) : "") + ")<br>Found " + (t.headings || 0) + " heading" + (t.headings === 1 ? "" : "s") + ", " + (t.paragraphs || 0) + " paragraph" + (t.paragraphs === 1 ? "" : "s") + ", " + (t.tables || 0) + " table" + (t.tables === 1 ? "" : "s") + " (" + (t.tableRows || 0) + " rows). Page numbers are not available for this file type.<br>SHA-256: <span style=\"word-break:break-all\">" + esc(st.hash) + "</span></div>";
    (r.warnings || []).forEach(function (w) { h += '<div class="warn-box">' + esc(w) + "</div>"; });
    h += '<h3 style="margin:12px 0 4px">Preview (first part of the file)</h3><div class="tablewrap" style="max-height:220px;overflow:auto">' + r.preview.map(function (b) {
      if (b.kind === "table") return '<table style="margin:4px 0">' + b.rows.map(function (row) { return "<tr>" + row.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
      if (b.kind === "heading") return '<div style="font-weight:700;margin-top:6px">' + esc(b.text) + "</div>";
      return '<div style="margin:2px 0">' + esc(b.text) + "</div>";
    }).join("") + "</div>";
    h += '<h3 style="margin:12px 0 4px">Source details (type them as printed in the document)</h3>' +
      '<label for="docTitle">Guideline title</label><input id="docTitle" maxlength="200" autocomplete="off">' +
      '<label for="docOrg">Publisher or issuing organisation</label><input id="docOrg" maxlength="200" autocomplete="off">' +
      '<label for="docJur">Country or jurisdiction</label><input id="docJur" maxlength="100" autocomplete="off">' +
      '<label for="docEd">Version or edition</label><input id="docEd" maxlength="100" autocomplete="off">' +
      '<label for="docPub">Publication date (optional)</label><input id="docPub" type="date">';
    h += '<h3 style="margin:12px 0 4px">Choose what to save (' + r.sections.length + " section" + (r.sections.length === 1 ? "" : "s") + ")</h3><div class=\"hint2\" style=\"margin-top:0\">Saving fewer sections uses less of the daily write limit. Everything stays readable here until you leave this screen.</div>" +
      '<div class="row" style="margin:6px 0"><button type="button" class="btn-small btn-secondary" id="docAll">Select all</button><button type="button" class="btn-small btn-secondary" id="docNone">Select none</button></div><div id="docGroups">' +
      groups.map(function (g, i) { return '<label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;font-weight:400"><input type="checkbox" class="docG" data-i="' + i + '" checked style="width:auto;margin-top:3px"><span>' + esc(g.name) + " <span style=\"color:#666\">(" + g.secs.length + " section" + (g.secs.length === 1 ? "" : "s") + ", " + Math.round(g.chars / 1000) + "k characters)</span></span></label>"; }).join("") + "</div>" +
      '<div id="docSel" class="hint2"></div><button type="button" class="btn-primary" id="docSave">Save extracted text for review</button>';
    out.innerHTML = h; out.__groups = groups;
    $("docAll").onclick = function () { setAll(true); }; $("docNone").onclick = function () { setAll(false); };
    $("docGroups").addEventListener("change", updSel); $("docSave").onclick = save; updSel();
  }
  function setAll(v) { document.querySelectorAll("#docGroups .docG").forEach(function (c) { c.checked = v; }); updSel(); }
  function selected() { var out = $("docOut"), g = out.__groups || [], list = []; document.querySelectorAll("#docGroups .docG").forEach(function (c) { if (c.checked) list = list.concat(g[Number(c.dataset.i)].secs); }); return list; }
  function updSel() { var s = selected(), sm = PCI.summary(s), el = $("docSel"); if (el) el.innerHTML = s.length + " section" + (s.length === 1 ? "" : "s") + " selected (" + Math.round(sm.chars / 1000) + "k characters)." + (sm.overWarn ? ' <b style="color:#b45309">' + esc(sm.message) + "</b>" : ""); var b = $("docSave"); if (b) b.disabled = !s.length; }

  function chooseFile(file) {
    st = { file: file, res: null, hash: "", busy: false, reading: true }; $("docOut").innerHTML = "";
    var v = PCI.validate(file);
    if (!v.ok) { msg(v.message, "err"); st.reading = false; return; }
    msg("Reading " + file.name + " …", "");
    readInWorker(file).then(function (m) {
      st.reading = false; st.res = m; st.hash = m.hash || "";
      if (!m.ok) { msg(m.error || "The file could not be read.", "err"); return; }
      msg("Read " + (m.sections.length) + " section" + (m.sections.length === 1 ? "" : "s") + ". Check the preview, state the source, then save.", "ok"); renderResult();
    }, function (e) { st.reading = false; msg("The file could not be read: " + (e && e.message || e), "err"); });
  }

  // ---------------------------------------------------------------- saving
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  function save() {
    if (st.busy || !st.res || !st.res.ok) return;
    var f = { title: $("docTitle").value.trim(), org: $("docOrg").value.trim(), jur: $("docJur").value.trim(), ed: $("docEd").value.trim(), pub: $("docPub").value.trim() }, miss = [];
    if (f.title.length < 3) miss.push("guideline title"); if (f.org.length < 2) miss.push("publisher"); if (f.jur.length < 2) miss.push("country or jurisdiction"); if (f.ed.length < 1) miss.push("version or edition");
    if (miss.length) { msg("Please fill in: " + miss.join(", ") + ".", "err"); return; }
    if (f.pub && !validISO(f.pub)) { msg("The publication date is not a valid date.", "err"); return; }
    var secs = selected(); if (!secs.length) { msg("Choose at least one section to save.", "err"); return; }
    var sm = PCI.summary(secs); if (sm.overWarn && !window.confirm(sm.message + "\n\nSave all " + secs.length + " sections anyway?")) return;
    st.busy = true; $("docSave").disabled = true; msg("Checking whether this file was already imported …", "");
    var c = S.ctx(), sid = "gsrc_" + st.hash.slice(0, 16), srcRef = S.doc(S.db, "guideline_sources", sid);
    S.getDoc(srcRef).then(function (snap) { return snap && snap.exists(); }, function () { return null; }).then(function (exists) {
      if (exists) { st.busy = false; $("docSave").disabled = false; msg("This exact file was already imported. Open it in “Imported documents” below. To import more of it, ask the Lead Developer: adding sections to an existing import is not supported yet.", "err"); return; }
      var note = exists === null ? " (could not check for an earlier import while offline)" : "";
      var base = S.stamp(), srcDoc = Object.assign({}, base, { fileName: st.file.name, fileType: st.res.ext, fileSizeBytes: st.file.size, sha256: st.hash, pageCount: null, extractionMethod: st.res.method || "text", ocrUsed: false, ocrPages: [], extractionWarnings: st.res.warnings || [], sectionCount: secs.length, sourceTitle: f.title, sourceOrg: f.org, jurisdiction: f.jur, sourceEdition: f.ed, publicationDate: f.pub || "", importDate: new Date().toISOString().slice(0, 10), addedByName: c.myName, status: "imported" });
      var b0 = S.writeBatch(S.db); b0.set(srcRef, srcDoc);
      b0.set(S.doc(S.collection(S.db, "pc_audit_logs")), Object.assign(S.stamp(), { actorUid: c.me.id, actorName: c.myName, action: "guideline.source_import", recordPath: "guideline_sources/" + sid, patientId: null, count: secs.length, fileName: st.file.name, sha256: st.hash, at: S.serverTimestamp() }));
      var parts = chunk(secs, 400), done = 0, status = "confirmed";
      function step(first) {
        var batch = first ? b0 : S.writeBatch(S.db), part = first ? [] : parts.shift();
        if (first) { /* the source record goes alone, so a rules problem shows up before any section is written */ }
        part.forEach(function (s) { var id = sid + "_s" + ("00000" + s.seq).slice(-5); batch.set(S.doc(S.db, "guideline_sections", id), Object.assign({}, S.stamp(), { sourceId: sid, seq: s.seq, kind: s.kind, headingPath: s.headingPath, pageFrom: s.pageFrom, pageTo: s.pageTo, text: s.text, tableRows: s.tableRows, ocr: s.ocr, ocrConfidence: s.ocrConfidence, reviewStatus: "unreviewed", usedInGuidelineId: null })); });
        return S.commit(batch, first ? "Import record for " + st.file.name : "Sections " + (done + 1) + "–" + (done + part.length)).then(function (r) { if (r !== "confirmed") status = "waiting"; done += part.length; msg("Saved " + done + " of " + secs.length + " sections …", ""); return parts.length ? step(false) : null; });
      }
      return step(true).then(function () {
        return keepOriginal(st.file, st.hash).then(function (kept) {
          msg(status === "confirmed" ? "Saved " + secs.length + " section" + (secs.length === 1 ? "" : "s") + " for review." + (kept ? " The original file is kept on this device only." : " The original file could not be kept on this device.") + note : "Saved on this device. It has NOT reached the server yet and will send when you are online." + (kept ? " The original file is kept on this device only." : ""), status === "confirmed" ? "ok" : "err");
          st = { file: null, res: null, hash: "", busy: false, reading: false }; $("docOut").innerHTML = ""; $("docFile").value = "";
        });
      });
    }).catch(function (e) { st.busy = false; var b = $("docSave"); if (b) b.disabled = false; msg("Not saved: " + S.friendlyError(e), "err"); });
  }

  // ---------------------------------------------------------------- imported documents list (reviewers)
  function listHtml() {
    if (!sources.length) return '<div class="empty">No documents have been imported yet.</div>';
    return sources.map(function (s) {
      var chip = s.status === "rejected" ? '<span class="chip bad">Rejected</span>' : s.status === "retired" ? '<span class="chip">Retired</span>' : '<span class="chip warn">Raw text, not reviewed</span>';
      var acts = '<button type="button" class="btn-small btn-secondary" data-a="view" data-id="' + esc(s.id) + '">' + (viewId === s.id ? "Hide text" : "View text") + "</button>";
      if (S.canApprove() && s.status === "imported") acts += ' <button type="button" class="btn-small btn-secondary" data-a="reject" data-id="' + esc(s.id) + '">Reject</button>';
      if (S.canApprove() && s.status !== "retired") acts += ' <button type="button" class="btn-small btn-secondary" data-a="retire" data-id="' + esc(s.id) + '">Retire</button>';
      return '<div class="card" style="margin:8px 0"><b>' + esc(s.sourceTitle) + "</b> " + chip + "<br>" + esc(s.sourceOrg) + " · " + esc(s.jurisdiction) + " · " + esc(s.sourceEdition) + "<br><span style=\"color:#666\">" + esc(s.fileName) + " (" + esc(String(s.fileType || "").toUpperCase()) + ", " + esc(mb(s.fileSizeBytes || 0)) + "), " + (s.sectionCount || 0) + " sections, imported " + esc(s.importDate || when(s.createdAt)) + " by " + esc(s.addedByName || "") + "</span>" + (s.rejectedReason ? "<br>Reason: " + esc(s.rejectedReason) : "") + '<div class="row" style="margin-top:6px">' + acts + '</div><div id="docView_' + esc(s.id) + '"></div></div>';
    }).join("");
  }
  function renderList() { var el = $("docList"); if (!el) return; el.innerHTML = listHtml(); if (viewId) showSections(viewId); }
  function showSections(id) {
    var box = $("docView_" + id); if (!box) return; box.innerHTML = '<div class="hint2">Loading …</div>';
    if (viewUnsub) { try { viewUnsub(); } catch (e) { } viewUnsub = null; }
    var c = S.ctx(), first = true;
    viewUnsub = S.onSnapshot(S.query(S.collection(S.db, "guideline_sections"), S.where("businessId", "==", c.businessId), S.where("sourceId", "==", id)), function (snap) {
      var arr = []; snap.forEach(function (d) { var x = d.data(); x.id = d.id; arr.push(x); }); arr.sort(function (a, b) { return a.seq - b.seq; });
      if (!$("docView_" + id)) return;
      box.innerHTML = arr.length ? arr.slice(0, 60).map(function (x) { return '<div style="border-top:1px solid #ddd;margin-top:6px;padding-top:6px"><b>' + esc((x.headingPath || []).join(" › ") || "(no heading)") + "</b> <span style=\"color:#666\">#" + x.seq + ", " + esc(x.kind) + ", " + (x.text || "").length + ' characters</span><div style="max-height:110px;overflow:auto;white-space:pre-wrap;font-size:13px">' + esc((x.text || "").slice(0, 1500)) + ((x.text || "").length > 1500 ? " …" : "") + '</div><button type="button" class="btn-small btn-secondary" data-a="copy" data-sid="' + esc(x.id) + '">Copy text</button></div>'; }).join("") + (arr.length > 60 ? '<div class="hint2">Showing the first 60 of ' + arr.length + " sections.</div>" : "") : '<div class="hint2">No sections found for this import' + (snap.metadata && snap.metadata.fromCache ? " (this device has not received them from the server yet)" : "") + ".</div>";
      box.__secs = arr;
    }, function (e) { if (box) box.innerHTML = '<div class="alert-box">' + esc(S.friendlyError(e)) + "</div>"; });
  }
  function onListClick(e) {
    var b = e.target.closest("[data-a]"); if (!b) return; var a = b.dataset.a, id = b.dataset.id;
    if (a === "view") { viewId = viewId === id ? null : id; if (!viewId && viewUnsub) { try { viewUnsub(); } catch (x) { } viewUnsub = null; } renderList(); }
    else if (a === "copy") { var box = b.closest("[id^=docView_]"), sec = (box && box.__secs || []).filter(function (x) { return x.id === b.dataset.sid; })[0]; if (!sec) return; (root.top && root.top.mcShareText ? root.top.mcShareText(sec.text, "Extracted text") : navigator.clipboard.writeText(sec.text)).then(function () { S.note("Text copied.", "ok", 3000); }, function () { S.note("Could not copy. Select the text and copy it by hand.", "err"); }); }
    else if (a === "reject" || a === "retire") setStatus(id, a === "reject" ? "rejected" : "retired");
  }
  function setStatus(id, status) {
    var reason = window.prompt(status === "rejected" ? "Why is this extraction rejected? (at least 3 characters)" : "Why is this import retired? (at least 3 characters)"); if (reason == null) return; reason = reason.trim(); if (reason.length < 3) { S.note("A reason of at least 3 characters is needed.", "err"); return; }
    var c = S.ctx(), b = S.writeBatch(S.db), upd = { status: status, updatedBy: c.me.id, updatedAt: S.serverTimestamp() };
    if (status === "rejected") Object.assign(upd, { rejectedReason: reason, rejectedBy: c.me.id, rejectedByName: c.myName, rejectedAt: S.serverTimestamp() }); else Object.assign(upd, { retiredReason: reason, retiredBy: c.me.id, retiredByName: c.myName, retiredAt: S.serverTimestamp() });
    b.update(S.doc(S.db, "guideline_sources", id), upd);
    b.set(S.doc(S.collection(S.db, "pc_audit_logs")), Object.assign(S.stamp(), { actorUid: c.me.id, actorName: c.myName, action: "guideline.source_" + (status === "rejected" ? "reject" : "retire"), recordPath: "guideline_sources/" + id, patientId: null, reason: reason, at: S.serverTimestamp() }));
    S.commit(b, "Document " + status).then(function (r) { S.note(r === "confirmed" ? "Document " + status + "." : "Saved on this device. It has NOT reached the server yet.", r === "confirmed" ? "ok" : "err", 6000); }, function (e) { S.note(S.friendlyError(e), "err"); });
  }

  /* init(deps): deps = { db, doc, collection, writeBatch, serverTimestamp, getDoc, query, where, onSnapshot, stamp(), ctx() -> {me,myName,businessId,facilityId}, canManage(), canApprove(), note(), commit(), friendlyError() } */
  function init(deps) {
    S = deps; var host = $("docImport"); if (!host) return;
    if (!S.canManage() && !S.canApprove()) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="card">' + (S.canManage() ? cardHtml() : "") + "</div>" + '<div class="card"><h2>Imported documents</h2><div id="docList"></div></div>';
    if (S.canManage()) $("docFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) chooseFile(f); });
    $("docList").addEventListener("click", onListClick);
    if (unsubSrc) { try { unsubSrc(); } catch (e) { } }
    unsubSrc = S.onSnapshot(S.query(S.collection(S.db, "guideline_sources"), S.where("businessId", "==", S.ctx().businessId)), function (snap) {
      var arr = []; snap.forEach(function (d) { var x = d.data(); x.id = d.id; arr.push(x); }); arr.sort(function (a, b) { return (b.importDate || "").localeCompare(a.importDate || ""); }); sources = arr; renderList();
    }, function (e) { var el = $("docList"); if (el) el.innerHTML = '<div class="alert-box">' + esc(S.friendlyError(e)) + "</div>"; });
  }
  root.PCIUI = { init: init };
})(typeof window !== "undefined" ? window : this);
