/* Offline check for the import tools with the REAL sw.js (headless Chromium, in-memory stand-in database, not Firebase).
   Registers sw.js, saves the tools with the screen's own "Download for offline use" buttons, switches the browser OFFLINE, then reads XLSX, DOCX, a text PDF and a scanned PDF (OCR).
   Run:  python3 -m http.server 8765  (repo root), then  node tests/pc-import-offline-check.js            TEST CONTENT ONLY. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), FX = path.join(__dirname, "fixtures");
(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" }), page = await ctx.newPage(), errors = [], results = [];
  const ok = (n) => { results.push(n); console.log("ok - " + n); };
  page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
  await page.goto("http://localhost:8765/tests/guidelines-harness.html?as=owner");
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true })); return reg.scope; });
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true); ok("the real sw.js (mc-v31) is registered and controls the page");
  assert.ok((await page.evaluate(() => caches.keys())).includes("mc-v31"));
  // the harness loaded guidelines.html in an iframe before the SW took control; reload so the iframe, its workers and its scripts go through the service worker
  await page.reload(); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await f.locator("#tabImport").click(); await f.locator("#docFile").waitFor();
  for (const t of ["pdf", "docx", "xlsx", "ocr"]) { await f.locator('[data-tool="' + t + '"]').click(); await f.locator("#docToolMsg", { hasText: /Saved for offline use/ }).waitFor({ timeout: 60000 }); }
  assert.equal((await f.locator("#docTools").innerText()).match(/Ready for offline use/g).length, 4); ok("all four tools were saved with the download buttons and show 'Ready for offline use'");
  const keys = await page.evaluate(async () => (await (await caches.open("mc-vendor-v1")).keys()).map((r) => new URL(r.url).pathname)); assert.equal(keys.length, 8, keys.join(","));
  assert.ok(keys.some((k) => /eng\.traineddata\.gz$/.test(k)) && keys.some((k) => /tesseract-core-(simd-)?lstm\.wasm\.js$/.test(k))); ok("the vendor cache holds " + keys.length + " files, including the OCR worker, core and language data");
  const sheet = await page.evaluate(async () => { await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "/vendor/sheetjs-0.20.3/xlsx.full.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Note"], ["Alpha", "offline test"]]), "S"); return Array.from(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))); });
  // ---------- OFFLINE from here
  await ctx.setOffline(true); assert.equal(await page.evaluate(() => fetch("https://example.invalid/ping", { cache: "no-store" }).then(() => "network answered", () => "no network")), "no network"); ok("the browser is now offline");
  const up = (name, data) => f.locator("#docFile").setInputFiles({ name, mimeType: "application/octet-stream", buffer: data });
  const waitRead = () => f.locator("#docTitle, #docMsg.err").first().waitFor({ timeout: 120000 });
  await up("offline.docx", fs.readFileSync(path.join(FX, "test.docx"))); await waitRead(); assert.match(await f.locator("#docOut").innerText(), /test|offline\.docx[\s\S]*2 headings[\s\S]*1 table/); ok("OFFLINE: a DOCX is read (mammoth served from the vendor cache)");
  await up("offline.pdf", fs.readFileSync(path.join(FX, "text.pdf"))); await waitRead(); assert.match(await f.locator("#docOut").innerText(), /PDF, 5 pages/); ok("OFFLINE: a text PDF is read (pdf.js and its worker served from the vendor cache)");
  await up("offline-scan.pdf", fs.readFileSync(path.join(FX, "scanned.pdf"))); await f.locator("#docMsg.err").waitFor({ timeout: 60000 }); await f.locator("#docOcr").click(); await f.locator("#docMsg.ok", { hasText: /OCR finished for 2 pages/ }).waitFor({ timeout: 150000 });
  assert.match(await f.locator("#docOut").innerText(), /quick brown fox/i); ok("OFFLINE: a scanned PDF is read with OCR (tesseract worker, core and language data from the vendor cache)");
  await up("offline.xlsx", Buffer.from(sheet)); await waitRead(); assert.match(await f.locator("#docOut").innerText(), /1 table/); ok("OFFLINE: an XLSX is read (SheetJS from the vendor cache)");
  await ctx.setOffline(false);
  assert.equal(errors.length, 0, errors.join("\n")); await browser.close(); console.log("\n" + results.length + " checks passed, 0 page errors");
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
