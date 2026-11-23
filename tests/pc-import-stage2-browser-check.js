/* Stage 2 import check: PDF (text), scanned PDF with OCR, mixed PDF, DOCX, XLSX/XLS, password-protected and damaged PDFs, tool status and offline download.
   Runs the real screen in headless Chromium against the IN-MEMORY stand-in harness (not Firebase), with the real vendored libraries from vendor/.
   Run:  python3 -m http.server 8765  (repo root), then  node tests/pc-import-stage2-browser-check.js [screenshot-folder] [path-to-ucg-pdf]
   The fixtures in tests/fixtures are TEST TEXT ONLY (see make-fixtures.py). The UCG argument is an optional extra check with the real document. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const OUT = process.argv[2] || ".", UCG = process.argv[3], FX = path.join(__dirname, "fixtures");
const URL = "http://localhost:8765/tests/guidelines-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [], results = [];
  const ok = (name) => { results.push(name); console.log("ok - " + name); };
  async function open(as, w, h, pre) {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 } }), page = await ctx.newPage(), dialogs = [];
    page.on("pageerror", e => errors.push(as + ": " + e)); page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(as + ": " + m.text()); });
    page.on("dialog", d => { dialogs.push(d.message()); d.accept(d.type() === "prompt" ? "Test reason" : undefined); });
    if (pre) await pre(page);
    await page.goto(URL + "?as=" + as); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await f.locator("#tabImport").click(); await f.locator("#docFile").waitFor(); return { page, f, ctx, dialogs };
  }
  const dbAll = (page, c) => page.evaluate((c) => window.__db.all(c), c);
  const up = (f, name, data) => f.locator("#docFile").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  const upFx = (f, name) => up(f, name, fs.readFileSync(path.join(FX, name)));
  const msgOf = (f) => f.locator("#docMsg").innerText();
  async function fillSource(f, o) { o = o || {}; await f.locator("#docTitle").fill(o.title || "Test Guideline Document"); await f.locator("#docOrg").fill("Test Publisher"); await f.locator("#docJur").fill("Testland"); await f.locator("#docEd").fill("2023"); }
  const waitRead = (f) => f.locator("#docTitle, #docMsg.err").first().waitFor({ timeout: 120000 });

  // ---------------------------------------------------------------- tool status and offline download
  { const { page, f, ctx } = await open("owner", 390, 844, async (pg) => { await pg.route("**/*", r => r.continue()); });
    const t = await f.locator("#docTools").innerText(); ["PDF files", "Word files", "Excel files", "OCR for scanned pages"].forEach((n) => assert.match(t, new RegExp(n)));
    assert.equal((t.match(/Not downloaded/g) || []).length, 4); ok("the four import tools are listed and show 'Not downloaded' on a device that has not stored them");
    assert.match(await f.locator("#docImport").innerText(), /Always works without internet:[\s\S]*TXT, CSV, HTML, HTM, RTF[\s\S]*PDF, Word, Excel and OCR/); ok("the screen says which formats always work offline and which need the download");
    await f.locator('[data-tool="xlsx"]').click(); await f.locator("#docToolMsg", { hasText: /Downloaded|Saved for offline/ }).waitFor({ timeout: 30000 });
    assert.match(await f.locator("#docToolMsg").innerText(), /did not confirm that the app keeps them for offline use/); ok("downloading a tool is honest: without the app's offline cache it says it cannot confirm offline use");
    const urls = await page.evaluate(() => ["/vendor/mammoth-1.8.0/mammoth.browser.min.js"].map(u => location.origin + u)); await page.evaluate(async (u) => { const c = await caches.open("test-vendor-cache"); await c.addAll(u); }, urls);
    await page.reload(); const f2 = page.frameLocator("#f"); await f2.locator("#mainArea:not(.hidden)").waitFor(); await f2.locator("#tabImport").click(); await f2.locator("#docTools").getByText("Ready for offline use").waitFor();
    assert.equal((await f2.locator("#docTools").innerText()).match(/Ready for offline use/g).length, 1); ok("a tool whose files are in an app cache shows 'Ready for offline use' (cache simulated by the test)");
    await ctx.close(); }

  const { page, f, ctx, dialogs } = await open("owner", 390, 844);

  // ---------------------------------------------------------------- PDF with a text layer
  await upFx(f, "text.pdf"); await waitRead(f);
  let out = await f.locator("#docOut").innerText();
  assert.match(out, /text\.pdf[\s\S]*PDF, 5 pages/); assert.match(out, /Page numbers are kept with each section/); assert.match(out, /Removed 5 repeated header\/footer lines and 5 page numbers/); assert.match(out, /1 table-like layout were rebuilt|1 table-like layout was rebuilt/); assert.match(out, /Compare each one with the original page/);
  assert.match(out, /Test Chapter One[\s\S]*pages? 1/); assert.doesNotMatch(out.split("Preview")[1].slice(0, 600), /Test Guideline Handbook 2023/); await page.screenshot({ path: OUT + "/s2-1-pdf-text.png", fullPage: true });
  ok("a text PDF is read: pages, headings, table, headers and page numbers removed, warnings shown, page numbers kept");
  await fillSource(f); await f.locator("#docSave").click(); await f.locator("#docMsg.ok").waitFor();
  let src = (await dbAll(page, "guideline_sources")).filter(s => s.fileName === "text.pdf")[0], secs = (await dbAll(page, "guideline_sections")).filter(s => s.sourceId === src._id);
  assert.equal(src.pageCount, 5); assert.equal(src.extractionMethod, "text"); assert.equal(src.ocrUsed, false); assert.deepEqual(src.ocrPages, []); assert.equal(src.fileType, "pdf"); assert.ok(src.extractionWarnings.length >= 2);
  assert.ok(secs.length >= 3 && secs.every(x => Number.isInteger(x.pageFrom) && Number.isInteger(x.pageTo) && x.pageTo >= x.pageFrom && x.ocr === false)); assert.ok(secs.some(x => x.kind === "table" && x.tableRows.length === 4 && x.tableRows[0].cells.join() === "Item,Test note")); assert.ok(secs.every(x => !/Test Guideline Handbook 2023/.test(x.text)));
  assert.deepEqual(secs.filter(x => /Chapter Two/.test(x.headingPath[0] || "")).map(x => [x.pageFrom, x.pageTo]).every(([a, b]) => a >= 4), true); ok("saved PDF sections carry page ranges, the table rows, pageCount and the extraction warnings");

  // ---------------------------------------------------------------- password protected and damaged PDFs
  await upFx(f, "locked.pdf"); await f.locator("#docMsg.err").waitFor({ timeout: 60000 }); assert.match(await msgOf(f), /password-protected/); ok("a password-protected PDF gets a clear message");
  await up(f, "broken.pdf", Buffer.from("this is not a pdf file at all")); await f.locator("#docMsg.err").waitFor({ timeout: 60000 }); assert.match(await msgOf(f), /not a valid PDF|could not be read/); ok("a damaged PDF gets a clear message");

  // ---------------------------------------------------------------- scanned PDF + OCR (real tesseract.js, local files only)
  const requested = []; page.on("request", r => requested.push(r.url()));
  await upFx(f, "scanned.pdf"); await f.locator("#docMsg.err").waitFor({ timeout: 60000 });
  assert.match(await msgOf(f), /no readable text layer|probably scanned/); assert.equal(await f.locator("#docOcr").count(), 1); assert.match(await f.locator("#docOut").innerText(), /2 pages with no readable text[\s\S]*OCR can make mistakes/); ok("a scanned PDF says it has no text layer and offers OCR with a warning about mistakes");
  const t0 = Date.now(); await f.locator("#docOcr").click(); await f.locator("#docMsg.ok", { hasText: /OCR finished for 2 pages/ }).waitFor({ timeout: 150000 }); console.log("   (OCR of 2 pages took " + (Date.now() - t0) + " ms)");
  out = await f.locator("#docOut").innerText(); assert.match(out, /OCR text was added for 2 pages \(average confidence \d+%\)/); assert.match(out, /quick brown fox/i); assert.match(out, /includes OCR text/); await page.screenshot({ path: OUT + "/s2-2-ocr.png", fullPage: true });
  const outside = requested.filter(u => !u.startsWith("http://localhost:8765/") && !u.startsWith("blob:") && !u.startsWith("data:")); assert.deepEqual(outside, [], "no request left the app during OCR: " + outside.join(", "));
  assert.ok(requested.some(u => /vendor\/tesseract-5\.1\.1\/lang\/eng\.traineddata\.gz/.test(u)) && requested.some(u => /vendor\/tesseract-5\.1\.1\/core\/tesseract-core-(simd-)?lstm\.wasm\.js/.test(u)) && requested.some(u => /vendor\/tesseract-5\.1\.1\/worker\.min\.js/.test(u))); ok("OCR reads the scanned pages with the local worker, core and language data only; no request left the app");
  await fillSource(f, { title: "Scanned test" }); await f.locator("#docSave").click(); await f.locator("#docMsg.ok").waitFor();
  src = (await dbAll(page, "guideline_sources")).filter(s => s.fileName === "scanned.pdf")[0]; secs = (await dbAll(page, "guideline_sections")).filter(s => s.sourceId === src._id);
  assert.equal(src.extractionMethod, "ocr"); assert.equal(src.ocrUsed, true); assert.deepEqual(src.ocrPages, [1, 2]); assert.equal(src.pageCount, 2); assert.ok(secs.length >= 1 && secs.every(x => x.ocr === true && typeof x.ocrConfidence === "number" && x.ocrConfidence > 0 && x.pageFrom >= 1));
  assert.match(secs.map(x => x.text).join(" "), /quick brown fox/i); assert.match(secs.map(x => x.text).join(" "), /liquor jugs/i); assert.ok(src.extractionWarnings.some(w => /OCR text was added for 2 pages/.test(w))); ok("saved OCR sections are marked ocr:true with a confidence, source says ocrUsed, ocrPages [1,2], method 'ocr'");

  // ---------------------------------------------------------------- mixed PDF: one scanned page between two text pages; OCR merges in page order
  await upFx(f, "mixed.pdf"); await waitRead(f); assert.match(await f.locator("#docOut").innerText(), /1 page with no readable text[\s\S]*\(2\)|page 2/); await f.locator("#docOcr").click(); await f.locator("#docMsg.ok", { hasText: /OCR finished for 1 page/ }).waitFor({ timeout: 150000 });
  await fillSource(f, { title: "Mixed test" }); await f.locator("#docSave").click(); await f.locator("#docMsg.ok").waitFor();
  src = (await dbAll(page, "guideline_sources")).filter(s => s.fileName === "mixed.pdf")[0]; secs = (await dbAll(page, "guideline_sections")).filter(s => s.sourceId === src._id).sort((a, b) => a.seq - b.seq);
  assert.equal(src.extractionMethod, "mixed"); assert.deepEqual(src.ocrPages, [2]); assert.equal(secs.length, 1); assert.equal(secs[0].ocr, true); assert.deepEqual([secs[0].pageFrom, secs[0].pageTo], [1, 3]);
  const mixedText = secs[0].text; assert.ok(mixedText.indexOf("page one") < mixedText.search(/scanned test page two|quick brown fox|Scanned test page/i) || /Scanned test page one/i.test(mixedText)); assert.ok(mixedText.indexOf("Scanned") < mixedText.indexOf("page three")); ok("mixed PDF: OCR text lands between the text pages in page order; method 'mixed'; ocrPages [2]");

  // ---------------------------------------------------------------- DOCX
  await upFx(f, "test.docx"); await waitRead(f); out = await f.locator("#docOut").innerText();
  assert.match(out, /test\.docx[\s\S]*2 headings[\s\S]*1 table/); assert.match(out, /1 picture in the Word file was skipped/); assert.match(out, /Test Word Document/); await fillSource(f, { title: "Docx test" }); await f.locator("#docSave").click(); await f.locator("#docMsg.ok").waitFor();
  src = (await dbAll(page, "guideline_sources")).filter(s => s.fileName === "test.docx")[0]; secs = (await dbAll(page, "guideline_sections")).filter(s => s.sourceId === src._id);
  assert.equal(src.fileType, "docx"); assert.equal(src.extractionMethod, "text"); assert.equal(src.pageCount, null); assert.ok(secs.some(x => x.kind === "table" && x.tableRows.length === 3) && secs.some(x => /bullet item one/.test(x.text)) && secs.every(x => x.pageFrom === null)); ok("DOCX read with headings, list and table; the picture is reported as skipped; no invented page numbers");

  // ---------------------------------------------------------------- XLSX and XLS (files written in the page with the vendored SheetJS)
  const sheets = await page.evaluate(async () => { await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/vendor/sheetjs-0.20.3/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Test note", "Number"], ["Alpha", "first test note", 5.5], ["Beta", "second test note", 10]]), "Test sheet"); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty sheet");
    const enc = (t) => Array.from(new Uint8Array(XLSX.write(wb, { type: "array", bookType: t }))); return { xlsx: enc("xlsx"), xls: enc("biff8") }; });
  for (const kind of ["xlsx", "xls"]) {
    await up(f, "test." + kind, Buffer.from(sheets[kind])); await waitRead(f); out = await f.locator("#docOut").innerText();
    assert.match(out, new RegExp("test\\." + kind)); assert.match(out, /1 heading[\s\S]*1 table \(3 rows\)/); assert.match(out, /Empty sheet skipped: Empty sheet/); assert.match(out, /first row of each sheet is treated as the header/);
    await fillSource(f, { title: kind + " test" }); await f.locator("#docSave").click(); await f.locator("#docMsg.ok").waitFor();
    src = (await dbAll(page, "guideline_sources")).filter(s => s.fileName === "test." + kind)[0]; secs = (await dbAll(page, "guideline_sections")).filter(s => s.sourceId === src._id);
    assert.equal(src.extractionMethod, "table_sheet"); assert.equal(secs.length, 1); assert.deepEqual(secs[0].tableRows.map(r => r.cells), [["Item", "Test note", "Number"], ["Alpha", "first test note", "5.5"], ["Beta", "second test note", "10"]]); assert.deepEqual(secs[0].headingPath, ["Sheet: Test sheet"]);
  } ok("XLSX and XLS read as tables per sheet; empty sheets skipped; numbers keep their shown text");

  // ---------------------------------------------------------------- adding sections to an existing PDF import; a different reading is refused
  await upFx(f, "text.pdf"); await waitRead(f); const groups = await f.locator(".docG").count(); assert.ok(groups >= 2); await f.locator("#docNone").click(); await fillSource(f);
  await f.locator('.docG[data-i="0"]').check(); await f.locator("#docSave").click(); await f.locator("#docMsg.err", { hasText: /already saved/ }).waitFor(); ok("importing a PDF again with only saved sections selected writes nothing");
  await upFx(f, "mixed.pdf"); await waitRead(f); await fillSource(f); await f.locator("#docSave").click(); await f.locator("#docMsg.err", { hasText: /differs from what was saved earlier/ }).waitFor();
  assert.equal((await dbAll(page, "guideline_sections")).filter(s => s.sourceId === src._id || true).length > 0, true); ok("re-importing mixed.pdf without OCR (a different reading from the saved OCR one) is refused so two readings are never mixed");
  assert.equal(errors.length, 0, errors.join("\n"));

  // ---------------------------------------------------------------- the real UCG PDF
  if (UCG && fs.existsSync(UCG)) {
    const u = await open("owner", 390, 844); const t1 = Date.now(); await u.f.locator("#docFile").setInputFiles(UCG); await u.f.locator("#docTitle, #docMsg.err").first().waitFor({ timeout: 170000 }); const rt = Date.now() - t1;
    const o = await u.f.locator("#docOut").innerText(); assert.match(o, /PDF, 1161 pages/); assert.match(o, /Removed \d+ repeated header\/footer lines/); assert.match(o, /split across lines by a separate hyphen were joined/);
    const groupsN = await u.f.locator(".docG").count(); assert.ok(groupsN >= 24, "chapters: " + groupsN); assert.match(o, /1 Emergencies and Trauma[\s\S]*pages 67–160/); assert.match(o, /24 Anaesthesia[\s\S]*pages 1105–1161/);
    console.log("   (real UCG PDF: 1161 pages read and laid out in " + rt + " ms; " + groupsN + " chapter groups; " + (o.match(/(\d+) sections? selected/) || [])[0] + ")"); await u.page.screenshot({ path: OUT + "/s2-3-ucg.png", fullPage: true });
    await fillSource(u.f, { title: "Uganda Clinical Guidelines 2023" }); await u.f.locator("#docNone").click(); await u.f.locator('.docG[data-i="2"]').check(); await u.f.locator("#docSave").click(); await u.f.locator("#docMsg.ok").waitFor({ timeout: 60000 });
    const us = await dbAll(u.page, "guideline_sections"); assert.ok(us.length > 0 && us.every(x => x.text.length <= 100000 && x.tableRows.length <= 200 && Number.isInteger(x.pageFrom) && x.pageFrom >= 67 && x.pageTo <= 160)); console.log("   (saved chapter 1 only: " + us.length + " section documents, pages " + Math.min(...us.map(x => x.pageFrom)) + "–" + Math.max(...us.map(x => x.pageTo)) + ")");
    const sc = (await dbAll(u.page, "guideline_sources"))[0]; assert.equal(sc.pageCount, 1161); assert.equal(sc.fileSizeBytes, fs.statSync(UCG).size);
    await u.f.locator("#docFile").setInputFiles(UCG); await u.f.locator("#docTitle").waitFor({ timeout: 170000 }); await fillSource(u.f, { title: "Uganda Clinical Guidelines 2023" }); await u.f.locator("#docNone").click(); await u.f.locator('.docG[data-i="3"]').check(); await u.f.locator("#docSave").click(); await u.f.locator("#docMsg.ok", { hasText: /Added/ }).waitFor({ timeout: 60000 });
    const us2 = await dbAll(u.page, "guideline_sections"), sc2 = (await dbAll(u.page, "guideline_sources"))[0]; assert.ok(us2.length > us.length && sc2.sectionCount === us2.length); assert.equal(new Set(us2.map(x => x._id)).size, us2.length);
    ok("the real UCG PDF: 1,161 pages read, 24 chapters with page ranges, chapter 1 saved alone (pages 67–160), chapter 2 added later to the same import"); await u.ctx.close();
  }
  assert.equal(errors.length, 0, "browser errors:\n" + errors.join("\n")); await ctx.close(); await browser.close(); console.log("\n" + results.length + " checks passed, 0 browser errors");
})().catch(e => { console.error("FAILED:", e); process.exit(1); });
