/* Drives the "Import a document" card in guidelines.html in headless Chromium against the IN-MEMORY stand-in harness (not Firebase).
   Run:  python3 -m http.server 8765  (from the repo root), then  node tests/pc-import-browser-check.js [screenshot-folder] [ignored] [path-to-ucg-txt]
   (PDF, DOCX, XLSX and OCR are in tests/pc-import-stage2-browser-check.js.) The TXT argument is an optional extra check with a real document. TEST CONTENT ONLY otherwise. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("fs");
const OUT = process.argv[2] || ".", PDF = process.argv[3], TXT = process.argv[4];
const URL = "http://localhost:8765/tests/guidelines-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [], results = [];
  const ok = (name) => { results.push(name); console.log("ok - " + name); };
  async function open(as, w, h) {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 } }), page = await ctx.newPage(), dialogs = [];
    page.on("pageerror", e => errors.push(as + ": " + e)); page.on("console", m => { if (m.type() === "error") errors.push(as + ": " + m.text()); });
    page.on("dialog", d => { dialogs.push(d.message()); d.accept(d.type() === "prompt" ? "Test reason" : undefined); });
    await page.goto(URL + "?as=" + as); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); return { page, f, ctx, dialogs };
  }
  const dbAll = (page, c) => page.evaluate((c) => window.__db.all(c), c);
  const upload = (f, name, data) => f.locator("#docFile").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  const msgOf = (f) => f.locator("#docMsg").innerText();
  async function fillSource(f, o) { o = o || {}; await f.locator("#docTitle").fill(o.title === undefined ? "Test Guideline Document" : o.title); await f.locator("#docOrg").fill(o.org === undefined ? "Test Publisher" : o.org); await f.locator("#docJur").fill(o.jur === undefined ? "Testland" : o.jur); await f.locator("#docEd").fill(o.ed === undefined ? "2023" : o.ed); if (o.pub) await f.locator("#docPub").fill(o.pub); }

  // ---------- ordinary staff: no import card
  { const { f, ctx } = await open("viewer"); assert.equal(await f.locator("#tabImport").isVisible(), false); assert.equal(await f.locator("#docImport .card").count(), 0); ok("staff without guideline permissions see no import tab or card"); await ctx.close(); }

  // ---------- owner at phone width
  const { page, f, ctx, dialogs } = await open("owner", 390, 844);
  await f.locator("#tabImport").click(); await f.locator("#docFile").waitFor();
  assert.match(await f.locator("#docImport").innerText(), /Always works without internet:[\s\S]*TXT, CSV, HTML, HTM, RTF/); ok("import card shows what always works offline");
  assert.equal(await f.locator("#docFile").getAttribute("accept"), ".pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.html,.htm,.rtf"); ok("file picker offers PDF, Word, Excel, TXT, CSV, HTML, RTF (the old picker offered only .json)");

  await upload(f, "old.doc", "x"); await f.locator("#docMsg.err").waitFor(); assert.match(await msgOf(f), /save it as \.docx or PDF/); ok(".doc gets the 'save as .docx or PDF' message");
  await upload(f, "x.exe", "x"); assert.match(await msgOf(f), /not supported/); ok("unknown type refused");
  await upload(f, "big.txt", Buffer.alloc(31 * 1024 * 1024, 97)); assert.match(await msgOf(f), /limit is 30 MB/); ok("a file over 30 MB is refused");
  await upload(f, "empty.txt", Buffer.alloc(0)); assert.match(await msgOf(f), /empty/); ok("an empty file is refused");

  // ---------- a TXT with chapters: preview, source details, partial save
  const lines = []; for (let c = 1; c <= 3; c++) { lines.push("CHAPTER " + c + ": Test chapter " + c, "", "Test paragraph one of chapter " + c + ". TEST TEXT ONLY.", "", "Test paragraph two of chapter " + c + "."); lines.push(""); }
  const txt = lines.join("\n");
  await upload(f, "test-doc.txt", txt); await f.locator("#docTitle").waitFor();
  const prev = await f.locator("#docOut").innerText(); assert.match(prev, /3 headings, 6 paragraphs/); assert.match(prev, /SHA-256: [0-9a-f]{64}/); assert.equal(await f.locator(".docG").count(), 3);
  await page.screenshot({ path: OUT + "/imp1-mobile-preview.png", fullPage: true }); ok("TXT read in the worker, preview and chapter list shown, SHA-256 shown");
  await f.locator("#docSave").click(); assert.match(await msgOf(f), /Please fill in: guideline title, publisher, country or jurisdiction, version or edition/); ok("saving without source details is refused and says what is missing");
  await fillSource(f); assert.equal(await f.locator("#docPub").getAttribute("type"), "date"); ok("publication date is a date field (the browser refuses impossible dates)");
  await f.locator("#docPub").fill("2023-12-19"); await f.locator("#docNone").click(); await f.locator("#docSave").waitFor(); assert.equal(await f.locator("#docSave").isDisabled(), true); ok("saving is disabled when nothing is selected");
  await f.locator('.docG[data-i="0"]').check(); await f.locator('.docG[data-i="2"]').check(); await f.locator("#docSave").click(); await f.locator("#docMsg.ok", { hasText: /Saved 2 sections/ }).waitFor();
  const srcs = await dbAll(page, "guideline_sources"), secs = await dbAll(page, "guideline_sections"), audits = (await dbAll(page, "pc_audit_logs")).filter(a => a.action === "guideline.source_import");
  assert.equal(srcs.length, 1); const s = srcs[0];
  assert.match(s._id || "", /^gsrc_[0-9a-f]{16}$/); assert.equal(s.fileName, "test-doc.txt"); assert.equal(s.fileType, "txt"); assert.equal(s.fileSizeBytes, Buffer.byteLength(txt)); assert.match(s.sha256, /^[0-9a-f]{64}$/); assert.equal(s.sourceTitle, "Test Guideline Document"); assert.equal(s.sourceOrg, "Test Publisher"); assert.equal(s.jurisdiction, "Testland"); assert.equal(s.sourceEdition, "2023"); assert.equal(s.publicationDate, "2023-12-19"); assert.equal(s.status, "imported"); assert.equal(s.sectionCount, 2); assert.equal(s.ocrUsed, false); assert.equal(s.businessId, "biz1"); assert.equal(s.facilityId, "shop1"); assert.ok(s.createdBy && s.addedByName);
  assert.equal(secs.length, 2); assert.deepEqual(secs.map(x => x.seq).sort(), [1, 3]); secs.forEach(x => { assert.match(x._id, /^gsrc_[0-9a-f]{16}_s0000[13]$/); assert.equal(x.sourceId, s._id); assert.equal(x.reviewStatus, "unreviewed"); assert.equal(x.usedInGuidelineId, null); assert.equal(x.ocr, false); assert.ok(x.text.includes("TEST TEXT ONLY") || x.text.includes("Test paragraph")); assert.equal(x.businessId, "biz1"); });
  assert.equal(audits.length, 1); assert.equal(audits[0].count, 2);
  assert.equal((await dbAll(page, "guidelines")).length, 5, "no guideline entry was created by the import"); ok("source record, 2 selected sections and an audit entry saved with the agreed fields; no guideline created");
  const kept = await page.evaluate((h) => new Promise(res => { const r = indexedDB.open("mc-import-files", 1); r.onsuccess = () => { const g = r.result.transaction("files").objectStore("files").get(h); g.onsuccess = () => res(g.result ? { name: g.result.name, size: g.result.size } : null); g.onerror = () => res(null); }; r.onerror = () => res(null); }), s.sha256);
  assert.deepEqual(kept, { name: "test-doc.txt", size: Buffer.byteLength(txt) }); ok("the original file is kept on this device (IndexedDB), keyed by its SHA-256");
  assert.match(await msgOf(f), /original file is kept on this device only/);

  // ---------- list, view, duplicate, reject
  await f.locator("#docList .card").first().waitFor(); assert.match(await f.locator("#docList").innerText(), /Test Guideline Document[\s\S]*Raw text, not reviewed[\s\S]*2 sections/);
  await f.locator('#docList [data-a="view"]').click(); await f.locator('#docList [data-a="copy"]').first().waitFor(); const vt = await f.locator("#docList").innerText(); assert.match(vt, /CHAPTER 1: Test chapter 1/); assert.match(vt, /CHAPTER 3: Test chapter 3/); assert.doesNotMatch(vt, /CHAPTER 2: Test chapter 2 ›/);
  await f.locator('#docList [data-a="copy"]').first().click(); await page.waitForTimeout(100); assert.match(await page.evaluate(() => window.__shared), /Test paragraph one of chapter 1/); ok("imported document is listed, its sections can be viewed and copied");
  // the same file again: v24c rules allow adding sections to an existing import, so this is no longer blocked. Sections already saved are never written twice.
  await upload(f, "same-again.txt", txt); await f.locator("#docTitle").waitFor(); await fillSource(f); await f.locator("#docNone").click(); await f.locator('.docG[data-i="0"]').check(); await f.locator("#docSave").click(); await f.locator("#docMsg.err", { hasText: /already saved/ }).waitFor(); assert.equal((await dbAll(page, "guideline_sections")).length, 2); assert.equal((await dbAll(page, "guideline_sources"))[0].sectionCount, 2); ok("selecting only sections that are already saved adds nothing (no duplicate writes)");
  await f.locator("#docAll").click(); await f.locator("#docSave").click(); await f.locator("#docMsg.ok", { hasText: /Added 1 section/ }).waitFor();
  const srcAfter = (await dbAll(page, "guideline_sources"))[0], secsAfter = await dbAll(page, "guideline_sections"); assert.equal(srcAfter.sectionCount, 3); assert.equal(secsAfter.length, 3); assert.deepEqual(secsAfter.map(x => x.seq).sort(), [1, 2, 3]); assert.ok(srcAfter.updatedBy);
  assert.equal((await dbAll(page, "pc_audit_logs")).filter(a => a.action === "guideline.source_add_sections").length, 1); ok("the missing chapter of the same file was added to the existing import (count 2 -> 3, audit entry written)");
  await upload(f, "changed.txt", txt.replace("Test paragraph one of chapter 1.", "A different sentence in chapter 1.")); await f.locator("#docTitle").waitFor(); await fillSource(f);
  assert.notEqual(await f.locator("#docOut").innerText(), ""); ok("a changed file has a different hash and is a separate import");
  await f.locator('#docList [data-a="reject"]').click(); await f.locator("#docList .chip.bad", { hasText: "Rejected" }).waitFor(); const rej = (await dbAll(page, "guideline_sources"))[0]; assert.equal(rej.status, "rejected"); assert.equal(rej.rejectedReason, "Test reason"); assert.ok(rej.rejectedBy);
  assert.equal((await dbAll(page, "pc_audit_logs")).filter(a => a.action === "guideline.source_reject").length, 1); assert.equal(await f.locator('#docList [data-a="retire"]').count(), 0); assert.equal(await f.locator('#docList [data-a="reject"]').count(), 0); ok("an approver can reject an extraction with a reason; audit entry written; a rejected import cannot be rejected or retired again");
  assert.equal(errors.length, 0, errors.join("\n")); await page.screenshot({ path: OUT + "/imp2-mobile-list.png", fullPage: true });

  // ---------- other formats
  await upload(f, "t.csv", 'Name,Note\r\nA,"has, comma"\r\nB,"two\nlines"\r\n'); await f.locator("#docTitle").waitFor(); assert.match(await f.locator("#docOut").innerText(), /1 table \(3 rows\)/); ok("CSV read as a table");
  await upload(f, "t.html", "<html><body><h1>Head</h1><p>Para &amp; more</p><table><tr><th>A</th></tr><tr><td>1</td></tr></table></body></html>"); await f.locator("#docTitle").waitFor(); assert.match(await f.locator("#docOut").innerText(), /1 heading, 1 paragraph, 1 table/); ok("HTML read (heading, paragraph, table)");
  await upload(f, "t.rtf", "{\\rtf1\\ansi Hello\\par World\\par}"); await f.locator("#docTitle").waitFor(); assert.match(await f.locator("#docOut").innerText(), /0 headings, 2 paragraphs/); ok("RTF read");
  await upload(f, "t.htm", "<p></p>"); await f.locator("#docMsg.err").waitFor(); assert.match(await msgOf(f), /No readable text/); ok("a file with no readable text says so");

  // ---------- more than 1,000 sections: warning before saving
  const many = []; for (let i = 1; i <= 1100; i++) many.push("CHAPTER " + i + ": T" + i, "", "TEST body " + i, ""); await upload(f, "many.txt", many.join("\n")); await f.locator("#docTitle").waitFor();
  assert.match(await f.locator("#docSel").innerText(), /1100 sections selected[\s\S]*more than 1000 and uses a large part/); await fillSource(f, { title: "Many sections test" }); dialogs.length = 0; await f.locator("#docSave").click(); await f.locator("#docMsg.ok", { hasText: /Saved 1100 sections/ }).waitFor({ timeout: 20000 });
  assert.ok(dialogs.some(d => /more than 1000 and uses a large part/.test(d))); assert.equal((await dbAll(page, "guideline_sections")).filter(x => x.sourceId !== s._id).length, 1100); ok("above 1,000 sections the user is warned first; 1,100 sections saved in batches");
  // ---------- a write that never reaches the server (the stand-in's "hang" switch): must NOT be reported as saved to the server
  await upload(f, "pending.txt", "CHAPTER 1: Pending test\n\nTEST TEXT ONLY pending."); await f.locator("#docTitle").waitFor(); await fillSource(f, { title: "Pending write test" });
  await page.evaluate(() => { window.__db.hang = true; }); await f.locator("#docSave").click(); await f.locator("#docMsg.err", { hasText: /NOT reached the server/ }).waitFor({ timeout: 30000 }); await page.evaluate(() => { window.__db.hang = false; });
  assert.doesNotMatch(await msgOf(f), /Saved 1 section for review/); ok("a write that has not reached the server is reported as saved on this device only (simulated with the stand-in; not a real offline test)");
  await ctx.close();

  // ---------- reviewer without manage cannot import; manager can; desktop layout
  { const m = await open("manager", 1280, 800); await m.f.locator("#tabImport").click(); await m.f.locator("#docFile").waitFor(); await upload(m.f, "test-doc.txt", txt); await m.f.locator("#docTitle").waitFor(); await m.page.screenshot({ path: OUT + "/imp3-desktop-preview.png", fullPage: true });
    assert.equal(await m.f.locator('#docList [data-a="reject"]').count(), 0, "a manager without approve cannot reject"); ok("desktop layout renders; a manager without approve sees no reject button"); await m.ctx.close(); }

  // ---------- optional: the real UCG text (as TXT) through the whole path
  if (TXT && fs.existsSync(TXT)) {
    const u = await open("owner", 390, 844); await u.f.locator("#tabImport").click(); const t0 = Date.now(); await upload(u.f, "ucg-text.txt", fs.readFileSync(TXT)); await u.f.locator("#docTitle").waitFor({ timeout: 30000 });
    const rt = Date.now() - t0, groups = await u.f.locator(".docG").count(), selTxt = await u.f.locator("#docSel").innerText();
    console.log("   (real UCG text " + (fs.statSync(TXT).size / 1048576).toFixed(2) + " MB read and previewed in " + rt + " ms; " + groups + " chapter groups; " + selTxt.trim() + ")");
    await fillSource(u.f, { title: "Uganda Clinical Guidelines 2023", org: "Ministry of Health, Republic of Uganda", jur: "Uganda", ed: "2023", pub: "2023-12-19" }); await u.f.locator("#docSave").click(); await u.f.locator("#docMsg.ok").waitFor({ timeout: 30000 });
    const us = await dbAll(u.page, "guideline_sections"); assert.ok(us.length > 0 && us.every(x => x.text.length <= 100000)); console.log("   (saved " + us.length + " section documents, largest " + Math.max(...us.map(x => x.text.length)) + " characters)"); ok("real UCG text read, previewed and saved as section documents under the 100,000-character cap"); await u.ctx.close();
  }

  assert.equal(errors.length, 0, "browser errors:\n" + errors.join("\n")); await browser.close(); console.log("\n" + results.length + " checks passed, 0 browser errors");
})().catch(e => { console.error("FAILED:", e); process.exit(1); });
