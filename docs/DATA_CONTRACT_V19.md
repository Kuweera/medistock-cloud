# DATA_CONTRACT_V19.md
Lead Developer / Integration Architect. 2026-11-20. **Status: PROPOSED, nothing implemented. No developer may change the structures below until the Lead marks a section APPROVED.**
Owner decisions of 2026-11-20 (fixed): (1) prescriptions are created as `pending` at prescribing; (2) clinicians can read dispensing records; (3) lab cash must reach Cash Position through the main ledger; (4) no Cloud Functions, ever: client transactions/batches and Firestore rules only.

## 1. Prescription document created at prescribing (`prescriptions/{orderId}`)
**Writer:** the clinician (`treatment.prescribe`), in the SAME `writeBatch` that creates the `pc_treatment_orders` medicine order (rules: `existsAfter`/`getAfter` on the order; id = order id).
**Fields (additive to the v15 contract):** existing contract fields, plus `planId, encounterId, patientName, medicineName, orderVersion, qtySetBy ("prescriber"|"pharmacy")`.
| Field | At prescribing | Notes |
|---|---|---|
| `status` | `"pending"` | then `partially_dispensed` / `completed` (pharmacy) / `cancelled` or `superseded` (clinician, only while `qtyDispensed == 0`) |
| `qtyDispensed` | 0 | |
| `qtyPrescribed` | order quantity, or **null** when the clinician gave none | pharmacy sets it at first dispensing and records `qtySetBy: "pharmacy"` (same behaviour as today's "No quantity stated") |
| `drugId` | stock item id, or **null** for a medicine not matched to stock | pharmacy matches it at first dispensing (new narrow rule: set `drugId` once, only while null and `qtyDispensed == 0`) |
**Rules changes needed (v19):** (a) clinician `create` of a pending doc (zero quantities, status pending, active medicine order of the same facility and patient); (b) clinician `update` limited to `status -> cancelled|superseded` while `qtyDispensed == 0`, written in the same batch as the order stop/new version; (c) `rxStatusOk` accepts `pending` (outstanding == prescribed); (d) pharmacy first dispensing now goes through the **update** path when a pending doc exists, the **create** path stays for old orders that have no document (backward compatible, no backfill needed); (e) read for `dispense.view` OR `treatment.prescribe`/`patient.view` (status and quantities only; see section 2).
**Pharmacy effect:** the queue reads `prescriptions` (one document per order, now carrying `encounterId`, `planId`, `patientName`) and can group by patient, visit and plan. Stopped/superseded orders already in the queue keep working through `pc_treatment_orders` until all open orders have documents.
**Stop rule:** stopping an order that has dispensed quantity leaves the prescription `partially_dispensed` and the order `stopped` (pharmacy shows "stopped, do not dispense"); only a zero-dispensed prescription may become `cancelled`.

## 2. Clinician access to dispensing (read only)
`dispense_records`, `dispense_return_ledger`/`dispense_returns` summaries and `prescriptions` become readable by `treatment.prescribe`, `patient.view` and `treatment.administer` users **of the same facility** (`canAccessShop`). Money documents (`dispense_bills`) stay restricted to `dispense.view`/`dispense.report`. This also removes the finding that a pharmacist needs `patient.view` just to see the queue: dispense rules no longer depend on it. **Dev 3 shows dispensing status on the treatment and administration screens as information only. It never marks a dose given.**

## 3. Laboratory cash through the main ledger
Cash Position (`cash-position.html`, protected) reads only: `sales` (non-CREDIT), `credit_transactions` (`PAYMENT`), `cash_adjustments`, `expenses`, supplier payments, purchase receipts. Lab writes none of the cash-position sources today, so lab cash is missing and the drawer will not reconcile. Pharmacy already solved this by writing `receipts` + `sales`, so **cash-position.html needs no edit**.
**Lab will mirror the pharmacy pattern**, in the same batch as `pc_lab_bills/{orderId}` (so one bill cannot be posted twice):
- paid part: `receipts/labrc_{orderId}_p` (`type:"SALE"`, `paymentStatus:"PAID"`) and `sales/labsl_{orderId}_p` (`total = paid`, `paymentStatus:"PAID"`, `drugId:"lab_"+orderId`, `drugName: test name`, `drugClass:"Laboratory"`, `costOfGoods:0`, `source:"laboratory"`);
- credit part: `labsl_{orderId}_c` with `paymentStatus:"CREDIT"` plus the existing `credit_transactions/labct_{orderId}` (so revenue is not understated);
- reversal: negative `sales` rows (`labrvsl_{orderId}_p/_c`), as the pharmacy reversal does. **A cash refund is recorded the same way, so the drawer is correct;** the screen must say how much cash to hand back;
- later payments by the patient already flow through `credit_transactions PAYMENT` (shared account `dspca_{patientId}`).
**Not changed:** `firestore.rules` for `sales`/`receipts` (shop-scoped create already allows it); `cash-position.html`; `sales.html`.
**Risks to test:** (i) Reports/Dashboard/Charts list a "Laboratory" class and lab rows as items, with zero cost (check they do not look up `drugs` by `drugId`); (ii) the sales history page; (iii) backup/export; (iv) an offline lab bill posts all records once. Pharmacy's own spec section 8 is the model. **Owner confirmation needed** that lab revenue may appear in Sales reports under "Laboratory"; otherwise a lab-specific reporting split is needed and Cash Position would need a protected-file change.

## 4. Ownership and change control
| File / structure | Single editor | Others |
|---|---|---|
| `firestore.rules`, `users.html` permission keys, `sw.js`, `nav.js`, `DATABASE_SCHEMA.md` | Lead | submit a written request |
| `encounter.html` (1,599 lines) | one developer at a time, assigned by the Lead; edits reported by function name | |
| `pharmacy.html`, `pc-dispense*.js` | Dev 3 | |
| `encounters.html`, `patient*.html`, `directory.html` | Dev 2 | |
| `guidelines.html`, `pc-guidelines.js`, `mc-notify.js`, `laboratory.html`, `pc-lab.js` | Dev 4 | |
| `mc-core.js`, `sales.html`, `inventory.html`, `cash-position.html`, other protected files | nobody (hash baseline) | |

## 5. Still to be defined by the Lead before Dev 2 and Dev 4 start
Journey `stage` values and `nextAction` contract (Dev 2); attendance statuses for scheduled outpatient doses (`attended` / `did_not_attend`, kept separate from `administered`) (Dev 3); notification event types and who receives them without Cloud Functions (device-local scheduling from synced data, as `mc-notify.js` does today) (Dev 4).

## 6. Lab ledger: BUILT (offline-tested only), 2026-11-20
Changed: `pc-lab.js` (`ledgerRows`, `reversalRows`), `laboratory.html` (`saveBill`, `reverseBill`), `tests/lab.test.js` (+2), `tests-emulator/rules.test.js` (+1). Differences from section 3, on purpose:
- **No `receipts` are written.** The Returns/Exchange and reclassify screens in `history.html` work from receipts and would try to restock or re-bill a "medicine" that does not exist. Cash Position and Reports read `sales`, so nothing is lost. Consequence: lab sales do not appear in the receipt history list, only in reports and Cash Position.
- `drugId` is `lab_{investigationId}` (falls back to the order id), so Reports group by test name.
- Rows: `labsl_{orderId}_p` (PAID), `labsl_{orderId}_c` (CREDIT), reversal `labrvsl_{orderId}_p|_c`. `baseQtyDeducted 0`, `costOfGoods 0`, `drugClass "Laboratory"`, `source "laboratory"`. A reversal tells the user how much cash to hand back.
- Old lab bills made before this change have no `sales` rows. Their cash is still missing from Cash Position; a one-time owner-run "post past lab bills" tool is NOT built (decision needed: how far back, and whether the drawer was already corrected by a manual cash adjustment).
- Known limit: rules cannot stop a shop member from editing a `sales` row (existing shop-wide rule), and `pc_lab_bills` does not check that the matching `sales` rows exist in the same commit. A rule for that would use `existsAfter` and is proposed for v20 once the emulator confirms v19.
**Must still be checked by a person:** Reports, Dashboard and Charts with a lab row (class "Laboratory", zero cost; the "estimated cost" notice may appear), Cash Position before and after a lab payment and a reversal, and the same offline.

## 7. Visit journey hint (v20, PROPOSED), approved for Developer 2 on 2026-11-20
`pc_encounters.journey` (optional, additive, old visits stay valid): `{ v: 1, next: "triage"|"consultation"|"investigation"|"results_review"|"pharmacy"|"treatment"|"follow_up"|"discharge"|"none", waiting: [up to 4 of "laboratory","pharmacy","treatment","clinician","patient"], note: string <= 140 }`.
It is a HINT written by whoever finishes a step; the real records (triage, orders, results, prescriptions, treatment events) stay the source of truth, so every screen must still work when `journey` is missing or stale and must never block an action because of it. Writable on an open visit by `encounter.open`/`triage.record`/`consult.record` users together with `stage`; closing a visit may set it. Any other key or value is refused by the rules. `stage` values stay `registered | triaged | in_consultation` (no new stage without a written request to the Lead).
