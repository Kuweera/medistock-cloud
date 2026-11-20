# IMPLEMENTATION_PROGRESS.md

| Phase | Step | Status |
|---|---|---|
| 0 | Existing application audit | Delivered |
| 1a | (a) Rules v10 + migration notes | Published by the owner (2026-11-09). Playground checks not run |
| 1a | (b) Permissions on Users page + Patient Care switch on Shops page | Delivered, awaiting owner confirmation |
| 1a | (c) Registration + search | **Built and tested on a mock database; awaiting upload and phone test** |
| 1a | (d) Profile, history, allergies | **Built and tested on a mock database; awaiting upload and phone test** |
| 1a | (e) Duplicate detection | Done inside (c) at registration; post-sync duplicate scan not built |
| 1a | (f) Facility links + consent | Facility links in (c). **Consent sharing built and tested on a mock database; awaiting upload and phone test** |
| 1a | (g) Merge | **Built and tested on a mock database; awaiting upload and phone test** |
| 1a | (h) Regression | **Automated and file-level checks done (see REGRESSION_REPORT.md). Owner phone checklist and Rules Playground checks pending** |
| 5 | Pharmacy dispensing, clinical guidelines, UX simplification, integration (Developers 1-4) | **Built and tested on mock databases only. Rules v15 pass 22/22 emulator tests (CI run #8) but are NOT yet tested against real Firebase. NOT released.** See INTEGRATION_CHECKLIST.md |
| 4 | Treatment plan engine, schedules, medication record | **Built and tested on a mock database; awaiting rules v14, upload and phone test. Highest-risk phase: test carefully with made-up patients** |
| 3 | Investigations and diagnoses | **Built and tested on a mock database; awaiting rules v13, upload and phone test** |
| 2 | Encounters, triage, consultation | **Built and tested on a mock database; awaiting rules v12, upload and phone test** |
| 1b | Cross-business sharing | **Built as part of (f2): directory + shares between facilities and businesses (see spec section 17). Cross-business duplicate matching not built** |

## Phase 4 files
New: `treatment.html` (dashboard and medication record), `dosing-rules.html`, `pc-sched.js` (scheduling and safety helpers). Changed: `encounter.html` (Treatment tab), `users.html` (four new permissions), `nav.js`, `sw.js` (mc-v23). Rules: v14 (added after v13). Specs: TREATMENT_PLAN_ENGINE_SPEC.md, MEDICATION_SCHEDULING_SPEC.md, MEDICATION_ADMINISTRATION_SPEC.md.

## Phone test for Phase 4 (use a made-up patient and a made-up rule; the numbers are NOT medical advice)
1. Users: give one test operator the Clinician quick-fill and another the Nurse quick-fill.
2. Dosing rules: add a test rule for one medicine with a source, a dose per kg and a highest dose, and approve it.
3. In a visit, record a weight in triage, then Treatment > Start a plan > Add medicine. Try each: regular intervals, twice a day for 5 days, weight-based (check the calculated dose and the confirm box), as needed.
4. Try the warnings: add the same medicine twice, and a medicine matching a recorded allergy.
5. Treatment & MAR: record one as Given, one as Not given (a reason is required), try to give the allergic one.
6. Correct a wrong record as the owner; check the original stays on file and the administration is pending again.
7. Change a dose (new version) and stop an order; check the old one is marked replaced/stopped and the future times are cancelled.
8. Airplane mode: record a dose, go online, check no NOT SAVED message.

## Phase 3 files
New: `investigations.html` (test catalogue), `laboratory.html` (lab queue and results). Changed: `encounter.html` (Tests and Diagnosis tabs), `users.html` (eight new permissions, Laboratory quick-fill), `nav.js`, `sw.js` (mc-v22). Rules: v13 (added after v12). Spec: INVESTIGATION_DIAGNOSIS_SPEC.md.

## Phone test for Phase 3
1. Users: give a test operator the Laboratory quick-fill; give another the Clinician quick-fill.
2. Test catalogue: add one test with a number result, units and a reference range (and its source), and one Positive/Negative test.
3. Open a visit > Tests: request both tests as urgent. They appear in Laboratory > To collect.
4. Laboratory: collect, start processing, enter a result (check the flag), verify.
5. Back in the visit: the result shows as Verified; tap "I have reviewed this result".
6. Enter a corrected result: the old one stays listed as an earlier result.
7. Visit > Diagnosis: add a diagnosis, then change it and check the earlier version is kept.

## Phase 2 files
New: `encounters.html` (queue, start visit, warning ranges), `encounter.html` (triage, consultation, notes, closing). Changed: `patient.html` (Visits tab), `users.html` (six new permissions), `nav.js` (menu item Visits & Queue), `sw.js` (mc-v21). Rules: v12 (new Phase 2 rules added at the end). Specs: ENCOUNTER_TRIAGE_SPEC.md, CLINICAL_CONSULTATION_SPEC.md.

## Phone test for Phase 2
1. Users: tick the new permissions for a test operator (Clinician quick-fill).
2. Visits & Queue: start a visit for a test patient; start an Emergency visit and check it goes to the top.
3. Open a visit: save triage with a temperature and blood pressure. Add a complaint and a medicine taken before.
4. Write a note, save as draft, edit it, sign it. Try to change the signed note: you can only amend it.
5. Close the visit. Airplane mode: record triage, go online, check it synced.

## Step (h) files
Changed: `patients.html` (the duplicate scan button is now shown only to users who may merge). New: `docs/REGRESSION_REPORT.md`.

## Step (g) files
Changed: `patients.html` (Find possible duplicate patients), `patient.html` (merge tool, merged-record view). No new security rules needed (v11 already has the merge rules). Docs updated.

## Phone test for step (g)
1. Register two test patients that are really the same person (same name, same phone). Then Patients > Find possible duplicate patients: the pair appears.
2. Tap Compare / merge. As owner: choose which to keep, type a reason, tick the box, Merge records.
3. The merged patient disappears from the list. Open the kept patient: nothing was lost; allergies of the merged one show here.
4. Log in as an operator without merge permission: the profile shows no merge button.

## Step (f2) files (redesign after owner feedback)
New: `directory.html`, firestore.rules v11. Changed: `patients.html`, `patient.html`, `nav.js` (menu item Facility Directory), `sw.js` (mc-v20). Fixed: the menu (hamburger) button did not work on Patient Care pages. Fixed: other facilities could list all patients of the business.
Order: (1) publish rules v11, (2) upload files, (3) owner lists facilities in Facility Directory, (4) test.

## Phone test for step (f2)
1. Menu button works on Patient Care pages.
2. Patients: Main shop shows only patients registered at Main shop; switch to another shop and its list is different.
3. Facility Directory (owner): List in directory, add X-ray / Laboratory / a typed service, description, Save profile.
4. Patient > Sharing: choose the service, type a business name, choose a facility, fill who agreed, tick the box, Share patient.
5. In the other business (or another facility), Patients > Shared with this facility shows the patient; open it (read-only, allergies and history visible).
6. Register as our patient fills the form. Stop sharing removes access.

## Step (f) files
New: `pc-fields.js`. Changed: `patients.html`, `patient.html`, `sw.js` (cache version mc-v19). Docs updated. Upload steps (c) and (d) first if you have not.

## Phone test for step (f)
1. Switch Patient Care on for two shops (Shops > Edit). Register a patient and add an allergy at the first shop (as owner).
2. Profile > Sharing: choose the second shop, purpose, type who agreed, tick the box, Share records.
3. Switch to the second shop (or log in as an operator of it with View patients). Open the same patient: the allergy shows in the banner and in the Allergies tab under 'From ...'.
4. Back at the first shop press Stop sharing: the second shop no longer shows it.
5. Dates: type 5/5/1990 in Date of birth (becomes 05/05/1990), and use the calendar button too.
6. Try typing in Relationship, Village, Allergic to, Reaction: suggestions appear but you can type anything.

## Step (d) files
New: `patient.html`. Changed: `patients.html` (adds the Open profile button), `sw.js` (cache version mc-v18, page added). Docs updated. Upload the step (c) zip first if you have not already.

## Phone test for step (d)
1. Patient Care > tap a patient > Open profile.
2. Allergies tab: save an allergy. A red banner appears at the top. Mark it as entered in error with a reason; the banner goes away and the entry stays under 'Show entries marked as error'.
3. Medical history tab: add an entry, then mark it resolved.
4. Log in as an operator with only View patients: the add forms must not appear.
5. Airplane mode: add an allergy, go online, check there is no red NOT SAVED message.

## Step (c) files
New: `patients.html`. Changed: `nav.js` (menu item "Patient Care"), `sw.js` (cache version mc-v17, page added to offline list). Docs updated.

## How step (c) was tested
Logic tests (names, phones, ages, duplicate scoring, search) in Node: all passed. Page run in a headless browser against a pretend database: register, search by name/phone/reg number, duplicate warning and forced registration with reason, linking a patient from another facility, operator without permission, shop without Patient Care, refused save. **Not tested against real Firebase or the real security rules.**

## Phone test for step (c)
1. Shops: Patient Care ticked for your shop. Open Menu > Patient Care.
2. Register a test patient (use a made-up name). It appears at once with a number like P-O-1.
3. Search by part of the name, by phone, and by the number.
4. Register the same name and phone again: a warning appears.
5. Turn on airplane mode, register another test patient, turn it off, and check it synced (no red NOT SAVED message).
6. Log in as an operator with and without Patient Care access.
7. Use Sell and Inventory once. Nothing there should change.

Known issues: menu shows Patient Care to every user (the page itself explains missing access); `reports (1).html` stray file; no automated tests in the repo.

## Phase 5 integration (Developer 4, 2026-11-15)
Changed: `firestore.rules` (v15), `nav.js` (Pharmacy, Guidelines), `sw.js` (mc-v24; also added `pc-ux.js`, which pages already loaded but the offline list did not cache). New: `package.json`, `firebase.json`, `.github/workflows/ci.yml`, `tests/integration.test.js`, `tests/baseline-hashes.json`, `tests-emulator/rules.test.js`, `docs/INTEGRATION_CHECKLIST.md`, `docs/SECURITY_TEST_REPORT.md`, `docs/OFFLINE_SYNC_TEST_REPORT.md`. `mc-core.js` and all Sales/Purchases/Inventory files are byte-identical to the supplied zip (hash-checked by CI).
Phase 5 stays unreleased until the Phase 4 and Phase 5 gates in the master plan pass. Code existing is not a pass.


## Update: dispensing permission fix (rules v16)
Developer 1, 2026-11-16. Every dispensing failed with "You do not have permission" for owner and operators alike: the transaction reads the first dispense record and the prescription before they exist, and the v15 read rules dereference `resource.data`, which is null for a missing document. v16 adds `get` rules for missing documents (dispensers only) and lets `dispense.view` users read medicine orders, registration numbers and allergies of their own facility. **Not yet verified in the emulator or the real project.** See PHARMACY_DISPENSING_SPEC.md section 7.

## Update: price/payment/credit, reversals, substitution, consumables (rules v17)
Developer 1, 2026-11-16. Added `pc-dispense-ext.js` (billing hook, reversals, hand-over marker, consumables), the matching screens in `pharmacy.html`, substitution and hand-over support in `pc-dispense.js`, rules v17, tests (offline: 84 passing; browser check passing; emulator tests written, **not run**). Nothing was tested on real Firebase, offline on a real phone, or with several people at once. See PHARMACY_DISPENSING_SPEC.md section 8.

## Developer 4: laboratory (rules v18)
Built and tested on in-memory stand-ins only: flexible catalogue (9 result types, templates, approval, critical limits with source), specimen workflow (receive, accept, reject), type-specific result entry, corrections with reason, critical notices, bills with credit and no-charge, laboratory reports. **Rules v18 not run on an emulator; real Firebase and phones not tested.** See `docs/LABORATORY_SPEC.md` and `docs/DEVELOPER_4_HANDOVER.md`.

## Update: Lead Developer audit and rules v19 (2026-11-20)
Audit: see the Lead's report, `docs/DATA_CONTRACT_V19.md`, `docs/STAGE0_FINDINGS.md`. Rules v19 (pending prescriptions, clinician read of dispensing, bill read restriction): emulator CI run #68 = 50 of 50 pass (2026-11-20). Not yet on the real Firebase project. Stale root test copies moved to `tests/archive/` (nothing deleted). Lab revenue into Sales/Cash Position: approved by the owner, **not built**.
Lab ledger (Lead, 2026-11-20): laboratory payments and reversals now also write `sales` rows so Cash Position and Sales reports include them. Offline tests 144 pass; one new emulator test written, **not run**; Reports/Dashboard/Cash Position screens **not checked in a browser or on a phone**. See DATA_CONTRACT_V19.md section 6.

## Developer 2, Stage 1: patient list (2026-11-20)
Changed: `patients.html`, `docs/PATIENT_MANAGEMENT_SPEC.md` (section 19). New: `tests/list-check.js` (15 browser checks on the in-memory stand-in: 360, 390, 768, 1280 widths; Local/Shared chips; filters; search; shared-record duplicate warning; view-only operator). Existing tests unchanged and still passing (144 offline, registration, progressive, browser, hints checks). **Not run on real Firebase, the emulator or a phone.** No rules or schema change.
