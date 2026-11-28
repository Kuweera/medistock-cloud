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

## 8. Rules v21 (Lead, PROPOSED; approved design, 2026-11-21)
1. **Identity corrections.** Changing `fullName, nameKey, sex, dob, dobApprox, dobPrecision` on a patient needs, in the SAME commit: `identityVersion` = old + 1 (missing counts as 0) and a new `pc_patient_corrections/{patientId}_{version}` with `patientId, version, reason (3-300 chars), before{..}, after{..}, correctedBy` (+ the usual businessId, facilityId, schemaVersion, createdBy, createdAt). Append-only (no edit, no delete); readable with `patient.view` in the facility. Other patient fields are edited as before. **Not backward compatible for the current edit screen: a page that changes these fields without the record will get permission-denied. Developer 2's page and v21 must go live together. Do not publish v21 before that page is merged.**
2. **Snapshot refresh.** Holder of `patient.consent` at the sharing facility may update `patientSnapshot` and set `snapshotAt = server time` on an ACTIVE share. Nothing else in the same update.
3. **Share expiry (owner chose "optional expiry").** Optional `consentExpiresAt` (timestamp). Absent/null = never expires (all existing shares unchanged). A new date must be in the future. The sharing facility can set, extend or clear it on an active share. After the date the receiving facility can no longer read the shared records (allergies, history); the share document itself stays readable so the screen can say "expired". Re-granting a revoked share must set a new date or clear the old one.
New collection: `pc_patient_corrections`. New optional fields: `pc_patients.identityVersion`, `pc_shares.snapshotAt`, `pc_shares.consentExpiresAt`. Status: **CI green on the emulator (2026-11-21).**

## 9. Order care mode (v22, PROPOSED, approved for Developer 3 on 2026-11-21)
`pc_treatment_orders.administrationMode` (optional, set at creation only): `take_home` | `facility_administered` | `inpatient_mar`. Missing = today's behaviour for every existing order. `take_home`: prescription + dispensing, **no administration events and no MAR rows**; adherence at home is not tracked by staff. `facility_administered`: events are scheduled and staff record each dose (outpatient injections, procedures). `inpatient_mar`: events plus the ward MAR. The rule accepts only these values and the existing update rule already refuses changing it later (a wrong mode means stop the order and prescribe again). Dispensing is still never administration, whatever the mode. Status: awaiting CI.

## 10. Rules v23 (Lead, PROPOSED, awaiting CI): attendance and consumables Option B (2026-11-22)
Note: v22 (`administrationMode`) passed emulator CI (58/58).
**Attendance** (`pc_treatment_events`, optional fields `attendance` = `attended` | `did_not_attend`, `attendanceAt` (ms), `attendanceBy` (uid), `attendanceByName`; `pc_mar_records.attendance` = `did_not_attend` only):
- A1 arrival: pending event stays pending; needs `treatment.administer`; order `administrationMode == facility_administered`; `attendanceBy == uid`; only the attendance keys change. Reception cannot record arrival (Q1).
- A2 did not attend: pending -> missed, with the MAR record (`outcome missed`, `attendance did_not_attend`, reason 3+ chars) in the same commit; refused after an arrival.
- A3 correction (`mar.amend`): a did-not-attend event returning to pending must clear `attendance`.
- A4 undo of a wrong arrival while pending. A5 MAR `attendance` only with `did_not_attend` + `missed`.
- "Overdue" stays derived in the screen; the system never records did-not-attend by itself. Procedures are eligible (mode is checked, not kind) (Q2).
**Consumables (Option B):** `pc_treatment_orders.kind = 'consumable'` (needs `medicineId`, `medicineName`, `quantityPrescribed` > 0, `scheduleType 'once'`); kind accepted as `medicine` or `consumable` in three dispensing rules: pending prescription create (C2), `dispenserOrderReadOk` (C3), AND the first-dispensing create path (rules ~L1390, missed in the request). Consumable orders cannot have dose events (`evOrderOk`). Supply needs `dispense.perform` (Q3). Order fields reuse `medicineId/medicineName/quantityPrescribed` (Q4). **Not in the rules, in Developer 3's code:** `pc-dispense.js` L215 (`not_medicine` error), L367 (probe) and L429 (report filter) check `kind === "medicine"` and must accept `consumable`.
Q5 (open for the owner): a nurse who records a used consumable without `treatment.prescribe` can no longer do so in the new flow; a prescribe-capable colleague or a role change is needed.
Note (2026-11-22): v23 passed emulator CI.

## 11. Rules v24 (Lead, PROPOSED, awaiting CI): guideline import, Stage 1 of Developer 4's request R1
- `guideline_sources/gsrc_{first 16 hex of sha256}`: create by `guidelines.manage` (status `imported`, sha256 64 chars, file name, source title >= 3 chars, organisation, jurisdiction, edition required); the id rule makes a second import of the same file impossible. Update only by `guidelines.approve`: `imported` -> `rejected` (reason >= 3 chars) or `retired`.
- `guideline_sections/{sourceId}_s{seq 5 digits}`: create by `guidelines.manage` in the same commit as, or after, its source (same business); `reviewStatus` starts `unreviewed`; text <= 100,000 characters; tableRows <= 500 rows. Update only `reviewStatus` / `usedInGuidelineId`.
- READ is business-wide for `guidelines.manage` and `guidelines.approve` holders (decision for R1 question 2). Nothing is deleted. Sections are reviewer-only raw extracts; clinical use still needs a `guidelines` draft and approval.
- `guidelines` additive fields `sourceDocId`, `sourceSectionIds`, `sourcePages`: already accepted by the existing create and draft-edit rules (they do not restrict extra keys).
- NOT yet written (later stages): `pc_reference_ranges` and keys `ranges.manage` / `ranges.approve` (Stage 3), `pc_reminder_settings`, `pc_reminder_log` (Stage 4).

## 12. Reference range sources: OWNER DECISION, 2026-11-22
Note: v24 (guideline import rules) passed emulator CI.
The owner accepted the Lead's recommendation. The app ships NO reference values.
- Adult routine blood counts and chemistry: ONE primary source is chosen by the laboratory manager from the published East African adult studies (CLSI-derived intervals for healthy adults in Eastern and Southern Africa; Ugandan blood donor study; Kenya urban CBC study) or from a Ministry of Health / national referral laboratory controlled document if one exists. Candidate list and links are in the Lead's message of 2026-11-22; the approver must read the source itself.
- Anaemia and pregnancy haemoglobin cut-offs: WHO "Guideline on haemoglobin cutoffs to define anaemia in individuals and populations" (2024).
- Method for adopting a range: CLSI EP28-A3c (verify a published range on the laboratory's own healthy patients).
- Children: no suitable source found. No child range is entered until the owner provides one. Shows "No reference range available".
- Every entered range needs: a named source (>= 3 characters), unit, effective and review dates, and approval by a second person (`ranges.approve`). A range is never applied to a group (age, sex, pregnancy) the source did not cover.
- Not decided yet: who the laboratory manager is, and which Ministry document (if any) applies.

## 13. Rules v24b (Lead, PROPOSED), after Developer 4's Stage 1 report (2026-11-22)
Found by checking v24 against the exact fields of the report: v24 refused a RETIRE, because the retired* fields (`retiredReason`, `retiredBy`, `retiredByName`, `retiredAt`) were not in the allowed list. Fixed: retire now needs a reason (3+ characters) and `retiredBy` = the approver, like reject. New: `guidelines.manage` may RAISE `sectionCount` of an imported source (never lower, nothing else), so more chapters of the same file can be added later (section creates against an existing source were already allowed). Queries confirmed allowed: sources by `businessId`; sections by `businessId` + `sourceId` (equality only, no composite index, no ordering). A query without `businessId` is refused. A 400-section batch test was added. The source's `createdAt`/stamp and extra fields (`publicationDate`, `importDate`, `addedByName`, `pageCount`, ...) are accepted (no key restriction on create).

## 14. Rules v25 (Lead, PROPOSED, awaiting CI): reference ranges, Stage 3 of Developer 4 (2026-11-23)
Collection `pc_reference_ranges/rr_{rangeKey}_v{version}`, fields as in Developer 4's Stage 3 request section 2.1. Keys `ranges.manage` (drafts) and `ranges.approve` (approve, replace, retire) added to `users.html`; NOT part of the Laboratory quick-fill (give them on purpose).
Decisions: (1) facility-scoped; (2) pregnancy status is entered at result entry and stored only in `refApplied` (not on the patient), default "not stated"; (3) a range past its review date is still used and marked "review overdue"; (4) an estimated date of birth is used and recorded as `ageBasis: estimated`; (5) two equally specific ranges = conflict, no flag, no value; (6) no one holds the keys by default; owner assigns, suggested: laboratory staff manage, laboratory lead/clinician approve (a different person); (7) self-approval is recorded (`selfApproved`), not blocked, as for guidelines; the screen must show it; (8) Developer 3 applies the `encounter.html` vital hooks (3d) when he is free.
Rules differences from the request's draft: sex/pregnancy lists and unit/source checks also apply to DRAFT EDITS; a supersede requires the newer version to belong to the same facility; retire requires `retiredBy` = caller. A newer version can replace an older one in the same commit that approves it (or already approved). The rules cannot detect overlapping ranges: the screen warns, and the chooser treats equal specificity as a conflict. `pc_inv_results.refApplied` needs no rule change (no key restriction on create).
Critical limits stay on the catalogue test and are never read from this collection. No values are shipped.

## 15. Rules v26 (Lead, PROPOSED, awaiting CI): alert rules, acknowledgements, lactation, observation fields (2026-11-24)
Note: v25 (reference ranges) passed emulator CI. Answers to Developer 4's brief (his section 4):
1. **`pc_alert_rules/ar_{ruleKey}_v{version}`** (facility-scoped, same lifecycle and keys as reference ranges: `ranges.manage` drafts, `ranges.approve` approve/replace/retire). Fields: subjectType (lab_test|lab_param|vital), subjectId, unit, level (moderate|critical), operator (lt|lte|gt|gte|range; range = minimum inclusive, maximum exclusive), value or min+max, message (3-300), urgencyText, minAgeMonths/maxAgeMonths (maximum exclusive), reproductive, contextRequired (list, <= 5), requiresAck (must be true for critical), allAges (required true for a vital with no age limits), source (>= 3) + his source fields, effectiveDate, reviewDate. No separate sources collection: each rule carries its own source fields (optionally `sourceDocId` of an imported guideline source). An alert-only rule (e.g. temperature) is an alert rule with no range document; reference ranges still need a bound or text.
2. **Observation form:** option A. Developer 4 builds `pc-obs.js` and `pc-obs-ui.js`; Developer 3 mounts them in `encounter.html`. Nobody else edits the triage block.
3. **Lactation:** `reproductive` = any | pregnant | lactating | pregnant_or_lactating | neither, on ranges and alert rules. The old `pregnancy` field is still accepted (no data exists). Pregnancy and lactation are STATED at entry (default not stated); no field is added on the patient and nothing is inferred. A woman who is both matches both rules: a visible conflict, never a silent pick.
4. **Triage storage:** additive fields on `pc_triage` (no new observation collection): `interp` (map, <= 20 keys; written once, never rewritten), `ctx` (map, <= 30 keys), `repeatOf` (id of the first reading; a repeat is another triage document). Existing triage rules already accepted unknown keys; v26 adds size/shape limits only. **Acknowledgements are NOT stored on the triage document** (triage records are add-only): a new append-only `pc_obs_acks/ack_{triageId}_{measure}` (triage.record holder = the recorder, same open visit and patient, level, ruleId, ruleVersion, ackBy = caller, note <= 300).
5. **Seed import:** drafts only, never approved; no value ships in app code. The values in the planner's seed need the clinical corrections listed in Developer 4's brief (temperature, MUAC at 11.5 cm, SpO2 at 90%, pregnancy SpO2, severity labels, age boundaries) before they are even drafted as final.
Quoted correction to his brief: triage rules were NOT closed to unknown keys (so no `triageOk` rejection of the new fields existed); v26 only bounds them.

## 16. Rules v27 (Lead, PROPOSED, awaiting CI): reviewed proposals, answer to the Master Planner's evidence proposal (2026-11-25)
Note: v26 passed emulator CI. The planner's proposal (research-based DRAFT values, clinician approves, rejects, edits, replaces or creates their own) fits the existing design; the rules changes below make the review workflow enforceable. **No value is shipped in app code; the importer creates drafts only.**
Rules (both `pc_reference_ranges` and `pc_alert_rules`):
- New status **`rejected`**: a DRAFT can be rejected by `ranges.approve` with a reason (3+ characters) and `rejectedBy` = caller; it is kept, final, never active, never deleted. An approved rule is not rejected: it is retired or superseded.
- **Approval needs `reviewerCredential`** (2-100 characters, who the approver is, e.g. role and registration) and may carry `approvalNote` (<= 500). `selfApproved` is still recorded. This makes each approval an explicit clinical attestation, not a technical click.
- **`origin`** (e.g. `evidence_proposal` or `custom`) and **`proposal`** (a map: the original researched values and source) are immutable once a draft exists; edits go in the normal fields with an optional `changeReason`. So the original proposal, the clinician's edit and the reason are all kept.
- Alert rules: `ruleType` = `screening` | `alert` | `emergency` (separate from a normal range); `level` is now optional (`screening` | `moderate` | `critical`); an `emergency` or `critical` rule must have `requiresAck: true`; screening and alert rules need not.
Importer requirements (Developer 4): deterministic ids; **skip every id that already exists in ANY status (approved, rejected, retired)**, so a re-import never overwrites a clinician's edit, approval or rejection; drafts only; `origin: "evidence_proposal"`; the source URL is stored as text and shown as a link that opens safely.
**Evidence check done by the Lead on 2026-11-25** (public pages, read on the day; what the page text confirms, not clinical advice):
- SpO2 (WHO SARI toolkit, oxygen module): start oxygen below 90% (adults and children without emergency signs), below 94% with emergency signs, "<92-95%" in pregnancy; targets >=90%, >=94% during resuscitation, ">=92-95%" in pregnancy. **Confirmed** as in the proposal, including the pregnancy RANGE.
- MUAC 6-59 months (WHO eLENA): moderate = 115 mm or more and under 125 mm, so **exactly 11.5 cm is moderate** (lower limit inclusive). **Confirmed.** The page does not define severe. The UCG (p. 869 "and below" 115) differs: keep both sources on the rule.
- Fever (IMCI in-service module 1, AFRO copy): the text read says **"37.5 C or above"** for a sick child (2 months to 5 years) and **"38 or above"** for a young infant (under 2 months). The page text did **not** state the measurement site, and did **not** show the "high fever 38.5 axillary / 39 rectal" threshold. **Not confirmed**: keep the site-specific and high-fever rows as `review_required` until someone reads the page cited by the planner.
- Fast breathing (WHO IMCI >=60 / >=50 / >=40): **not confirmed by me** (the page could not be read). **Known difference:** the UCG wording read by Developer 4 is "more than" (>60, >50, >40), the planner's WHO wording is "or more". They differ exactly at 60, 50 and 40. The planner's acceptance test "exactly 50 is positive" follows WHO; the UCG reads differently. This is a clinician's choice for a Uganda facility, and both sources stay on the rule.

## 17. Rules v28 (Lead, PROPOSED, awaiting CI): lactation is its own field (2026-11-25)
Note: v27 passed emulator CI (84 tests, including real dispensing of a consumable). Decision for Developer 4's mismatch (his engine reads `lactation`, the v26 rules offered `reproductive`): **the rules follow the engine and the Master Planner.** Pregnancy and lactation are independent facts (a woman can be both), so each has its own field.
- `pc_reference_ranges` and `pc_alert_rules`: `pregnancy` = any | pregnant | not_pregnant (now also checked on alert rules); NEW `lactation` = any | lactating | not_lactating. Missing = any.
- `reproductive` (v26) is accepted ONLY as absent or `any`. No data exists under it. This makes it impossible to save a value the engine would silently ignore (clinical safety).
- `requireFlags` and `forbidFlags`: lists of at most 10; `boundaryNote` and `decisionReason`: text of at most 500 characters, or absent (omit the field; do not write null for the lists). Other extra keys on create remain unrestricted.
- A range with only `refText` (no minimum or maximum) is valid by design (qualitative results such as "Negative"); the engine must not compute a numeric flag for it.
- Every measurement is data, not code: blood pressure (systolic and diastolic as two parameters), pulse, respiratory rate, temperature, SpO2, MUAC, glucose and every laboratory range are entered through the ranges screen as `subjectType` vital / lab_test / lab_param, with a source, approval by a second person and review dates. Nothing clinical ships in app code. Data-entry sanity limits (impossible values) are not ranges but must be listed by Developer 4 so the owner can approve them.

## 18. Rules v29 (Lead, PROPOSED, awaiting CI): data-entry limits and device glucose status (2026-11-26)
Owner (Master Planner) decision: the table below is approved as **technical data-entry boundaries only**. It never decides clinical normality or severity; reference ranges and alert rules stay in the approved clinical process.
| Measurement | Unit | Minimum | Maximum |
|---|---|---|---|
| Temperature (`temperatureC`) | °C | 25 | 45 |
| Systolic BP (`bpSys`) | mmHg | 20 | 300 |
| Diastolic BP (`bpDia`) | mmHg | 10 | 200 |
| Pulse (`pulse`) | beats/min | 10 | 300 |
| Breathing rate (`respRate`) | breaths/min | 2 | 100 |
| Oxygen saturation (`spo2`) | % | 30 | 100 |
| Weight (`weightKg`) | kg | 0.3 | 500 |
| Height (`heightCm`) | cm | 20 | 260 |
| MUAC (`muacCm`) | cm | 3 | 60 |
| Pain score (`painScore`) | 0 to 10 list | 0 | 10 |
| Glucose (`glucose`) | mg/dL | above 0 | 1000 |
| Glucose (`glucose`) | mmol/L | above 0 | 55.5 |
Minimum and maximum are inclusive except glucose (zero excluded). 1000 mg/dL = 55.5 mmol/L (factor 18.018). No silent rounding.
**`pc_triage` create (rules v29):**
- `glucose`, when present and not null: a number above 0; `glucoseUnit` is REQUIRED (`mg/dL` or `mmol/L`); maximum 1000 for mg/dL, 55.5 for mmol/L.
- Device result outside the measuring range: `glucoseStatus` = `below_device_range` | `above_device_range`. With a status, `glucose` is absent or null (never a fabricated number), `glucoseUnit` is required, `glucoseDevice` (text, at most 100) is optional. A status and a number together are refused.
- `bpSys` and `bpDia`, when both are present: `bpDia < bpSys` (data quality, not an alert).
- Triage records stay immutable except for the entered-in-error path. Older records are not changed; the rules apply to new records only.
- Reusable model: a future measurement may add `<measure>Status` with the same two values; do not add UI for other measurements until the owner has established which instruments support them.
- The status is not a concentration and gets no automatic clinical interpretation: `interp` is not computed for it.

## 19. Rules v30 (Lead, PROPOSED, awaiting CI): treatment reminders, Developer 4 request R3 (2026-11-28)
Approved design: alerts are DERIVED on each device from data that already syncs (events, orders, settings, acknowledgements). Only two new collections; no existing collection changes; no Cloud Functions.
- `pc_reminder_settings/{facilityId}`: `graceMin` 5 to 240 (absent = 30), `soonMin` 5 to 240 (absent = 30), `escalateAfterMin` 0 to 720 (0 or absent = none), `appointmentAdvanceMin` 0 to 1440 (0 or absent = none). Whole numbers only. Created and changed only with `settings.manage` (its label in `users.html` is now "Settings: warning ranges for vital signs and treatment reminder timings"); read by `treatment.administer`, `treatment.prescribe` or `settings.manage`. Never deleted. Changes are written to `pc_audit_logs` (`reminder.settings`). These are operational timings, not clinical values.
- `pc_reminder_acks/{ackId}`, `ackId` = `rack_<eventId>_<level>`: create-only; level is one of dose_due, dose_overdue, dose_escalated, appointment_soon, appointment_overdue, missed_recorded, did_not_attend; the event must exist and match facility, patient and order; `ackBy` is the caller; note at most 300. **An acknowledgement means "I have seen this". It records no dose and changes no event.** A second acknowledgement of the same event and level is refused (the first stands).
- Event types are derived only for `inpatient_mar` and `facility_administered` orders; `take_home` never creates a staff alert; `held` events give none; "missed" exists only when staff record it.
**Lead decisions on the questions:** Q1 `settings.manage`. Q2 orders without `administrationMode`: in-app list only, no push. Q3 an owner's own device gets dose alerts only if switched on in that device's settings. Q4 acknowledging does not stop escalation; it shows who acknowledged and when. Q5 keep the `Africa/Kampala` fallback and show a one-line notice in the settings section when the facility has no time zone. Q6 held doses give no reminder until released. Q7 no patient reminders in this release; a staff follow-up list of patients who did not attend, derived from existing `attendance` data, is allowed (no schema). Q8 `pc_reminder_log` is dropped. Q9 no nurse or ward assignment exists; everyone with `treatment.administer` gets dose alerts, only the prescriber gets escalation. Q10 treatment reminders take priority up to 40 of the 60 notifications, grouped into one digest beyond that.
Wording rule: notifications are "scheduled on this device", never "delivered".

## 20. Lead decisions after Developer 3 Stage D and Developer 4 Stage 4 (2026-11-28). NO rules change in this section (rules stay at v30)
- **v30 status:** published by the owner on 2026-11-28 (reported 20:14); the owner is to confirm that the last rules workflow run was green.
- **R4 (Developer 4): composite index on `pc_reminder_acks`** (businessId asc, facilityId asc, createdAt desc): NOT added. The app uses no composite indexes and no `orderBy` anywhere, and a free-plan project should not start depending on one. `treatment-alerts.html` falls back to the newest 1,000 acknowledgements and says so on screen. Revisit only if a facility reaches that number.
- **Stage D (close visit from the pharmacy):** uses the existing `pc_encounters` close rule (`encounter.close`, closedBy is the caller, only the six allowed fields, open visits only) plus one `pc_audit_logs` record (`action: "encounter.close"`) in the same commit. No rules change was needed. Covered by new emulator tests (v31).
- **Stage C (consumables from the pharmacy):** a pharmacist is recorded as prescriber; the audit record must also say "entered at pharmacy". Older orders without `administrationMode` cannot be closed from the pharmacy.
- **Menu and cache (`nav.js`, `sw.js` mc-v41):** `treatment-alerts.html` ("Treatment alerts") added to the menu and, with `pc-remind.js`, to the offline cache. `audit.html` was already present in both. The page checks the permissions itself (`treatment.administer`, `treatment.prescribe` or `settings.manage`) and shows a plain message to anyone else.
- **New emulator tests (v31, `tests-emulator/rules.test.js`, run by GitHub CI only):** non-owner `encounter.close` closes an open visit with its audit record, and the same visit cannot be closed twice; refusals for no `encounter.close`, another facility, another person as `closedBy`, a key outside the six allowed, and a cancel without a reason; a triage record with no glucose keys; reminder acknowledgements refused for users without a treatment permission, for another facility and for an order that does not match the event.
- **Still open (owner decision):** the later-dispensing update rule does not check that the order is still active.
