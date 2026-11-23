/* MediStock Cloud — guideline import worker (Developer 4). Reads a file off the main thread so the page never freezes.
   Message in:  { id, name, buffer }                          TXT, CSV, HTML, RTF, DOCX, XLSX, XLS
                { id, op: "pdf", name, hash, pages }          PDF: the page reads pdf.js (which runs in its own worker) and sends the positioned text; the layout is built here
   Message out: { id, hash, ext, ok, error, toolMissing, encoding, method, warnings, stats, pdf, blocks, sections, preview }
   The vendored libraries are loaded only when a file of that type is chosen (nothing is fetched at start-up). Local paths only: no network address appears here.
   pdf.js is NOT loaded in this worker: its own worker script takes over the message channel of whatever worker loads it. */
importScripts("pc-import.js", "pc-import-pdf.js");

var VENDOR = { docx: "vendor/mammoth-1.8.0/mammoth.browser.min.js", xlsx: "vendor/sheetjs-0.20.3/xlsx.full.min.js" };
var loaded = {};

function toolError(tool, label) { var e = new Error("The import tool for " + label + " could not be loaded. If you are offline, connect once and use \"Download import tools for offline use\", then try again."); e.toolMissing = tool; return e; }
function need(tool) {
  if (loaded[tool]) return;
  try {
    if (tool === "docx") importScripts(VENDOR.docx);
    else if (tool === "xlsx") importScripts(VENDOR.xlsx);
  } catch (e) { throw toolError(tool, tool === "docx" ? "Word files" : "Excel files"); }
  loaded[tool] = true;
}

// ---------------------------------------------------------------- DOCX
function readDocx(buffer) {
  need("docx");
  var imgs = 0;
  return self.mammoth.convertToHtml({ arrayBuffer: buffer }, { convertImage: self.mammoth.images.imgElement(function () { imgs++; return Promise.resolve({ src: "" }); }) }).then(function (res) {
    var r = PCI.parseHtml(res.value), warnings = r.warnings.filter(function (w) { return !/<pre>/.test(w); }), seen = {};
    (res.messages || []).forEach(function (m) { var t = String(m.message || ""); if (m.type === "warning" && !seen[t]) { seen[t] = 1; if (warnings.length < 8) warnings.push("Word: " + t); } });
    if (imgs) warnings.push(imgs + " picture" + (imgs === 1 ? "" : "s") + " in the Word file " + (imgs === 1 ? "was" : "were") + " skipped. Text inside pictures is not read.");
    if (!r.blocks.some(function (b) { return b.kind === "heading"; }) && r.blocks.length) warnings.push("No heading styles were found in this Word file. The content is kept in order and the reviewer can organise it by hand.");
    return { blocks: r.blocks, warnings: warnings };
  }, function (err) { throw new Error("The Word file could not be read: " + (err && err.message || err)); });
}

// ---------------------------------------------------------------- XLSX / XLS
function readSheets(u8) {
  need("xlsx");
  var wb;
  try { wb = self.XLSX.read(u8, { type: "array", cellDates: true }); } catch (e) { throw new Error("The spreadsheet could not be read: " + (e && e.message || e)); }
  var blocks = [], warnings = [], empty = [];
  (wb.SheetNames || []).forEach(function (nm) {
    var ws = wb.Sheets[nm], rows = self.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: false });
    rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? "" : c).replace(/\s+/g, " ").trim(); }); }).filter(function (r) { return r.some(function (c) { return c !== ""; }); });
    if (!rows.length) { empty.push(nm); return; }
    var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0); rows = rows.map(function (r) { while (r.length < w) r.push(""); return r; });
    blocks.push({ kind: "heading", level: 1, text: "Sheet: " + nm }); blocks.push({ kind: "table", rows: rows, header: true });
  });
  if (empty.length) warnings.push("Empty sheet" + (empty.length === 1 ? "" : "s") + " skipped: " + empty.join(", ") + ".");
  if (blocks.length) warnings.push("Cell values are the text shown in the spreadsheet. The first row of each sheet is treated as the header. Formulas, comments, merged cells and hidden rows or columns are not interpreted.");
  return { blocks: blocks, warnings: warnings };
}

// ---------------------------------------------------------------- one file
function previewOf(blocks) { return blocks.slice(0, 40).map(function (b) { return b.kind === "table" ? { kind: "table", rows: b.rows.slice(0, 6), page: b.page } : { kind: b.kind, level: b.level || 0, text: b.text.slice(0, 600), page: b.page }; }); }

function handle(m) {
  var buf = m.buffer, u8 = new Uint8Array(buf), d = PCI.detect(m.name), ext = d.ext;
  return PCI.sha256Hex(u8).then(function (hash) {
    var out = { id: m.id, hash: hash, ext: ext, ok: false, error: "", encoding: "", method: "text", warnings: [], stats: null, pdf: null, blocks: [], sections: [], preview: [] };
    if (!d.ok) { out.error = d.message; return out; }
    var p;
    if (!d.tool) { var r = PCI.extract(m.name, u8); out.ok = r.ok; out.error = r.error; out.encoding = r.encoding || ""; out.method = r.method || "text"; out.warnings = r.warnings || []; out.blocks = r.blocks || []; p = Promise.resolve(out); }
    else if (d.tool === "pdf") { out.error = "PDF files are read by the page with pdf.js and sent here as positioned text (op: pdf)."; p = Promise.resolve(out); }
    else if (d.tool === "docx") p = readDocx(buf).then(function (r) { out.blocks = r.blocks; out.warnings = r.warnings; out.ok = r.blocks.length > 0; out.error = out.ok ? "" : "No readable text was found in this Word file."; return out; });
    else p = Promise.resolve().then(function () { var r = readSheets(u8); out.blocks = r.blocks; out.warnings = r.warnings; out.ok = r.blocks.length > 0; out.method = "table_sheet"; out.error = out.ok ? "" : "No data was found in this spreadsheet."; return out; });
    return p.then(function (o) { if (o.ok) { o.sections = PCI.toSections(o.blocks); o.stats = PCI.stats(o.blocks); o.preview = previewOf(o.blocks); } return o; });
  });
}

function handlePdf(m) {
  var out = { id: m.id, hash: m.hash, ext: "pdf", ok: false, error: "", encoding: "", method: "text", warnings: [], stats: null, pdf: null, blocks: [], sections: [], preview: [] };
  var r = PCIPDF.buildPdfBlocks(m.pages || []); out.blocks = r.blocks; out.warnings = r.warnings; out.pdf = r.stats; out.ok = r.blocks.length > 0;
  if (!out.ok) { out.error = r.warnings.length ? r.warnings[0] : "No text was found in this PDF."; out.sections = []; return out; }
  out.sections = PCI.toSections(out.blocks); out.stats = PCI.stats(out.blocks); out.preview = previewOf(out.blocks); return out;
}

self.onmessage = function (e) {
  var m = e.data || {};
  function fail(err) { self.postMessage({ id: m.id, error: String(err && err.message || err), toolMissing: err && err.toolMissing || "" }); }
  try { if (m.op === "pdf") self.postMessage(handlePdf(m)); else handle(m).then(function (o) { self.postMessage(o); }, fail); } catch (err) { fail(err); }
};
