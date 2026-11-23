# Developer 4 — Stage 2 report (PDF, DOCX, XLSX/XLS, OCR)

Date: 2026-11-23. Browser results are from headless Chromium against the **in-memory stand-in** harness with the **real vendored libraries**. Nothing has run against Firebase, the emulator or rules v24c, and nothing was tested on a phone.

## 1. Features completed
- **PDF** (pdf.js 3.11.174; parsing in pdf.js's own worker, layout in the import worker): text with positions is turned into headings, paragraphs and tables, each with its page number. Repeated headers/footers and page numbers are removed and counted. A word split across lines by a separate hyphen item is rejoined; a hyphen that is part of the text is kept. A paragraph that carries on across a page break is joined and keeps both page numbers. Password-protected and damaged PDFs get a plain message.
- **Tables from PDF** are rebuilt from text positions only, and every one is flagged: "compare with the original page before using any value".
- **DOCX** (mammoth 1.8.0, in the import worker): headings, paragraphs, lists, tables; pictures are skipped and counted.
- **XLSX and XLS** (SheetJS 0.20.3, in the import worker): one heading and one table per sheet, shown cell text, empty sheets skipped.
- **OCR** (tesseract.js 5.1.1, English): for pages with no readable text, 25 pages per run, resumable by running again; text is marked as OCR with a confidence per section; low-confidence pages are named; the screen warns that drug names, doses and numbers can be wrong. Worker, core (SIMD or not, chosen per device) and language data all load from `vendor/`; the test records every request and fails if one leaves the app.
- **Import tools box**: each of PDF, Word, Excel, OCR shows "Ready for offline use" only when its files are found in an app cache, otherwise "Not downloaded", with a "Download for offline use" button. Nothing from `vendor/` is fetched until a file of that type is chosen or the button is pressed.
- **Add sections to an existing import** (allowed by rules v24c): the new reading must match every section already saved, otherwise nothing is added ("two different readings are never mixed"). Reject and Retire are shown only while the import is still "imported".
- **Mixed PDFs**: OCR text is merged into page order; method `mixed`.
- `vendor/VENDOR_MANIFEST.md` re-verified: 25 of 25 files match their listed SHA-256 and size; licences, notes and which files the app really uses are added.

## 2. Files
New: `pc-import-pdf.js`, `pc-import-tools.js`, `tests/pc-import-pdf.test.js`, `tests/pc-import-stage2-browser-check.js`, `tests/fixtures/*` (test-only files and `make-fixtures.py`), this report.
Changed: `pc-import.js` (`detect`, `extract`, `toSections` now carry page ranges and OCR flags; `stats` exported), `pc-import-worker.js` (DOCX, XLSX, PDF-layout message), `pc-import-ui.js` (reading, tools box, OCR panel, `save()` with add-sections), `guidelines.html` (two `<script>` tags only), `tests/pc-import.test.js`, `tests/pc-import-browser-check.js`, `vendor/VENDOR_MANIFEST.md`.
Not touched: the matcher, `parseImport`/`previewImport`/`doImport`, `pc-guidelines.js`, `sw.js`, rules, `users.html`.

## 3. Database and security
No new collections or fields. Fields that Stage 1 wrote as fixed values now carry real values: source `pageCount`, `extractionMethod` (`text`, `ocr`, `mixed`, `table_sheet`), `ocrUsed`, `ocrPages`; section `pageFrom`, `pageTo` (integers or null), `ocr`, `ocrConfidence` (number 0–100, one decimal).
New writes: adding sections updates the source with only `sectionCount`, `updatedBy`, `updatedAt`; new audit action `guideline.source_add_sections`. **Please check these against v24c** — the stand-in does not enforce rules.
pdf.js is opened with `isEvalSupported: false` (see the manifest note on CVE-2024-4367).

## 4. Tests and actual results
- Node: `node --test "tests/*.test.js"` with the Lead's `sw.js` (mc-v29) in place: 193 run, 192 pass, **1 fails**: "guidelines.html uses pc-import-pdf.js but sw.js does not cache it". That is a request to the Lead (section 7). My new tests: 31 (`pc-import.test.js` 15, `pc-import-pdf.test.js` 16), all pass; they found and I fixed 3 bugs in the layout logic (gaps measured across blank items, merged lines of different text size, spacing next to a big chapter number).
- Browser, Stage 1 check: 26 checks pass, 0 browser errors (updated for add-sections).
- Browser, Stage 2 check (`node tests/pc-import-stage2-browser-check.js`): 17 pass, 0 browser errors. Covers tool status and the honest "cannot confirm offline" message; text PDF (page numbers kept, headers removed, table rows saved); locked and damaged PDFs; scanned PDF with real OCR (2 pages in about 5 s, no request left the app, sections marked OCR with confidence); mixed PDF (page order, method `mixed`); DOCX; XLSX and XLS; add-sections and the refusal of a different reading; the real UCG PDF.
- **Real UCG PDF (1,161 pages, 12.9 MB):** read and laid out in about 7.5 s. 1,159 repeated header/footer lines and 1,144 page numbers removed; 1,410 split words rejoined; 24 chapters recognised with page ranges (for example "1 Emergencies and Trauma", pages 67–160; "24 Anaesthesia", 1105–1161) plus front matter; about 530 table-like layouts flagged; 1,030 sections in total (just above the 1,000 warning, so choose chapters). Saving chapter 1 alone wrote 116 section documents (pages 67–160), and chapter 2 was added to the same import afterwards.
- Existing `tests/guidelines-browser-check.js` still fails at "Everything needed for approval is filled in". It fails identically on the original `guidelines.html`; not caused by this work, cause not investigated.

## 5. Known limitations (clinical content: read this)
- **PDF tables are the main risk.** Table structure is guessed from positions. Cells that wrap are re-joined by position and can be split or merged wrongly; merged or spanning cells and tables that continue over a page are not handled. I only looked at a sample of the UCG tables. **Every PDF table and every dose or number must be checked against the original page before it is used in any draft guideline.** Section page ranges are there for that.
- Headings are guessed from text size. In the UCG, numbered list lines set in a larger type (for example "01 • Greet and welcome the patient…", page 53) are read as headings. Multi-column pages, footnotes, text in images, flowcharts and figures are not read.
- OCR was tested only on clean synthetic pages. It has not been tried on real scans, skewed or low-quality pages, or non-English text. OCR text can be wrong, especially for drug names, doses and numbers. English only.
- Adding sections later needs the same reading: a different version of the app or OCR run can change the section numbering, and the add is then refused (safe, but the user cannot extend that import).
- DOCX: text boxes, headers, footers and footnotes were not tested and may be skipped. Page numbers do not exist for DOCX and spreadsheets. XLS was tested only with a file written by SheetJS.
- Offline: the tools box tells the truth, but **offline use of PDF, Word, Excel and OCR depends on the Lead's on-demand vendor cache in `sw.js`, which does not exist yet**. Until then the download button cannot make them available offline. Not tested: a real offline session, a second device.
- Only Chromium was tested. Not tested: Safari, Firefox, Android WebView, low-memory phones (OCR renders pages up to about 4,000 px), files near the 30 MB limit in a browser.
- The two PDF libraries' own advisories are in `vendor/VENDOR_MANIFEST.md`; I could not verify them offline.

## 6. Remaining work
Stage 3 (reference ranges), Stage 4 (reminders), Stage 5 (audit and final report). Also from the original plan: organising reviewed sections into draft `guidelines` entries (`sourceDocId`, `sourcePages`).

## 7. Requests to the Lead
1. `sw.js`: add `pc-import-pdf.js` and `pc-import-tools.js` to the install-time cache (the worker loads `pc-import.js` and `pc-import-pdf.js` at start). This clears the one failing Node test.
2. `sw.js`: on-demand vendor cache. The app asks `caches.match()` for these exact URLs (relative to the page, no query string) and reports "Ready for offline use" only when all are found: PDF: `vendor/pdfjs-3.11.174/pdf.min.js`, `pdf.worker.min.js`; Word: `vendor/mammoth-1.8.0/mammoth.browser.min.js`; Excel: `vendor/sheetjs-0.20.3/xlsx.full.min.js`; OCR: `vendor/tesseract-5.1.1/tesseract.min.js`, `worker.min.js`, `core/tesseract-core-simd-lstm.wasm.js` (or `tesseract-core-lstm.wasm.js` on devices without SIMD), `lang/eng.traineddata.gz`. The download button fetches those files; the cache must keep them across app versions. Please do not cache the other tesseract core variants.
3. Rules v24c: confirm the add-sections update (only `sectionCount`, `updatedBy`, `updatedAt`), the numbers in `ocrConfidence`, and `pageFrom`/`pageTo` values.
4. Decision: stay on pdf.js 3.11.174 with `isEvalSupported:false`, or move to a newer pdf.js (ES-module only, would need a build step).
5. The owner should add the upstream licence file for `eng.traineddata`.

## 8. Integration instructions
Copy the new and changed files into the repo (the vendor binaries are already there). Apply the `sw.js` changes. Run `node --test "tests/*.test.js"`. For the browser checks: `python3 -m http.server 8765` from the repo root, then `node tests/pc-import-browser-check.js ./shots` and `node tests/pc-import-stage2-browser-check.js ./shots <path-to-ucg.pdf>` (the PDF argument is optional). To rebuild the fixtures: `python3 tests/fixtures/make-fixtures.py` (needs reportlab, pypdf, img2pdf, python-docx, Pillow).
