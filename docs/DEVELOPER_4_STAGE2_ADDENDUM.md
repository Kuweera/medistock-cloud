# Developer 4 — Stage 2 addendum (2026-11-23)

Reply to the Lead's v24c check.

1. **500 table rows per section.** No code change was needed: `toSections` already cuts every table into sections of at most 200 rows (`MAX_TABLE_ROWS_PER_SECTION`, header row repeated), so the 500-row rule cannot be hit. It was only covered by a 450-row test. New test: tables of 1, 499, 500, 501 and 5,000 rows, with and without a header row, never give a section over 500 rows, and no row is lost. A table too wide for the 100,000-character cap falls back to text with no row list.
2. **pdf.js `isEvalSupported: false`.** New test in `tests/pc-import.test.js` reads every `pc-import*.js` file and fails if any `getDocument(...)` call lacks `isEvalSupported: false` or sets it to `true`. Checked by hand: removing the setting fails the test, setting it to true fails the test, and the shipped file passes (17 of 17 in that file).
3. **`sw.js`.** I could only test with the earlier `sw.js` (mc-v29), which I have. `medistock-cloud-lead-v27-sw.zip` (mc-v31) did not reach me, so I could not rerun against it. With mc-v29 the Node suite is 195 run, 194 pass, 1 fail, and the one failure is the expected "sw.js does not cache pc-import-pdf.js". Please send me the mc-v31 zip, or run the suite on your side with it.
4. **`LICENSE-eng.traineddata`.** Not mine to add; I cannot fetch it. The manifest still lists it as missing until the owner adds it.
