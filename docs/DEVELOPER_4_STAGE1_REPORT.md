# Developer 4 — Stage 1 report (document import: TXT, CSV, HTML/HTM, RTF)

Date: 2026-11-22. Rules v24 CI: reported green by the Lead. **My code has not been run against the v24 rules or the emulator** (my repo copy still has v23). Everything below marked "stand-in" ran against the in-memory test harness only.

## 1. The UCG PDF upload failure
- File: `Uganda_Clinical_Guidelines_2023.pdf`, 13.5 MB, 1,161 pages, not encrypted, real text layer (born-digital, InDesign), about 200,000 words. OCR is not needed for this file.
- Cause (reproduced in Node with the real file through the old code path): the Import tab accepted only JSON. The picker was limited to `.json`, the file was read as text (3.5 million replacement characters in 13.1 million characters), pasted into the text box, and `PCG.parseImport` answered "This is not a valid JSON file". Pasting 13 million characters into a text box is also a likely freeze on phones; I did not reproduce that part in a browser.
- Not caused by file size (13.5 MB is under the 30 MB limit) or by encryption.
- Status: **the PDF is still not importable in this build.** It now gets a clear message ("PDF files need the import tools, which are not installed in this version of the app yet") instead of a JSON error. PDF text extraction is Stage 2 and needs the vendored pdf.js files.
- Stage 2 finding: the PDF text contains a running header ("CHAPTER n: …") on every page. Stage 2 must remove repeated page headers and footers. Stage 1 already merges a heading repeated back-to-back.

## 2. Features completed (Stage 1)
- Formats read with no outside library: TXT, CSV, HTML/HTM, RTF. Encoding detection (UTF-8, BOM, UTF-16, Windows-1252 fallback with a warning).
- Checks: type, 30 MB limit, empty file, `.doc` ("save as .docx or PDF"), unknown type, PDF/DOCX/XLSX/XLS (message: import tools not installed yet).
- Reading runs in a Web Worker (fallback to the page if Workers are unavailable).
- SHA-256 of the original file (`crypto.subtle`, with a plain copy for non-secure pages; verified against Node's crypto at the padding boundaries).
- Preview: counts, first part of the content, warnings, SHA-256.
- Source form (title, publisher, jurisdiction, edition required; publication date optional).
- Chapter selection, warning before saving more than 1,000 section documents, 100,000-character cap per section, tables kept as rows of cells (no nested arrays).
- Save: one `guideline_sources` record, `guideline_sections` in batches of 400, one `pc_audit_logs` entry (`guideline.source_import`). The original file is kept on this device only (IndexedDB, keyed by SHA-256).
- Same file twice is blocked (same SHA-256).
- "Imported documents" list (business-wide), view and copy section text, reject and retire with a reason (approvers only).
- Nothing imported is a guideline. No `guidelines` document is created by this import (tested).

## 3. Files
New: `pc-import.js`, `pc-import-worker.js`, `pc-import-ui.js`, `tests/pc-import.test.js`, `tests/pc-import-browser-check.js`, this report.
Changed: `guidelines.html`, import parts only:
- Import tab markup: added `<div id="docImport">`, gave the JSON card `id="jsonImportCard"`, renamed its heading to "Import entries from a JSON file".
- Added `<script>` tags for `pc-import.js` and `pc-import-ui.js`.
- `begin()`: Import tab is now shown to `guidelines.manage` **or** `guidelines.approve` holders; the JSON card stays for `guidelines.manage` only; one `PCIUI.init({...})` call.
- Not touched: `parseImport`, `previewImport`, `doImport`, the matcher, `pc-guidelines.js`.

## 4. Database and security (as approved in R1 and by the Lead)
Collections `guideline_sources` and `guideline_sections`, fields exactly as in R1 section 1.1 and 1.2 (stamp: `businessId, facilityId, schemaVersion, createdBy, createdAt, clientCreatedAt`).
- Source create: `fileName, fileType, fileSizeBytes, sha256, pageCount(null), extractionMethod, ocrUsed(false), ocrPages([]), extractionWarnings, sectionCount, sourceTitle, sourceOrg, jurisdiction, sourceEdition, publicationDate, importDate, addedByName, status:"imported"`. Document id `gsrc_` + first 16 hex of the SHA-256.
- Section create: `sourceId, seq, kind, headingPath, pageFrom(null), pageTo(null), text, tableRows([{cells:[…]}]), ocr(false), ocrConfidence(null), reviewStatus:"unreviewed", usedInGuidelineId(null)`. Document id `{sourceId}_s{seq, 5 digits}`.
- Source update (approvers): `status`, `updatedBy`, `updatedAt` plus `rejectedReason/rejectedBy/rejectedByName/rejectedAt` or `retiredReason/retiredBy/retiredByName/retiredAt`.
- Audit actions written: `guideline.source_import`, `guideline.source_reject`, `guideline.source_retire`.
- Queries used: `guideline_sources` where `businessId ==`; `guideline_sections` where `businessId ==` and `sourceId ==`. No composite index needed if the rules allow these equality queries (please confirm against v24; a query on `sourceId` needs the rule to allow it).
- Please check the v24 rules against these exact fields. Anything I send that v24 does not allow will show as an error on screen.

## 5. Requests to the Lead
1. `sw.js`: add `pc-import.js`, `pc-import-ui.js` and `pc-import-worker.js` to the install-time cache and raise the version. The existing integration test fails until this is done: "guidelines.html uses pc-import.js but sw.js does not cache it". The worker loads `pc-import.js` with a relative `importScripts`.
2. Confirm v24 allows the queries in section 4 and the field set above.

## 6. Tests and actual results
- Node tests (`node --test "tests/*.test.js"`): 176 run, 175 pass, 1 fail. The failure is the `sw.js` check above (expected, Lead's file). My 14 tests in `tests/pc-import.test.js` all pass; two real bugs in my HTML parser (a stray `<` and `<br>` inside a table cell) and one in my RTF table handling were found by these tests and fixed.
- Browser check (headless Chromium, in-memory stand-in, not Firebase): `node tests/pc-import-browser-check.js` — 25 checks pass, 0 browser errors, at 390 px and 1280 px. It covers: staff without permission see nothing; PDF/.doc/unknown/over 30 MB/empty files refused with the right message; TXT, CSV, HTML, RTF read; missing source details refused; partial chapter save; saved fields; the original kept in IndexedDB; list, view, copy; duplicate blocked; reject with reason and audit entry; the 1,000-section warning with 1,100 sections saved; a write that never completes reported as "NOT reached the server".
- Real UCG: the PDF is refused clearly in 1.9 s. The UCG text from the same PDF (extracted by `pdftotext`, 1.33 MB, as a .txt) is read and previewed in about 0.4 s, gives 25 chapter groups and 31 section documents (largest 99,998 characters), and saves.
- Existing `tests/guidelines-browser-check.js` fails at "Everything needed for approval is filled in". It fails the same way on the original `guidelines.html` without my changes, so it is not caused by this work. I did not investigate the cause (possibly date-related); for the Lead or Developer 2.

## 7. Known limitations
- Stage 1 cannot read PDF, DOCX, XLSX, XLS (Stage 2). `.doc` is not supported by design. No OCR yet.
- Page numbers are not available for these formats. Headings in TXT are recognised only for `#` lines and lines starting CHAPTER, SECTION, PART, APPENDIX or ANNEX; the preview says when none are found. HTML `<pre>` line breaks are not kept. RTF reading is text, paragraphs and simple tables; pictures, headers and footers are skipped.
- An import cannot be extended later (same file is blocked). To import more chapters of the same file later, a rules-allowed way to add sections is needed (the source `sectionCount` cannot be updated under the agreed rules).
- If the page is closed in the middle of a multi-batch save, some sections may be saved and others not; the record shows the planned count. Re-importing is blocked by the duplicate check. Not tested with a real interruption.
- The original file is on one device only. Another reviewer's device sees the extracted text, not the file.
- Not tested: real Firebase, rules v24, the emulator, true offline then sync, a real phone, Android WebView, a non-secure page, files near 30 MB in a browser.
- The raw sections are visible to reviewers only; they are not searchable by clinicians and not used in any workflow (by design until organised into draft entries and approved, Stage 2 and later).

## 8. Remaining work
Stage 2 (PDF, DOCX, XLSX/XLS, OCR, running-header removal, vendor files and `VENDOR_MANIFEST.md`); organising sections into draft `guidelines` entries with `sourceDocId` and `sourcePages`; Stages 3 to 5 (reference ranges, reminders, audit and final report).

## 9. Integration instructions
Copy the new files and the changed `guidelines.html` into the repo, apply the `sw.js` change in section 5, then run `node --test "tests/*.test.js"`. For the browser check: `python3 -m http.server 8765` from the repo root, then `node tests/pc-import-browser-check.js ./shots <ucg.pdf> <ucg.txt>` (the last two arguments are optional).
