/* MediStock Cloud — "Import a document" card for guidelines.html (Developer 4, Stage 1).
   The page gives this file what it needs (database functions, the stamp, permission checks) through PCIUI.init(); this file never imports Firebase itself.

   What it does: choose a file -> check type and size -> read it (Web Worker; PDF text through pdf.js) -> preview -> OCR for scanned pages if wanted -> user states the source -> choose chapters -> save.
   The original file stays on THIS device (IndexedDB). Firestore gets the extracted text in sections plus the file name, type, size and SHA-256.
   Nothing saved here is a guideline. It is raw material for a reviewer and is not shown in clinical workflows. */
(function (root) {
  "use strict";
  var PCI = root.PCI, PT = root.PCITools, S = null, st = { file: null, res: null, hash: "", busy: false, reading: false, ocrPages: [], ocrBlocks: [], ocrNote: [] }, worker = null, reqId = 0, sources = [], unsubSrc = null, viewId = null, viewUnsub = null;

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

  // ---------------------------------------------------------------- reading (Web Worker; PDF text is read by pdf.js on the page, laid out in the worker)
  function getWorker() { if (!worker) { worker = new Worker("pc-import-worker.js"); } return worker; }
  function askWorker(msg, transfer, onProgress) {
    var id = ++reqId; msg.id = id;
    return new Promise(function (resolve, reject) {
      var w;
      try { w = getWorker(); } catch (e) { return reject(new Error("This browser cannot run the import worker, so this file cannot be read here.")); }
      w.onmessage = function (e) { var d = e.data || {}; if (d.id !== id) return; if (d.progress) { if (onProgress) onProgress(d.progress); return; } if (d.error && !d.hash) { var er = new Error(d.error); er.toolMissing = d.toolMissing || ""; reject(er); } else resolve(d); };
      w.onerror = function () { worker = null; reject(new Error("The import worker stopped unexpectedly. Try the file again.")); };
      w.postMessage(msg, transfer || []);
    });
  }
  function readFile(file, onProgress) {
    var d = PCI.detect(file.name);
    return file.arrayBuffer().then(function (buffer) {
      if (d.tool === "pdf") {
        return PCI.sha256Hex(new Uint8Array(buffer)).then(function (hash) {
          return PT.readPdfPages(buffer.slice(0), function (p) { onProgress({ page: p.page, total: p.total }); }).then(function (pages) { return askWorker({ op: "pdf", name: file.name, hash: hash, pages: pages }, [], null); });
        });
      }
      return askWorker({ name: file.name, buffer: buffer }, [buffer], null);
    });
  }

  // ---------------------------------------------------------------- import tools box (what works offline)
  function fmtMB(n) { return (n / 1048576).toFixed(1) + " MB"; }
  function renderTools() {
    var host = $("docTools"); if (!host || !PT) return;
    Promise.all(PT.TOOLS.map(function (t) { return PT.status(t); })).then(function (list) {
      host.innerHTML = '<div class="hint2" style="margin-top:0"><b>Import tools on this device</b></div>' + list.map(function (x) {
        var state = x.stored === true ? '<span class="chip">Ready for offline use</span>' : x.stored === false ? '<span class="chip warn">Not downloaded: needs internet the first time</span>' : '<span class="chip">Cannot check on this browser</span>';
        return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0"><span style="min-width:150px">' + esc(x.label) + "</span>" + state + (x.stored === true ? "" : ' <button type="button" class="btn-small btn-secondary" data-tool="' + esc(x.tool) + '">Download for offline use</button>') + "</div>";
      }).join("") + '<div id="docToolMsg" class="hint2"></div>';
      host.onclick = function (e) { var b = e.target.closest("[data-tool]"); if (!b) return; downloadTool(b.dataset.tool, b); };
    });
  }
  function downloadTool(tool, btn) {
    var m = $("docToolMsg"); btn.disabled = true; if (m) m.textContent = "Downloading …";
    PT.download(tool, function (p) { if (m) m.textContent = "Downloading " + p.done + " of " + p.total + " files (" + fmtMB(p.bytes) + ") …"; }).then(function (r) {
      return PT.status(tool).then(function (x) {
        if (!r.ok) { if (m) m.textContent = "Some files could not be downloaded (" + r.failed.length + "). Check your connection and try again."; btn.disabled = false; return; }
        renderTools();
        setTimeout(function () { var mm = $("docToolMsg"); if (mm) mm.textContent = x.stored ? "Saved for offline use (" + fmtMB(r.bytes) + ")." : "Downloaded (" + fmtMB(r.bytes) + "), but this browser did not confirm that the app keeps them for offline use. Do not rely on them offline yet."; }, 150);
      });
    });
  }

  // ---------------------------------------------------------------- card
  function cardHtml() {
    return '<h2>Import a document</h2>' +
      '<div class="hint2" style="margin-top:0">Read a guideline document into the app so a reviewer can check it. <b>Nothing here becomes a guideline by itself.</b> The text is saved as raw material for review and is not shown to clinicians until it has been organised into a draft entry and approved.</div>' +
      '<div class="hint2"><b>Always works without internet:</b> TXT, CSV, HTML, HTM, RTF. <b>PDF, Word, Excel and OCR</b> work offline only after their import tools have been downloaded once on this device (below). Old <b>.doc</b> files are not supported: save them as .docx or PDF. Maximum file size ' + (PCI.MAX_FILE_BYTES / 1048576) + ' MB.</div>' +
      '<div id="docTools"></div>' +
      '<label for="docFile">Choose the file</label><input type="file" id="docFile" accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.html,.htm,.rtf">' +
      '<div id="docMsg" class="msg" role="status"></div><div id="docOut"></div>';
  }
  function msg(text, cls) { var el = $("docMsg"); if (!el) return; el.className = "msg " + (cls || ""); el.textContent = text || ""; }

  function groupsOf(secs) {
    var g = [], idx = {};
    secs.forEach(function (s) { var k = s.headingPath[0] || "(no heading)"; if (idx[k] === undefined) { idx[k] = g.length; g.push({ name: k, secs: [], chars: 0, pf: null, pt: null, ocr: false }); } var o = g[idx[k]]; o.secs.push(s); o.chars += s.text.length; if (s.ocr) o.ocr = true; if (typeof s.pageFrom === "number") { o.pf = o.pf === null ? s.pageFrom : Math.min(o.pf, s.pageFrom); o.pt = o.pt === null ? s.pageTo : Math.max(o.pt, s.pageTo); } });
    return g;
  }
  function pageLabel(pf, pt) { return pf === null || pf === undefined ? "" : (pt && pt !== pf ? "pages " + pf + "–" + pt : "page " + pf); }
  function renderResult() {
    var r = st.res, out = $("docOut"); if (!out) return;
    if (!r) { out.innerHTML = ""; return; }
    var t = r.stats || {}, groups = groupsOf(r.sections || []), h = "", pdf = r.pdf;
    if (r.ok) {
      h += '<div class="info-box"><b>' + esc(st.file.name) + "</b> (" + esc(mb(st.file.size)) + ", " + esc(r.ext.toUpperCase()) + (r.encoding ? ", " + esc(r.encoding) : "") + (pdf ? ", " + pdf.pages + " pages" : "") + ")<br>Found " + (t.headings || 0) + " heading" + (t.headings === 1 ? "" : "s") + ", " + (t.paragraphs || 0) + " paragraph" + (t.paragraphs === 1 ? "" : "s") + ", " + (t.tables || 0) + " table" + (t.tables === 1 ? "" : "s") + " (" + (t.tableRows || 0) + " rows)." + (pdf ? " Page numbers are kept with each section." : " Page numbers are not available for this file type.") + "<br>SHA-256: <span style=\"word-break:break-all\">" + esc(st.hash) + "</span></div>";
      (r.warnings || []).concat(st.ocrNote).forEach(function (w) { h += '<div class="warn-box">' + esc(w) + "</div>"; });
    }
    if (pdf && pdf.emptyPages && pdf.emptyPages.length) h += ocrPanel(pdf);
    if (!r.ok) { out.innerHTML = h; bindOcr(); return; }
    h += '<h3 style="margin:12px 0 4px">Preview (first part of the file)</h3><div class="tablewrap" style="max-height:220px;overflow:auto">' + r.preview.map(function (b) {
      var pg = typeof b.page === "number" ? '<span style="color:#666;font-size:12px"> p.' + b.page + "</span>" : "";
      if (b.kind === "table") return '<div style="margin-top:4px">' + pg + '</div><table style="margin:0 0 4px">' + b.rows.map(function (row) { return "<tr>" + row.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
      if (b.kind === "heading") return '<div style="font-weight:700;margin-top:6px">' + esc(b.text) + pg + "</div>";
      return '<div style="margin:2px 0">' + esc(b.text) + pg + "</div>";
    }).join("") + "</div>";
    h += '<h3 style="margin:12px 0 4px">Source details (type them as printed in the document)</h3>' +
      '<label for="docTitle">Guideline title</label><input id="docTitle" maxlength="200" autocomplete="off">' +
      '<label for="docOrg">Publisher or issuing organisation</label><input id="docOrg" maxlength="200" autocomplete="off">' +
      '<label for="docJur">Country or jurisdiction</label><input id="docJur" maxlength="100" autocomplete="off">' +
      '<label for="docEd">Version or edition</label><input id="docEd" maxlength="100" autocomplete="off">' +
      '<label for="docPub">Publication date (optional)</label><input id="docPub" type="date">';
    h += '<h3 style="margin:12px 0 4px">Choose what to save (' + r.sections.length + " section" + (r.sections.length === 1 ? "" : "s") + ")</h3><div class=\"hint2\" style=\"margin-top:0\">Saving fewer sections uses less of the daily write limit. Everything stays readable here until you leave this screen.</div>" +
      '<div class="row" style="margin:6px 0"><button type="button" class="btn-small btn-secondary" id="docAll">Select all</button><button type="button" class="btn-small btn-secondary" id="docNone">Select none</button></div><div id="docGroups">' +
      groups.map(function (g, i) { return '<label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;font-weight:400"><input type="checkbox" class="docG" data-i="' + i + '" checked style="width:auto;margin-top:3px"><span>' + esc(g.name) + " <span style=\"color:#666\">(" + g.secs.length + " section" + (g.secs.length === 1 ? "" : "s") + ", " + Math.round(g.chars / 1000) + "k characters" + (pageLabel(g.pf, g.pt) ? ", " + pageLabel(g.pf, g.pt) : "") + ")</span>" + (g.ocr ? ' <span class="chip warn">includes OCR text</span>' : "") + "</span></label>"; }).join("") + "</div>" +
      '<div id="docSel" class="hint2"></div><button type="button" class="btn-primary" id="docSave">Save extracted text for review</button>';
    out.innerHTML = h; out.__groups = groups;
    $("docAll").onclick = function () { setAll(true); }; $("docNone").onclick = function () { setAll(false); };
    $("docGroups").addEventListener("change", updSel); $("docSave").onclick = save; updSel(); bindOcr();
  }

  // ---------------------------------------------------------------- OCR for pages with no readable text (PDF only)
  function remainingScans() { var done = {}; st.ocrPages.forEach(function (p) { done[p] = 1; }); return ((st.res && st.res.pdf && st.res.pdf.emptyPages) || []).filter(function (p) { return !done[p]; }); }
  function ocrPanel(pdf) {
    var rem = remainingScans(), per = PT ? PT.OCR_PAGES_PER_RUN : 25;
    if (!rem.length) return '<div class="info-box">OCR has been run on all ' + st.ocrPages.length + " page" + (st.ocrPages.length === 1 ? "" : "s") + " that had no readable text.</div>";
    var run = rem.slice(0, per);
    return '<div class="warn-box"><b>' + rem.length + " page" + (rem.length === 1 ? "" : "s") + " with no readable text</b> (" + esc(root.PCIPDF.listPages(rem)) + "). They may be blank, or scanned images. OCR reads text from the page image. <b>OCR can make mistakes, especially with drug names, doses and numbers.</b> Every OCR section is marked and must be checked against the page image. OCR works " + per + ' pages at a time and needs its tool downloaded for offline use.<br><button type="button" class="btn-small btn-secondary" id="docOcr" style="margin-top:6px">Read ' + (run.length === 1 ? "page " + run[0] : run.length + " page" + (run.length === 1 ? "" : "s") + " (" + esc(root.PCIPDF.listPages(run)) + ")") + ' with OCR</button> <span id="docOcrMsg" class="hint2"></span></div>';
  }
  function bindOcr() { var b = $("docOcr"); if (b) b.onclick = runOcr; }
  function runOcr() {
    var rem = remainingScans(), run = rem.slice(0, PT.OCR_PAGES_PER_RUN), msgEl = $("docOcrMsg"), btn = $("docOcr"); if (!run.length || st.busy || st.reading) return;
    st.busy = true; btn.disabled = true; if (msgEl) msgEl.textContent = "Starting OCR …";
    st.file.arrayBuffer().then(function (buf) { return PT.ocrPages(buf, run, function (p) { if (msgEl) msgEl.textContent = "OCR: page " + p.page + " (" + p.done + " of " + p.total + ") …"; }); }).then(function (r) {
      st.busy = false; st.ocrPages = st.ocrPages.concat(run); st.ocrBlocks = st.ocrBlocks.concat(r.blocks);
      var blocks = st.res.blocks.map(function (b, i) { return { b: b, i: i }; }).concat(st.ocrBlocks.map(function (b, i) { return { b: b, i: 1e9 + i }; })).sort(function (x, y) { return (x.b.page || 0) - (y.b.page || 0) || x.i - y.i; }).map(function (x) { return x.b; });
      st.res.blocks = blocks; st.res.sections = PCI.toSections(blocks); st.res.stats = PCI.stats(blocks);
      st.res.ok = true; st.res.error = ""; st.res.method = st.res.pdf.textPages ? "mixed" : "ocr";
      st.res.preview = blocks.slice(0, 40).map(function (b) { return b.kind === "table" ? { kind: "table", rows: b.rows.slice(0, 6), page: b.page } : { kind: b.kind, level: b.level || 0, text: b.text.slice(0, 600), page: b.page }; });
      var avg = r.pages.length ? Math.round(r.pages.reduce(function (m, p) { return m + p.confidence; }, 0) / r.pages.length) : 0;
      st.ocrNote = ["OCR text was added for " + st.ocrPages.length + " page" + (st.ocrPages.length === 1 ? "" : "s") + " (average confidence " + avg + "%)." + (r.lowConfidence.length ? " Low confidence on pages " + root.PCIPDF.listPages(r.lowConfidence) + ": read these against the original." : "") + " OCR text is marked in the list below and in each saved section."];
      var wasOk = !!$("docTitle"), keep = wasOk ? { t: $("docTitle").value, o: $("docOrg").value, j: $("docJur").value, e: $("docEd").value, p: $("docPub").value } : null;
      msg("OCR finished for " + run.length + " page" + (run.length === 1 ? "" : "s") + ".", "ok"); renderResult();
      if (keep && $("docTitle")) { $("docTitle").value = keep.t; $("docOrg").value = keep.o; $("docJur").value = keep.j; $("docEd").value = keep.e; $("docPub").value = keep.p; }
    }, function (e) { st.busy = false; if (btn) btn.disabled = false; if (msgEl) msgEl.textContent = ""; msg(e && e.message || "OCR failed.", "err"); if (e && e.toolMissing) renderTools(); });
  }

  function setAll(v) { document.querySelectorAll("#docGroups .docG").forEach(function (c) { c.checked = v; }); updSel(); }
  function selected() { var out = $("docOut"), g = out.__groups || [], list = []; document.querySelectorAll("#docGroups .docG").forEach(function (c) { if (c.checked) list = list.concat(g[Number(c.dataset.i)].secs); }); return list; }
  function updSel() { var s = selected(), sm = PCI.summary(s), el = $("docSel"); if (el) el.innerHTML = s.length + " section" + (s.length === 1 ? "" : "s") + " selected (" + Math.round(sm.chars / 1000) + "k characters)." + (sm.overWarn ? ' <b style="color:#b45309">' + esc(sm.message) + "</b>" : ""); var b = $("docSave"); if (b) b.disabled = !s.length; }

  function freshState(file) { return { file: file, res: null, hash: "", busy: false, reading: true, ocrPages: [], ocrBlocks: [], ocrNote: [] }; }
  function chooseFile(file) {
    st = freshState(file); $("docOut").innerHTML = "";
    var v = PCI.validate(file);
    if (!v.ok) { msg(v.message, "err"); st.reading = false; return; }
    msg("Reading " + file.name + " …", "");
    readFile(file, function (p) { msg("Reading " + file.name + ": page " + p.page + " of " + p.total + " …", ""); }).then(function (m) {
      st.reading = false; st.res = m; st.hash = m.hash || "";
      if (!m.ok) { msg(m.error || "The file could not be read.", "err"); if (m.pdf && m.pdf.emptyPages && m.pdf.emptyPages.length) renderResult(); return; }
      msg("Read " + (m.sections.length) + " section" + (m.sections.length === 1 ? "" : "s") + ". Check the preview, state the source, then save.", "ok"); renderResult();
    }, function (e) { st.reading = false; msg(e && e.message || "The file could not be read.", "err"); if (e && e.toolMissing) renderTools(); });
  }

  // ---------------------------------------------------------------- saving
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  function sectionsOnce(sid, saved) {
    // the sections already saved for this import (read once); refuse a partial offline copy so nothing is compared against incomplete data
    return new Promise(function (resolve, reject) {
      var c = S.ctx(), un = null, got = false;
      un = S.onSnapshot(S.query(S.collection(S.db, "guideline_sections"), S.where("businessId", "==", c.businessId), S.where("sourceId", "==", sid)), function (snap) {
        if (got) return; var map = {}; snap.forEach(function (d) { var x = d.data(); map[x.seq] = x; });
        if (snap.metadata && snap.metadata.fromCache && snap.size < (saved || 0)) { got = true; if (un) un(); reject(new Error("The saved sections have not all arrived on this device yet. Try again when you are online.")); return; }
        got = true; if (un) un(); resolve(map);
      }, function (e) { if (!got) { got = true; reject(e); } });
    });
  }
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
    function release(text, cls) { st.busy = false; var b = $("docSave"); if (b) b.disabled = false; msg(text, cls || "err"); }
    S.getDoc(srcRef).then(function (snap) { return snap && snap.exists() ? { exists: true, data: snap.data() } : { exists: false }; }, function () { return { exists: null }; }).then(function (ex) {
      var note = ex.exists === null ? " (could not check for an earlier import while offline)" : "", adding = ex.exists === true, toWrite = secs, pre;
      if (adding) {
        if (ex.data.status !== "imported") { release("This file was imported before and is now \"" + ex.data.status + "\". It cannot be changed."); return null; }
        if (!window.confirm("This file was already imported (" + (ex.data.sectionCount || 0) + " sections saved).\n\nAdd the selected sections that are not saved yet?")) { release("Nothing was added.", ""); return null; }
        msg("Comparing with the sections already saved …", "");
        pre = sectionsOnce(sid, ex.data.sectionCount).then(function (saved) {
          var bad = Object.keys(saved).filter(function (k) { var cur = st.res.sections.filter(function (s) { return s.seq === Number(k); })[0]; return !cur || cur.text !== saved[k].text; });
          if (bad.length) throw new Error("This reading of the file differs from what was saved earlier (" + bad.length + " section" + (bad.length === 1 ? "" : "s") + " do not match, for example because OCR was added or the file was read by a different version of the app). To avoid mixing two different readings, nothing was added.");
          toWrite = secs.filter(function (s) { return !saved[s.seq]; });
          if (!toWrite.length) throw new Error("All the selected sections are already saved.");
        });
      } else pre = Promise.resolve();
      return pre.then(function () {
        var b0 = S.writeBatch(S.db), warn = (st.res.warnings || []).concat(st.ocrNote || []).slice(0, 20).map(function (t) { return String(t).slice(0, 500); });
        if (adding) {
          b0.update(srcRef, { sectionCount: (ex.data.sectionCount || 0) + toWrite.length, updatedBy: c.me.id, updatedAt: S.serverTimestamp() });
        } else {
          b0.set(srcRef, Object.assign({}, S.stamp(), { fileName: st.file.name, fileType: st.res.ext, fileSizeBytes: st.file.size, sha256: st.hash, pageCount: st.res.pdf ? st.res.pdf.pages : null, extractionMethod: st.res.method || "text", ocrUsed: st.ocrPages.length > 0, ocrPages: st.ocrPages.slice().sort(function (x, y) { return x - y; }), extractionWarnings: warn, sectionCount: toWrite.length, sourceTitle: f.title, sourceOrg: f.org, jurisdiction: f.jur, sourceEdition: f.ed, publicationDate: f.pub || "", importDate: new Date().toISOString().slice(0, 10), addedByName: c.myName, status: "imported" }));
        }
        b0.set(S.doc(S.collection(S.db, "pc_audit_logs")), Object.assign(S.stamp(), { actorUid: c.me.id, actorName: c.myName, action: adding ? "guideline.source_add_sections" : "guideline.source_import", recordPath: "guideline_sources/" + sid, patientId: null, count: toWrite.length, fileName: st.file.name, sha256: st.hash, at: S.serverTimestamp() }));
        var parts = chunk(toWrite, 400), done = 0, status = "confirmed";
        function step(first) {
          var batch = first ? b0 : S.writeBatch(S.db), part = first ? [] : parts.shift();   // the source record goes alone, so a rules problem shows up before any section is written
          part.forEach(function (s) { var id = sid + "_s" + ("00000" + s.seq).slice(-5); batch.set(S.doc(S.db, "guideline_sections", id), Object.assign({}, S.stamp(), { sourceId: sid, seq: s.seq, kind: s.kind, headingPath: s.headingPath, pageFrom: s.pageFrom, pageTo: s.pageTo, text: s.text, tableRows: s.tableRows, ocr: s.ocr, ocrConfidence: s.ocrConfidence, reviewStatus: "unreviewed", usedInGuidelineId: null })); });
          return S.commit(batch, first ? (adding ? "Update import record for " : "Import record for ") + st.file.name : "Sections " + (done + 1) + "–" + (done + part.length)).then(function (r) { if (r !== "confirmed") status = "waiting"; done += part.length; msg("Saved " + done + " of " + toWrite.length + " sections …", ""); return parts.length ? step(false) : null; });
        }
        return step(true).then(function () {
          return keepOriginal(st.file, st.hash).then(function (kept) {
            msg(status === "confirmed" ? (adding ? "Added " : "Saved ") + toWrite.length + " section" + (toWrite.length === 1 ? "" : "s") + " for review." + (kept ? " The original file is kept on this device only." : " The original file could not be kept on this device.") + note : "Saved on this device. It has NOT reached the server yet and will send when you are online." + (kept ? " The original file is kept on this device only." : ""), status === "confirmed" ? "ok" : "err");
            st = freshState(null); st.reading = false; $("docOut").innerHTML = ""; $("docFile").value = "";
          });
        });
      }, function (e) { release(e && e.message || "Could not add the sections."); return null; });
    }).catch(function (e) { release("Not saved: " + S.friendlyError(e)); });
  }

  // ---------------------------------------------------------------- imported documents list (reviewers)
  function listHtml() {
    if (!sources.length) return '<div class="empty">No documents have been imported yet.</div>';
    return sources.map(function (s) {
      var chip = s.status === "rejected" ? '<span class="chip bad">Rejected</span>' : s.status === "retired" ? '<span class="chip">Retired</span>' : '<span class="chip warn">Raw text, not reviewed</span>';
      var acts = '<button type="button" class="btn-small btn-secondary" data-a="view" data-id="' + esc(s.id) + '">' + (viewId === s.id ? "Hide text" : "View text") + "</button>";
      if (S.canApprove() && s.status === "imported") acts += ' <button type="button" class="btn-small btn-secondary" data-a="reject" data-id="' + esc(s.id) + '">Reject</button> <button type="button" class="btn-small btn-secondary" data-a="retire" data-id="' + esc(s.id) + '">Retire</button>';
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
    if (S.canManage()) { $("docFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) chooseFile(f); }); renderTools(); }
    $("docList").addEventListener("click", onListClick);
    if (unsubSrc) { try { unsubSrc(); } catch (e) { } }
    unsubSrc = S.onSnapshot(S.query(S.collection(S.db, "guideline_sources"), S.where("businessId", "==", S.ctx().businessId)), function (snap) {
      var arr = []; snap.forEach(function (d) { var x = d.data(); x.id = d.id; arr.push(x); }); arr.sort(function (a, b) { return (b.importDate || "").localeCompare(a.importDate || ""); }); sources = arr; renderList();
    }, function (e) { var el = $("docList"); if (el) el.innerHTML = '<div class="alert-box">' + esc(S.friendlyError(e)) + "</div>"; });
  }
  root.PCIUI = { init: init };
})(typeof window !== "undefined" ? window : this);
