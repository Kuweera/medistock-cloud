# DEVELOPER_4_HANDOVER.md - laboratory, reports, integration and security (rules v18)

## Summary
Flexible laboratory catalogue (nine result types, facility-configured local terms, templates that fill structure only, critical limits with a source, approval status); specimen workflow with receive, accept and reject; type-specific result entry; corrections with a reason that keep the old result; critical-result notices (lab records who was told, clinician acknowledges); lab bills with paid, part paid, credit and authorised no-charge, one per order; laboratory reports. Nothing clinical is supplied by the app. Details: `docs/LABORATORY_SPEC.md`.

## Files
New: `pc-lab.js`, `lab-reports.html`, `docs/LABORATORY_SPEC.md`, `docs/DEVELOPER_4_HANDOVER.md`, `docs/screenshots-dev4/*`, `tests/lab.test.js`, `tests/lab-integration.test.js`, `tests/lab-harness.html`, `tests/lab-check.js`, `tests/lab-reports-check.js`, `tests/lab-catalogue-check.js`.
Changed: `investigations.html`, `laboratory.html`, `encounter.html` (Developer 3's file: minimal edits, see below), `firestore.rules` (v18), `users.html`, `nav.js`, `sw.js` (mc-v27), `tests-emulator/rules.test.js`, `tests/integration.test.js`, docs (FIELD_EXPLANATIONS, DATABASE_SCHEMA, INTEGRATION_CHECKLIST, SECURITY_TEST_REPORT, OFFLINE_SYNC_TEST_REPORT, IMPLEMENTATION_PROGRESS).
`mc-core.js` and all protected business files are untouched (hash baseline test passes).
encounter.html edits: loads `pc-lab.js`; new orders spread `PCL.orderFields(c)`; draft tests are not offered; results of every type are shown; new status labels and the rejection reason; critical notices with an "I have seen this" button; a question before repeating an unfinished test.

## Schema and rules changes
Documented in `docs/DATABASE_SCHEMA.md` (Laboratory section) and the v18 note in `docs/SECURITY_TEST_REPORT.md`. New collections: `pc_lab_alerts`, `pc_lab_bills`. New permissions: `lab.payment`, `lab.report`. One rules change outside the lab collections: a get of a missing `credit_accounts` document is also allowed for `lab.payment` (same narrow fix as dispensers). Nothing was opened to everyone; no existing inventory or sales schema changed. Rules must be published by the owner after review.

## Tests
- `node --test "tests/*.test.js"`: 142 pass (includes 14 lab engine tests and 5 lab integration tests).
- Browser checks (Chromium, in-memory stand-in): `lab-check.js` (specimen steps, rejection, every result type, critical notice, correction, verification, billing, credit once, reversal, waiver reason), `lab-reports-check.js`, `lab-catalogue-check.js`; the earlier Patient Care and pharmacy browser checks still pass.
- Emulator rules tests for v18 are written in `tests-emulator/rules.test.js`.

## Firebase testing status (honest)
- Emulator tests for v18: **written, NOT RUN.**
- Real Firebase: **not tested.** Offline, airplane-mode and two-phone behaviour: **not tested** (steps in `docs/OFFLINE_SYNC_TEST_REPORT.md`).
- Rules v18 have not been run against any emulator; lookup counts were counted by hand.

## Screenshots
`docs/screenshots-dev4/`: mobile (390 px) specimen steps, critical notice, panel result, organism entry, billing, reports, catalogue editor; desktop (1280 px) laboratory screen. Taken from the in-memory test harness with invented test data.

## Known bugs and limits
See "Known limits" in `docs/LABORATORY_SPEC.md`: lab cash is not in `cash-position.html` (protected file); later credit payments are not linked to the lab bill; in-app critical alerts only; no age or sex specific ranges; self-verification allowed; credit entries have no receipt number; reports read up to 3000 results and bills. The reversal of a bill does not refund cash. The Laboratory quick-fill on Users does not include lab.payment or lab.report on purpose (give them separately).

## Outstanding tasks and dependencies
1. Run the emulator tests and publish rules v18. 2. Phone test (offline, two phones). 3. Owner decides whether lab cash should appear in Cash Position (needs a change to a protected file). 4. Developer 3 to review the encounter.html edits. 5. Developer 1's pharmacy and the lab share the credit account `dspca_{patientId}`.
