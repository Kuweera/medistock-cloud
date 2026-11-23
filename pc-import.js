/* MediStock Cloud — guideline file import (Developer 4, Stage 1).
   Pure functions only: no database access, no page access. Runs in a Web Worker, in guidelines.html and in the Node tests.

   Stage 1 reads: TXT, CSV, HTML/HTM and RTF, with no outside library (this file).
   Stage 2 reads PDF, DOCX, XLSX and XLS with the vendored libraries in vendor/ (pc-import-worker.js loads them; pc-import-pdf.js holds the PDF layout logic).
   Legacy .doc is not supported: nothing here guesses at a conversion.

   Nothing in this file creates clinical content. It only copies text out of a file the user chose. The extracted text is raw
   material for a reviewer; it is not a guideline until it has been organised into a draft entry and approved. */
(function (root) {
  "use strict";

  var MAX_FILE_BYTES = 30 * 1024 * 1024;     // approved by the Lead
  var MAX_SECTION_CHARS = 100000;            // approved by the Lead (per section document)
  var WARN_SECTIONS = 1000;                  // warn before saving more than this many section documents in one import
  var MAX_TABLE_ROWS_PER_SECTION = 200;

  var TYPES = {
    txt: { label: "Text", now: true }, csv: { label: "CSV", now: true }, html: { label: "HTML", now: true }, htm: { label: "HTML", now: true }, rtf: { label: "RTF", now: true },
    pdf: { label: "PDF", now: true, tool: "pdf" }, docx: { label: "Word (.docx)", now: true, tool: "docx" }, xlsx: { label: "Excel (.xlsx)", now: true, tool: "xlsx" }, xls: { label: "Excel (.xls)", now: true, tool: "xlsx" }
  };

  // ---------------------------------------------------------------- file checks
  function extOf(name) { var m = /\.([A-Za-z0-9]+)$/.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; }

  /* detect(name) -> { ext, ok, stage, tool, message }   ok = a reader exists for this type. tool = the vendored library the reader needs ("pdf", "docx", "xlsx") or "" for the built-in readers. */
  function detect(name) {
    var ext = extOf(name);
    if (ext === "doc") return { ext: ext, ok: false, stage: "unsupported", tool: "", message: "Old Word files (.doc) cannot be read reliably. Open the file in Word and save it as .docx or PDF, then try again." };
    if (ext === "json") return { ext: ext, ok: false, stage: "json", tool: "", message: "JSON files use the \"Entries (JSON)\" import, not this one." };
    var t = TYPES[ext];
    if (!t) return { ext: ext, ok: false, stage: "unsupported", tool: "", message: "This file type" + (ext ? " (." + ext + ")" : "") + " is not supported. Supported: PDF, DOCX, XLSX, XLS, TXT, CSV, HTML, HTM, RTF." };
    return { ext: ext, ok: true, stage: "ready", tool: t.tool || "", message: "" };
  }

  /* validate({name,size}) -> { ok, message } */
  function validate(file) {
    if (!file || !file.name) return { ok: false, message: "Choose a file." };
    var size = Number(file.size);
    if (!(size > 0)) return { ok: false, message: "This file is empty." };
    if (size > MAX_FILE_BYTES) return { ok: false, message: "This file is " + (size / 1048576).toFixed(1) + " MB. The limit is " + (MAX_FILE_BYTES / 1048576) + " MB. Split the document and import the parts separately." };
    var d = detect(file.name);
    return { ok: d.ok, message: d.message, detected: d };
  }

  // ---------------------------------------------------------------- SHA-256 (crypto.subtle when available, a plain copy otherwise)
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Plain(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], n = bytes.length, total = ((n + 9 + 63) >> 6) << 6, w = new Int32Array(64), i, j, t;
    var buf = new Uint8Array(total); buf.set(bytes); buf[n] = 0x80;
    var bits = n * 8, dv = new DataView(buf.buffer); dv.setUint32(total - 8, Math.floor(bits / 4294967296)); dv.setUint32(total - 4, bits >>> 0);
    function rr(x, c) { return (x >>> c) | (x << (32 - c)); }
    for (i = 0; i < total; i += 64) {
      for (j = 0; j < 16; j++) w[j] = dv.getInt32(i + j * 4);
      for (j = 16; j < 64; j++) { var s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0; }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (j = 0; j < 64; j++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[j] + w[j]) | 0, S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = ""; for (t = 0; t < 8; t++) out += ("00000000" + (h[t] >>> 0).toString(16)).slice(-8); return out;
  }
  function toHex(buf) { var u = new Uint8Array(buf), s = "", i; for (i = 0; i < u.length; i++) s += ("0" + u[i].toString(16)).slice(-2); return s; }
  /* sha256Hex(ArrayBuffer|Uint8Array) -> Promise<string> */
  function sha256Hex(data) {
    var u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    var subtle = root.crypto && root.crypto.subtle;
    if (subtle && subtle.digest) return subtle.digest("SHA-256", u8).then(toHex, function () { return sha256Plain(u8); });
    return Promise.resolve(sha256Plain(u8));
  }

  // ---------------------------------------------------------------- decoding bytes to text
  /* decodeText(Uint8Array) -> { text, encoding, warning }  UTF-8 first; UTF-16 by byte-order mark; otherwise Windows-1252 (and say so). */
  function decodeText(u8) {
    var enc, warning = "", dec;
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) { u8 = u8.subarray(3); enc = "utf-8"; }
    else if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) { u8 = u8.subarray(2); enc = "utf-16le"; }
    else if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) { u8 = u8.subarray(2); enc = "utf-16be"; }
    if (enc) return { text: new TextDecoder(enc).decode(u8), encoding: enc, warning: "" };
    try { dec = new TextDecoder("utf-8", { fatal: true }).decode(u8); return { text: dec, encoding: "utf-8", warning: "" }; } catch (e) { /* not UTF-8 */ }
    warning = "The file is not valid UTF-8. It was read as Windows-1252, so check accented letters and symbols in the preview.";
    return { text: new TextDecoder("windows-1252").decode(u8), encoding: "windows-1252", warning: warning };
  }

  function clean(s) { return String(s == null ? "" : s).replace(/\u0000/g, "").replace(/\r\n?/g, "\n"); }
  function squash(s) { return String(s).replace(/[ \t\u00A0]+/g, " ").replace(/ *\n */g, "\n").trim(); }

  // ---------------------------------------------------------------- plain text
  var HEADING_LINE = /^(CHAPTER|SECTION|PART|APPENDIX|ANNEX)\s+[A-Za-z0-9IVXLC.:-]+(\b.*)?$/;
  /* parseTxt(text) -> { blocks, warnings }
     Only two kinds of heading are recognised and the preview says so: lines that start with # (markdown style) and lines that start with
     CHAPTER / SECTION / PART / APPENDIX / ANNEX. Nothing else is guessed. */
  function parseTxt(text) {
    var blocks = [], warnings = [], paras = clean(text).split(/\n[ \t]*\n+/), i, headings = 0;
    for (i = 0; i < paras.length; i++) {
      var p = paras[i].replace(/^\n+|\n+$/g, ""); if (!p.trim()) continue;
      var first = p.split("\n")[0].trim(), m = /^(#{1,6})\s+(.+)$/.exec(first);
      if (m) { blocks.push({ kind: "heading", level: m[1].length, text: squash(m[2]) }); headings++; var rest = p.split("\n").slice(1).join("\n"); if (rest.trim()) blocks.push({ kind: "paragraph", text: squash(rest) }); continue; }
      if (first.length <= 120 && HEADING_LINE.test(first)) { blocks.push({ kind: "heading", level: /^(CHAPTER|PART)/.test(first) ? 1 : 2, text: squash(first) }); headings++; var rest2 = p.split("\n").slice(1).join("\n"); if (rest2.trim()) blocks.push({ kind: "paragraph", text: squash(rest2) }); continue; }
      blocks.push({ kind: "paragraph", text: squash(p) });
    }
    if (!headings && blocks.length) warnings.push("No headings were recognised in this text file. The content is kept in order and the reviewer can organise it by hand.");
    return { blocks: blocks, warnings: warnings };
  }

  // ---------------------------------------------------------------- CSV (RFC 4180: quotes, doubled quotes, line breaks inside quotes)
  function sniffDelimiter(text) {
    var head = text.slice(0, 5000).split("\n").slice(0, 5), best = ",", bestScore = -1, cands = [",", ";", "\t", "|"], i;
    for (i = 0; i < cands.length; i++) { var c = cands[i], counts = head.map(function (l) { return l.split(c).length - 1; }); var s = Math.min.apply(null, counts) * 10 + (counts[0] || 0); if (s > bestScore) { bestScore = s; best = c; } }
    return best;
  }
  function parseCsvRows(text, delim) {
    var rows = [], row = [], cur = "", q = false, i = 0, n = text.length, ch;
    while (i < n) {
      ch = text.charAt(i);
      if (q) { if (ch === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; } cur += ch; i++; continue; }
      if (ch === '"' && cur === "") { q = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ""; i++; continue; }
      if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
      cur += ch; i++;
    }
    if (q) return { rows: rows, error: "A quoted cell was never closed, so the end of the file may be missing." };
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return { rows: rows, error: "" };
  }
  /* parseCsv(text) -> { blocks, warnings }   a table block holds { rows: [[cell,...],...], header: true } */
  function parseCsv(text) {
    var t = clean(text), warnings = [], d = sniffDelimiter(t), r = parseCsvRows(t, d), rows = r.rows.filter(function (x) { return x.some(function (c) { return String(c).trim() !== ""; }); });
    if (r.error) warnings.push(r.error);
    if (!rows.length) return { blocks: [], warnings: warnings.concat("The CSV file has no rows.") };
    var width = rows.reduce(function (m, x) { return Math.max(m, x.length); }, 0), ragged = rows.some(function (x) { return x.length !== width; });
    if (ragged) warnings.push("Some rows have a different number of columns from the longest row. Short rows were padded with empty cells; check the preview.");
    rows = rows.map(function (x) { var o = x.map(function (c) { return squash(c); }); while (o.length < width) o.push(""); return o; });
    return { blocks: [{ kind: "table", rows: rows, header: true }], warnings: warnings, delimiter: d === "\t" ? "tab" : d };
  }

  // ---------------------------------------------------------------- HTML (own tokenizer: a Web Worker has no DOMParser)
  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", deg: "°", plusmn: "±", micro: "µ", times: "×", divide: "÷", le: "≤", ge: "≥", ne: "≠", frac12: "½", frac14: "¼", frac34: "¾", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", larr: "←", rarr: "→", uarr: "↑", darr: "↓", sup2: "²", sup3: "³", alpha: "α", beta: "β", gamma: "γ", delta: "δ", mu: "μ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ouml: "ö", uuml: "ü", auml: "ä" };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, function (m, e) {
      if (e.charAt(0) === "#") { var cp = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : m; } catch (x) { return m; } }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  var BLOCK_TAGS = { p: 1, div: 1, section: 1, article: 1, ul: 1, ol: 1, li: 1, blockquote: 1, pre: 1, dd: 1, dt: 1, dl: 1, figure: 1, figcaption: 1, header: 1, footer: 1, main: 1, aside: 1, nav: 1, form: 1, fieldset: 1, address: 1 };
  /* parseHtml(text) -> { blocks, warnings }   scripts, styles and comments are dropped; h1-h6 become headings; tables become table blocks (a nested table is flattened to text). */
  function parseHtml(html) {
    var s = clean(html), warnings = [], blocks = [], i = 0, n = s.length, buf = "", cur = null, tbl = null, cell = null, row = null, skip = "", headLevel = 0, depthTable = 0, liStack = 0, usedPre = false;
    function flushText() {
      var t = squash(decodeEntities(buf)); buf = ""; if (!t) return;
      if (cell !== null) { cell += (cell ? " " : "") + t; return; }
      if (headLevel) { blocks.push({ kind: "heading", level: headLevel, text: t }); return; }
      blocks.push({ kind: "paragraph", text: (liStack ? "• " : "") + t });
    }
    function breakBlock() { flushText(); }
    while (i < n) {
      var lt = s.indexOf("<", i);
      if (lt < 0) { if (!skip) buf += s.slice(i); break; }
      if (!skip) buf += s.slice(i, lt);
      if (s.substr(lt, 4) === "<!--") { var ce = s.indexOf("-->", lt + 4); i = ce < 0 ? n : ce + 3; continue; }
      var gt = s.indexOf(">", lt + 1); if (gt < 0) { if (!skip) buf += s.slice(lt); break; }
      var tag = s.slice(lt + 1, gt), m = /^(\/?)([A-Za-z][A-Za-z0-9]*)/.exec(tag);
      i = gt + 1; if (!m) { if (!skip) buf += "<"; i = lt + 1; continue; }
      var closing = m[1] === "/", name = m[2].toLowerCase();
      if (skip) { if (closing && name === skip) skip = ""; continue; }
      if (!closing && (name === "script" || name === "style" || name === "head" || name === "noscript") && !/\/\s*$/.test(tag)) { flushText(); skip = name; continue; }
      if (/^h[1-6]$/.test(name)) { flushText(); headLevel = closing ? 0 : Number(name.charAt(1)); continue; }
      if (name === "br") { if (cell !== null) { flushTextInCell(); cell += " "; } else { breakBlock(); } continue; }
      if (name === "table") { flushText(); if (!closing) { depthTable++; if (depthTable === 1) { tbl = { kind: "table", rows: [], header: false }; } } else if (depthTable > 0) { depthTable--; if (depthTable === 0 && tbl) { if (row) { tbl.rows.push(row); row = null; } if (tbl.rows.length) blocks.push(tbl); tbl = null; cell = null; } } continue; }
      if (tbl && depthTable === 1) {
        if (name === "tr") { flushCellOnly(); if (row && row.length) tbl.rows.push(row); row = closing ? null : []; continue; }
        if (name === "td" || name === "th") { if (!closing) { flushCellOnly(); cell = ""; if (name === "th" && tbl.rows.length === 0) tbl.header = true; } else { flushCellOnly(); } continue; }
      }
      if (name === "ul" || name === "ol") { flushText(); continue; }
      if (name === "li") { flushText(); liStack = closing ? 0 : 1; continue; }
      if (name === "pre") { usedPre = true; }
      if (BLOCK_TAGS[name]) { flushText(); continue; }
    }
    function flushCellOnly() { flushTextInCell(); if (cell !== null) { if (!row) row = []; row.push(squash(cell)); cell = null; } }
    function flushTextInCell() { if (cell !== null) { var t = squash(decodeEntities(buf)); buf = ""; if (t) cell += (cell ? " " : "") + t; } }
    flushText();
    if (row && tbl) { tbl.rows.push(row); }
    if (tbl && tbl.rows.length) blocks.push(tbl);
    blocks = blocks.map(function (b) { if (b.kind === "table") { var w = b.rows.reduce(function (m2, x) { return Math.max(m2, x.length); }, 0); b.rows = b.rows.map(function (x) { var o = x.slice(); while (o.length < w) o.push(""); return o; }); } return b; });
    if (!blocks.length) warnings.push("No readable text was found in this HTML file.");
    if (usedPre) warnings.push("Pre-formatted text (<pre>) was found. Its line breaks are not kept, so check any lists or layouts in the preview.");
    return { blocks: blocks, warnings: warnings };
  }

  // ---------------------------------------------------------------- RTF
  var RTF_SKIP = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, header: 1, footer: 1, headerl: 1, headerr: 1, footerl: 1, footerr: 1, footnote: 1, themedata: 1, colorschememapping: 1, latentstyles: 1, datastore: 1, listtable: 1, listoverridetable: 1, rsidtbl: 1, generator: 1, object: 1, fldinst: 1, bkmkstart: 1, bkmkend: 1 };
  /* parseRtf(text) -> { blocks, warnings }   text, paragraphs and simple tables only. Pictures, headers and footers are not extracted. */
  function parseRtf(src) {
    var s = clean(src), warnings = [], blocks = [], i = 0, n = s.length, stack = [], skipDepth = -1, uc = 1, out = "", rowCells = [], cellText = "", inTable = false, tbl = null, sawPict = false;
    if (s.slice(0, 5) !== "{\\rtf") return { blocks: [], warnings: ["This does not look like an RTF file (it does not start with {\\rtf)."] };
    function emit(t) { if (skipDepth >= 0) return; if (inTable) cellText += t; else out += t; }
    function endPara() {
      if (inTable) { cellText += " "; return; }
      var t = squash(out); out = ""; if (t) blocks.push({ kind: "paragraph", text: t });
    }
    function endCell() { rowCells.push(squash(cellText)); cellText = ""; }
    function endRow() { if (cellText.trim()) endCell(); if (rowCells.length) { if (!tbl) tbl = { kind: "table", rows: [], header: false }; tbl.rows.push(rowCells); } rowCells = []; }
    function closeTable() { if (tbl) { var w = tbl.rows.reduce(function (m, x) { return Math.max(m, x.length); }, 0); tbl.rows = tbl.rows.map(function (x) { var o = x.slice(); while (o.length < w) o.push(""); return o; }); blocks.push(tbl); tbl = null; } inTable = false; }
    var pendingBytes = [];
    function flushBytes() { if (pendingBytes.length) { var t = new TextDecoder("windows-1252").decode(new Uint8Array(pendingBytes)); pendingBytes = []; emit(t); } }
    while (i < n) {
      var ch = s.charAt(i);
      if (ch === "{") { flushBytes(); stack.push({ uc: uc, skip: skipDepth }); i++; var nx = s.slice(i, i + 40); var md = /^\\\*\\?([a-z]+)?/.exec(nx); if (/^\\\*/.test(nx)) { if (skipDepth < 0) skipDepth = stack.length; } else { var mw = /^\\([a-z]+)/.exec(nx); if (mw && RTF_SKIP[mw[1]] && skipDepth < 0) { skipDepth = stack.length; if (mw[1] === "pict") sawPict = true; } } continue; }
      if (ch === "}") { flushBytes(); var st = stack.pop(); if (st) { uc = st.uc; if (skipDepth >= stack.length + 1) skipDepth = st.skip; } i++; continue; }
      if (ch === "\\") {
        var c2 = s.charAt(i + 1);
        if (c2 === "\\" || c2 === "{" || c2 === "}") { flushBytes(); emit(c2); i += 2; continue; }
        if (c2 === "'") { var hx = s.substr(i + 2, 2); if (/^[0-9a-fA-F]{2}$/.test(hx)) { if (skipDepth < 0) pendingBytes.push(parseInt(hx, 16)); i += 4; continue; } i += 2; continue; }
        if (c2 === "~") { flushBytes(); emit(" "); i += 2; continue; }
        if (c2 === "_") { flushBytes(); emit("-"); i += 2; continue; }
        if (c2 === "-" || c2 === "*") { i += 2; continue; }
        var mc = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40));
        if (!mc) { i += 2; continue; }
        flushBytes();
        var w = mc[1], v = mc[2] === undefined ? null : parseInt(mc[2], 10); i += mc[0].length;
        if (w === "uc") { uc = v == null ? 1 : v; }
        else if (w === "u") { if (v != null) { var cp = v < 0 ? v + 65536 : v; emit(String.fromCharCode(cp)); var k = uc; while (k > 0 && i < n) { if (s.charAt(i) === "\\" && s.charAt(i + 1) === "'") i += 4; else i++; k--; } } }
        else if (w === "par" || w === "line" || w === "sect") { if (!inTable) endPara(); else cellText += " "; }
        else if (w === "tab") emit(" ");
        else if (w === "emdash") emit("—"); else if (w === "endash") emit("–"); else if (w === "bullet") emit("•");
        else if (w === "lquote") emit("‘"); else if (w === "rquote") emit("’"); else if (w === "ldblquote") emit("“"); else if (w === "rdblquote") emit("”");
        else if (w === "intbl") { if (!inTable) { out = squash(out) ? (endPara(), "") : ""; inTable = true; } }
        else if (w === "cell") { if (skipDepth < 0) { inTable = true; endCell(); } }
        else if (w === "row") { if (skipDepth < 0) endRow(); }
        else if (w === "pard") { if (inTable && !rowCells.length && !cellText.trim()) { var run = /^(?:\\[a-zA-Z]+-?\d* ?)*/.exec(s.slice(i))[0]; if (!/\\intbl\b/.test(run)) closeTable(); } }
        continue;
      }
      if (ch === "\n") { i++; continue; }
      if (skipDepth < 0) { emit(ch); } i++;
      if (inTable && tbl && s.slice(i, i + 4) === "\\par" && !/\\intbl/.test(s.slice(i, i + 80))) { /* paragraph outside table follows */ }
    }
    flushBytes(); if (cellText.trim()) endCell(); if (rowCells.length) endRow(); closeTable(); endPara();
    if (sawPict) warnings.push("Pictures in the RTF file were skipped.");
    if (!blocks.length) warnings.push("No readable text was found in this RTF file.");
    return { blocks: blocks, warnings: warnings };
  }

  // ---------------------------------------------------------------- one entry point per file
  /* extract(name, Uint8Array) -> { ok, error, ext, encoding, blocks, warnings, stats } */
  function extract(name, u8) {
    var d = detect(name); if (!d.ok) return { ok: false, error: d.message, ext: d.ext, blocks: [], warnings: [] };
    if (d.tool) return { ok: false, error: "This type is read by the import worker with the import tools (pc-import-worker.js), not by extract().", ext: d.ext, blocks: [], warnings: [] };
    var res, dec;
    if (d.ext === "rtf") { dec = decodeText(u8); res = parseRtf(dec.text); }
    else { dec = decodeText(u8); if (d.ext === "txt") res = parseTxt(dec.text); else if (d.ext === "csv") res = parseCsv(dec.text); else res = parseHtml(dec.text); }
    var warnings = (dec.warning ? [dec.warning] : []).concat(res.warnings || []);
    if (!res.blocks.length) return { ok: false, error: warnings.length ? warnings[warnings.length - 1] : "Nothing could be read from this file.", ext: d.ext, encoding: dec.encoding, blocks: [], warnings: warnings };
    return { ok: true, error: "", ext: d.ext, encoding: dec.encoding, blocks: res.blocks, warnings: warnings, method: d.ext === "csv" ? "table_sheet" : "text", stats: stats(res.blocks) };
  }
  function stats(blocks) {
    var s = { headings: 0, paragraphs: 0, tables: 0, tableRows: 0, chars: 0 };
    blocks.forEach(function (b) { if (b.kind === "heading") { s.headings++; s.chars += b.text.length; } else if (b.kind === "paragraph") { s.paragraphs++; s.chars += b.text.length; } else { s.tables++; s.tableRows += b.rows.length; b.rows.forEach(function (r) { r.forEach(function (c) { s.chars += c.length; }); }); } });
    return s;
  }

  // ---------------------------------------------------------------- blocks -> section documents (fields of guideline_sections, without the stamp fields)
  function splitLong(text, max) {
    var out = [], t = text;
    while (t.length > max) { var cut = t.lastIndexOf("\n\n", max); if (cut < max * 0.5) cut = t.lastIndexOf("\n", max); if (cut < max * 0.5) cut = t.lastIndexOf(". ", max) + 1; if (cut < max * 0.5) cut = t.lastIndexOf(" ", max); if (cut <= 0) cut = max; out.push(t.slice(0, cut).trim()); t = t.slice(cut).trim(); }
    if (t) out.push(t);
    return out;
  }
  function tableText(rows) { return rows.map(function (r) { return r.join("\t"); }).join("\n"); }
  /* toSections(blocks, opts) -> [{ seq, kind, headingPath, pageFrom, pageTo, text, tableRows, ocr, ocrConfidence, reviewStatus }]
     seq starts at 1. A new section starts at each heading (a heading repeated back to back does not start a new one). A run of paragraphs under one
     heading path is joined into sections of at most MAX_SECTION_CHARS. A table is its own section(s) of at most MAX_TABLE_ROWS_PER_SECTION rows; the header row
     is repeated in each part. Blocks may carry page (and pageTo) and ocr / conf; the section keeps the page range and says if any text in it came from OCR. */
  function toSections(blocks, opts) {
    opts = opts || {}; var max = opts.maxChars || MAX_SECTION_CHARS, secs = [], path = [], run = [], seq = 0;
    function pages(list) { var lo = null, hi = null; list.forEach(function (b) { var a = typeof b.page === "number" ? b.page : null, z = typeof b.pageTo === "number" ? b.pageTo : a; if (a !== null) { lo = lo === null ? a : Math.min(lo, a); hi = hi === null ? z : Math.max(hi, z); } }); return [lo, hi]; }
    function ocrOf(list) { var o = list.filter(function (b) { return b.ocr; }); if (!o.length) return { ocr: false, conf: null }; var cs = o.map(function (b) { return typeof b.conf === "number" ? b.conf : null; }).filter(function (c) { return c !== null; }); return { ocr: true, conf: cs.length ? Math.round(cs.reduce(function (m, c) { return m + c; }, 0) / cs.length * 10) / 10 : null }; }
    function mk(kind, text, rows, list) { seq++; var pg = pages(list), oc = ocrOf(list), o = { seq: seq, kind: kind, headingPath: path.slice(), pageFrom: pg[0], pageTo: pg[1], text: text, tableRows: rows || [], ocr: oc.ocr, ocrConfidence: oc.conf, reviewStatus: "unreviewed" }; secs.push(o); return o; }
    function flushRun() { if (!run.length) return; var list = run; run = []; var joined = list.map(function (b) { return b.text; }).join("\n\n"); splitLong(joined, max).forEach(function (t) { mk("paragraph", t, null, list); }); }
    var levels = [];
    blocks.forEach(function (b) {
      if (b.kind === "heading") { var lv = b.level || 1; if (levels.length && levels[levels.length - 1] === lv && path[path.length - 1] === b.text) return; /* the same heading repeated (a running page header) does not start a new section */ flushRun(); while (levels.length && levels[levels.length - 1] >= lv) { levels.pop(); path.pop(); } levels.push(lv); path.push(b.text); return; }
      if (b.kind === "paragraph") { run.push(b); return; }
      flushRun();
      var rows = b.rows, header = b.header && rows.length > 1 ? rows[0] : null, body = header ? rows.slice(1) : rows, step = MAX_TABLE_ROWS_PER_SECTION - (header ? 1 : 0), p;
      for (p = 0; p < body.length || (p === 0 && !body.length); p += step) {
        var chunk = body.slice(p, p + step), part = header ? [header].concat(chunk) : chunk, txt = tableText(part);
        if (txt.length > max) { splitLong(txt, max).forEach(function (t2) { mk("table", t2, [], [b]); }); }
        else mk("table", txt, part.map(function (r) { return { cells: r }; }), [b]);
        if (!body.length) break;
      }
    });
    flushRun();
    return secs;
  }

  /* summary(sections) -> { count, chars, overWarn, message } */
  function summary(sections) {
    var chars = sections.reduce(function (m, s) { return m + s.text.length; }, 0), over = sections.length > WARN_SECTIONS;
    return { count: sections.length, chars: chars, overWarn: over, message: over ? "This import would save " + sections.length + " section documents. That is more than " + WARN_SECTIONS + " and uses a large part of the daily write limit on the free plan. Choose only the chapters you need." : "" };
  }

  var api = {
    MAX_FILE_BYTES: MAX_FILE_BYTES, MAX_SECTION_CHARS: MAX_SECTION_CHARS, WARN_SECTIONS: WARN_SECTIONS, MAX_TABLE_ROWS_PER_SECTION: MAX_TABLE_ROWS_PER_SECTION,
    extOf: extOf, detect: detect, validate: validate, sha256Hex: sha256Hex, sha256Plain: sha256Plain, decodeText: decodeText,
    parseTxt: parseTxt, parseCsv: parseCsv, parseHtml: parseHtml, parseRtf: parseRtf, extract: extract, toSections: toSections, summary: summary, stats: stats, decodeEntities: decodeEntities
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCI = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this));
