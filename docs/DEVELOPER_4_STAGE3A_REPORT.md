# Developer 4 — Stage 2 closure and Stage 3a report

Date: 2026-11-24. Browser results are from headless Chromium against the **in-memory stand-in** harness. Nothing has run on Firebase, the emulator or a phone. The Lead's rules zip `medistock-cloud-lead-v28-ranges.zip` has **not reached me**; only `sw.js` (mc-v31) and the licence file did.

## 1. Stage 2: closed
- **Node suite with `sw.js` mc-v31:** 218 run, 218 pass, 0 fail (includes my 23 new range tests). The earlier failure ("sw.js does not cache pc-import-pdf.js") is fixed by mc-v31.
- **A bug found by reading mc-v31, fixed:** the service worker serves `vendor/` files from the cache `mc-vendor-v1` but never adds to it. My "Download for offline use" button only fetched the files, so it would have stored nothing. `download()` in `pc-import-tools.js` now saves each file into `mc-vendor-v1` (`cache.add`, which refuses an error response) and the screen says "Saved for offline use" only when the files are found in a cache. If the browser has no Cache API it says it cannot confirm. A failed download stores nothing and says so (tested).
- **New check with the real `sw.js`** (`tests/pc-import-offline-check.js`, 8 checks pass): register `sw.js`, save all four tools with the screen's buttons (8 files in `mc-vendor-v1`), switch the browser **offline**, then read a DOCX, a text PDF, a scanned PDF with OCR and an XLSX. All four work offline.
- Stage 1 browser check 26 pass. Stage 2 browser check 18 pass (one more than before, for the cache behaviour); the real UCG PDF run still passes.
- **Licence:** `LICENSE-eng.traineddata` received. Its terms text matches the Apache-2.0 text in the other four licence files in `vendor/` (compared ignoring whitespace). It names no copyright holder (it is the unfilled standard text). `vendor/VENDOR_MANIFEST.md` updated with its SHA-256 (`c71d239d…0ab4`, 11,357 bytes). I assumed the file name `vendor/tesseract-5.1.1/lang/LICENSE-eng.traineddata`; please confirm that is what is in the repo.

## 2. Lead's answers to my Stage 3 questions (recorded)
1. Ranges are facility-scoped. 2. Pregnancy is stated at result entry and stored only with the result (default "not stated"). 3. A range past its review date is still used and marked "review overdue". 4. An estimated date of birth is used and the result says so. 5. Equally specific ranges conflict: no flag and a clear message. 6. Nobody holds `ranges.manage` or `ranges.approve` by default. 7. Self-approval is recorded, not blocked; the screen must show "self-approved". 8. Developer 3 applies the visit-screen changes (3d) when free.
Rules changes the Lead made to my draft (I follow them in the screens): draft edits re-check the sex, pregnancy, unit and source rules; a newer version must be in the same facility to supersede; retiring requires the caller to record themselves as `retiredBy`.

## 3. Stage 3a: done (`pc-ranges.js`, pure logic, no values)
- Contains **no clinical value of any kind**. Ranges come only from approved `pc_reference_ranges` documents (or the facility's existing catalogue range as a labelled fallback).
- `resolve()` picks a range from sex, age in months (minimum inclusive, maximum exclusive), pregnancy status stated at entry, unit (no conversion), specimen, method and laboratory. Most specific wins; equal specificity is a conflict (no range, no flag). Only approved ranges in effect are used. Unknown age/sex/pregnancy never matches a range that depends on it.
- Result states: `context_range`, `legacy_catalogue`, `unavailable` (with a reason: none recorded, age unknown, sex not recorded, pregnancy not stated, unit differs, outside every range, order context missing) and `conflict`.
- `flag()` gives low/normal/high **only** with a numeric range that applies; otherwise `none`. `describe()` shows "Reference: … unit (source, version n)" or "No reference range recorded". Review overdue and estimated age are shown. Critical limits are never read.
- `refAppliedOf()` builds the `refApplied` element (plain values, no nested arrays, round-trips through JSON). `staleNotice()` is display-only. `validate()` mirrors the rules for the management screen. `conflictRisk()` warns before approving overlapping ranges.
- **Tests:** `tests/pc-ranges.test.js`, 23 tests, all pass, including a seeded property test of 4,000 random situations that asserts a flag is never given without an applicable numeric range. I checked the tests catch mistakes by breaking `pc-ranges.js` on purpose: making the age maximum inclusive, silently picking one of two conflicting ranges, letting "pregnancy not stated" match a pregnancy range, and removing both no-flag guards each made tests fail. All numbers, units and sources in the tests are invented test data.

## 4. Known limitations
- Nothing in 3a is connected to a screen yet, so no user-visible behaviour has changed.
- I did not read the patient `dobPrecision` values beyond `exact`, `estimated` and unknown. A patient whose age is stored only as `estimatedAge` without `dobApprox` is treated as age unknown.
- Pregnancy is only what the lab states. No patient field exists and nothing is inferred.
- No unit conversion is attempted: a range in a different unit is not used.

## 5. Remaining work
3b the ranges screen in `investigations.html`; 3c `laboratory.html`, `pc-lab.js`, `lab-reports.html` (entry, verification, `refApplied`, pregnancy field, lab report display); 3d Developer 3's vitals hooks. Then Stage 4 (reminders) and Stage 5.

## 6. Requests to the Lead
1. `sw.js`: add `pc-ranges.js` to the install cache when a page uses it (3b, with the version bump).
2. Send `medistock-cloud-lead-v28-ranges.zip` (rules, tests, `users.html`). I will build 3b and 3c against the exact rules. Until I read them I only know them from your message.
3. Confirm the licence file name above.
