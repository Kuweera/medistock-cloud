/* MediStock Cloud — import tools on the page (Developer 4, Stage 2).
   Loads the vendored libraries in vendor/ ONLY when needed (never at start-up), reads PDFs with pdf.js (which parses in its own worker),
   runs OCR with tesseract.js, and checks / downloads the tools for offline use.
   Every address here is a local path inside the app. There is no network address in this file: the libraries, the OCR worker, the OCR core and
   the language data all come from vendor/. */
(function (root) {
  "use strict";

  var V = "vendor/";
  var FILES = {
    pdf: { label: "PDF files", files: [V + "pdfjs-3.11.174/pdf.min.js", V + "pdfjs-3.11.174/pdf.worker.min.js"] },
    docx: { label: "Word files", files: [V + "mammoth-1.8.0/mammoth.browser.min.js"] },
    xlsx: { label: "Excel files", files: [V + "sheetjs-0.20.3/xlsx.full.min.js"] },
    ocr: { label: "OCR for scanned pages", files: null }   // depends on this device (SIMD or not); see ocrFiles()
  };
  var OCR_LANG = "eng";

  function abs(p) { return new URL(p, document.baseURI).href; }
  function simd() { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } }
  function ocrFiles() { return [V + "tesseract-5.1.1/tesseract.min.js", V + "tesseract-5.1.1/worker.min.js", V + "tesseract-5.1.1/core/tesseract-core-" + (simd() ? "simd-" : "") + "lstm.wasm.js", V + "tesseract-5.1.1/lang/" + OCR_LANG + ".traineddata.gz"]; }
  function filesOf(tool) { return tool === "ocr" ? ocrFiles() : FILES[tool].files; }
  function labelOf(tool) { return FILES[tool].label; }

  // ---------------------------------------------------------------- loading
  var scripts = {};
  function loadScript(url) {
    if (scripts[url]) return scripts[url];
    scripts[url] = new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = url; s.async = true; s.onload = function () { resolve(); }; s.onerror = function () { delete scripts[url]; reject(new Error("load failed: " + url)); }; document.head.appendChild(s);
    });
    return scripts[url];
  }
  function missing(tool) { var e = new Error("The import tool for " + labelOf(tool) + " could not be loaded. If you are offline, connect once and use \"Download import tools for offline use\", then try again."); e.toolMissing = tool; return e; }
  /* ensure(tool) -> Promise: the library is loaded and ready, or rejects with a plain message (e.toolMissing = tool) */
  function ensure(tool) {
    if (tool === "pdf") return loadScript(V + "pdfjs-3.11.174/pdf.min.js").then(function () { root.pdfjsLib.GlobalWorkerOptions.workerSrc = abs(V + "pdfjs-3.11.174/pdf.worker.min.js"); }).catch(function () { throw missing(tool); });
    if (tool === "ocr") return Promise.all([ensure("pdf"), loadScript(V + "tesseract-5.1.1/tesseract.min.js")]).then(function () { }).catch(function (e) { throw e && e.toolMissing ? e : missing(tool); });
    return Promise.resolve();   // docx and xlsx are loaded inside the import worker
  }

  // ---------------------------------------------------------------- offline status and download
  /* The app's service worker serves vendor/ files from the cache named below and never adds to it by itself: a page saves them on purpose (see download()). */
  var VENDOR_CACHE = "mc-vendor-v1";
  /* status(tool) -> Promise<{ tool, label, files:[url], stored: true|false|null, missing:[url] }>  stored = every file is in an app cache (null when the browser has no Cache API) */
  function status(tool) {
    var files = filesOf(tool), res = { tool: tool, label: labelOf(tool), files: files, stored: null, missing: [] };
    if (typeof caches === "undefined" || !caches.match) return Promise.resolve(res);
    return Promise.all(files.map(function (f) { return caches.match(abs(f)).then(function (r) { return r ? null : f; }, function () { return f; }); })).then(function (m) { res.missing = m.filter(Boolean); res.stored = res.missing.length === 0; return res; });
  }
  /* download(tool, onProgress) -> Promise<{ok, bytes, failed:[url], saved}>
     Saves every file of the tool in the app's vendor cache so it works offline. Without the Cache API the files are only fetched (saved:false) and the screen says so.
     cache.add() refuses an error response, so an offline "not saved" reply from the service worker is never stored as if it were the library. */
  function download(tool, onProgress) {
    var files = filesOf(tool), done = 0, bytes = 0, failed = [], canCache = typeof caches !== "undefined" && caches.open;
    function one(f, cache) {
      var url = abs(f);
      return (cache ? cache.add(url).then(function () { return cache.match(url); }).then(function (r) { return r ? r.clone().blob() : null; }) : fetch(url, { cache: "reload" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }))
        .then(function (b) { if (b) bytes += b.size; }, function () { failed.push(f); }).then(function () { done++; if (onProgress) onProgress({ done: done, total: files.length, bytes: bytes }); });
    }
    return (canCache ? caches.open(VENDOR_CACHE) : Promise.resolve(null)).then(function (cache) {
      return files.reduce(function (p, f) { return p.then(function () { return one(f, cache); }); }, Promise.resolve()).then(function () { return { ok: failed.length === 0, bytes: bytes, failed: failed, saved: !!cache }; });
    });
  }

  // ---------------------------------------------------------------- PDF pages (pdf.js parses in its own worker)
  function pdfError(err) {
    var nm = err && err.name || "";
    if (nm === "PasswordException") return new Error("This PDF is password-protected. Remove the password in a PDF viewer and import it again.");
    if (nm === "InvalidPDFException") return new Error("This file is not a valid PDF, or it is damaged.");
    if (err && err.toolMissing) return err;
    return new Error("The PDF could not be read: " + (err && err.message || err));
  }
  /* readPdfPages(arrayBuffer, onProgress) -> Promise<pages>   pages = [{ page, width, height, items:[{str,x,y,w,h}] }] for pc-import-pdf.js */
  function readPdfPages(buffer, onProgress) {
    return ensure("pdf").then(function () {
      return root.pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    }).then(function (doc) {
      var total = doc.numPages, pages = [], n = 0;
      function next() {
        if (n >= total) return doc.destroy().then(function () { return pages; }, function () { return pages; });
        n++;
        return doc.getPage(n).then(function (pg) {
          var v = pg.view;
          return pg.getTextContent().then(function (tc) {
            var items = [], i, it;
            for (i = 0; i < tc.items.length; i++) { it = tc.items[i]; if (typeof it.str !== "string") continue; items.push({ str: it.str, x: it.transform[4] - v[0], y: it.transform[5] - v[1], w: it.width, h: it.height > 0 ? it.height : Math.abs(it.transform[3]) }); }
            pages.push({ page: n, width: v[2] - v[0], height: v[3] - v[1], items: items }); pg.cleanup();
            if (onProgress && (n % 10 === 0 || n === total)) onProgress({ page: n, total: total });
            return next();
          });
        });
      }
      return next();
    }).catch(function (e) { throw pdfError(e); });
  }

  // ---------------------------------------------------------------- OCR
  function clean(t) { return String(t || "").replace(/\u0000/g, "").replace(/-\s*\n\s*(?=[a-z])/g, "-").replace(/\s*\n\s*/g, " ").replace(/[ \t\u00A0]+/g, " ").trim(); }
  /* ocrPages(arrayBuffer, pageNumbers, onProgress) -> Promise<{ blocks, pages:[{page, confidence, chars}], lowConfidence:[page] }>
     Renders each page to a canvas with pdf.js and reads it with tesseract.js. Local files only. Every block is marked ocr:true with its confidence. */
  function ocrPages(buffer, pageNos, onProgress) {
    var worker = null, blocks = [], per = [], low = [], doc = null;
    return ensure("ocr").then(function () {
      return root.pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    }).then(function (d) {
      doc = d;
      return root.Tesseract.createWorker(OCR_LANG, 1, {
        workerPath: abs(V + "tesseract-5.1.1/worker.min.js"), corePath: abs(V + "tesseract-5.1.1/core"), langPath: abs(V + "tesseract-5.1.1/lang"), workerBlobURL: false, gzip: true,
        logger: function () { }
      });
    }).then(function (w) {
      worker = w; var i = 0;
      function next() {
        if (i >= pageNos.length) return null;
        var no = pageNos[i++];
        return doc.getPage(no).then(function (pg) {
          var base = pg.getViewport({ scale: 1 }), scale = Math.min(300 / 72, 4000 / Math.max(base.width, base.height)), vp = pg.getViewport({ scale: scale }), cv = document.createElement("canvas");
          cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          return pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise.then(function () { return worker.recognize(cv); }).then(function (r) {
            var d = r.data || {}, paras = [], chars = 0;
            (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { var t = clean(p.text); if (t) { paras.push({ text: t, conf: Math.round((p.confidence || 0) * 10) / 10 }); } }); });
            if (!paras.length && clean(d.text)) paras.push({ text: clean(d.text), conf: Math.round((d.confidence || 0) * 10) / 10 });
            paras.forEach(function (p) { chars += p.text.length; blocks.push({ kind: "paragraph", text: p.text, page: no, ocr: true, conf: p.conf }); });
            var conf = Math.round((d.confidence || 0) * 10) / 10; per.push({ page: no, confidence: conf, chars: chars }); if (conf < 60) low.push(no);
            cv.width = cv.height = 0; pg.cleanup();
            if (onProgress) onProgress({ done: i, total: pageNos.length, page: no });
            return next();
          });
        });
      }
      return next();
    }).then(function () { return { blocks: blocks, pages: per, lowConfidence: low }; }).then(function (r) { return cleanup().then(function () { return r; }); }, function (e) { return cleanup().then(function () { throw (e && e.toolMissing ? e : new Error("OCR failed: " + (e && e.message || e))); }); });
    function cleanup() { return Promise.resolve(worker ? worker.terminate().catch(function () { }) : null).then(function () { return doc ? doc.destroy().catch(function () { }) : null; }); }
  }

  root.PCITools = { TOOLS: ["pdf", "docx", "xlsx", "ocr"], OCR_PAGES_PER_RUN: 25, filesOf: filesOf, labelOf: labelOf, ensure: ensure, status: status, download: download, VENDOR_CACHE: VENDOR_CACHE, readPdfPages: readPdfPages, ocrPages: ocrPages, simd: simd };
})(typeof window !== "undefined" ? window : this);
