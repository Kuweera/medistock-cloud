# DEVELOPER_BRIEFS_V19.md
From the Lead Developer, 2026-11-20. Read `docs/DATA_CONTRACT_V19.md`, `docs/STAGE0_FINDINGS.md` and the Master Directive first. Rules v19 are PROPOSED and **not yet run in the emulator**: do not build on them as if verified. Do not edit `firestore.rules`, `sw.js`, `nav.js`, permission keys in `users.html`, or `DATABASE_SCHEMA.md`; send the Lead a written request. Before you start, report what you will change, in the format of Master Directive section 8. Show evidence for every claim (test output, screenshot, emulator result). Anything tested only on the in-memory stand-in must say so.

## Developer 3: treatment plans, pharmacy, consumables
Files: `encounter.html` (treatment tab only; Dev 2 does not touch it until you report), `pharmacy.html`, `pc-dispense.js`, `pc-dispense-ext.js`, `treatment.html`.
1. **Write the pending prescription** in the same `writeBatch` as the medicine order (`prescriptions/{orderId}`, fields in contract section 1, `status:"pending"`, `qtyUnknown:true` + `qtyPrescribed:0` when the clinician gave no quantity, `drugId:null` when not matched to stock). On stop / complete / new version of an order, write the matching `cancelled` / `superseded` update in the SAME batch, only when nothing is dispensed.
2. **Dispensing engine:** when a pending document exists, first dispensing is an UPDATE (rules section 1), not a create; old orders without a document keep the create path. Cover: quantity left open, drug left open, partial then completion, stopped after partial.
3. **Pharmacy queue:** read `prescriptions`, group by patient, then visit, then plan; show stopped/superseded clearly. Keep the existing partial/complete/reversal behaviour.
4. **Dispensing status where nurses and clinicians work:** show "Not dispensed / partly / dispensed" on the treatment and administration screens (read only). It must never mark a dose given. Dispensing is not administration.
5. **Attendance for scheduled outpatient doses:** propose the status model to the Lead first (`attended`, `did_not_attend`, separate from `administered`); no schema change until approved.
6. **Procedure consumables:** link consumables to the procedure order using the existing `consumable_*` collections; no second stock system.
Do not change money logic in pharmacy without telling the Lead.

## Developer 2: patients and the patient journey
Files: `patients.html`, `patient.html`, `encounters.html`, `directory.html`, `pc-fields.js`. `encounter.html`: only after Developer 3 reports it is free.
1. **Journey contract:** write a proposal (stage values, next required action per stage, parallel steps such as lab and pharmacy at once, what happens when a visit closes with open tests or unfilled prescriptions). Send it to the Lead before coding. No new `stage` values in the rules until approved.
2. **Shared patients:** review what a receiving facility can do with a shared patient (read only today, must be registered as ours to start a visit). Check the consent and origin labelling required by Master Directive section 3.
3. **Audit viewer:** a small read-only screen for `pc_audit_logs` and `pc_access_logs`, for owner / `audit.view` only (STAGE0 finding S3).
4. **`patient.edit`:** find where edit is allowed in `patient.html` and confirm it follows the key (STAGE0 S4).

## Developer 4: guidelines, reference ranges, notifications, laboratory
Files: `guidelines.html`, `pc-guidelines.js`, `mc-notify.js`, `pc-lab.js`, `laboratory.html`, `investigations.html`.
1. **Notifications:** propose event types first (due or late dose, scheduled injection, critical lab result waiting for acknowledgement, review date, expiring guideline). No Cloud Functions: schedule on the device from data it already has, as `mc-notify.js` does. State clearly what happens when the app is closed or the phone is offline.
2. **Reference ranges:** age- and sex-specific ranges for lab tests and vitals, with the source stated and approval kept. No clinical numbers shipped by the app.
3. **Fix** `tests/guidelines-browser-check.js` (it fails on the original zip) or replace it with a correct check.
4. **Laboratory ledger (Lead built it, section 6 of the contract):** review it; the `sales` rows are written by `saveBill` and `reverseBill`. Do not change them without the Lead.
5. **Guidelines rule** is close to the 1000-expression limit; the Lead owns the fix, tell the Lead of any new guideline fields first.

## Everyone
- Work in small stages; after each stage run `node --test "tests/*.test.js"` and the browser checks relevant to your files and report the result.
- Name the files you edited. Two developers must not edit the same file at the same time.
- Mobile (390 px) and desktop (1280 px) for every screen you touch. Test offline for every write.
