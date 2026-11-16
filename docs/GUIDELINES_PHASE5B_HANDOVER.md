# Developer 2 handover: Clinical Guidelines and Smart Prescribing (Phase 5b)

## 1. Summary
Approved guidelines now appear inside the visit screen (`encounter.html`) at triage, consultation, tests, diagnosis, treatment and follow-up. A background matcher (`PCG.match`) uses age, sex, pregnancy, weight, vitals, complaints/findings, diagnoses, test results and current medicines. Every suggestion shows **why it is shown** and its **source**; warnings are drawn separately from recommendations; the clinician can **Review / Accept / Dismiss**. Nothing is auto-diagnosed or auto-prescribed. Prescribing has three levels (guideline regimen, manual, rule-checked); a missing dosing rule never blocks an authorised order. A medical abbreviation dictionary and exact elapsed-hour schedules (0, 12, 24 h) were added.
**No clinical content is shipped.** The library is empty until a facility enters real guidance from the real source and an authorised person approves it. All test fixtures are labelled "TEST".

## 2. Files
New: `pc-abbrev.js`, `pc-guidance-ui.js`, `tests/guidance.test.js`, `tests/encounter-harness.html`, `tests/encounter-guidance-check.js`, `docs/GUIDELINES_PHASE5B_HANDOVER.md`, `docs/screenshots-dev2/*.png`.
Modified (mine): `pc-guidelines.js` (matcher, triggers, applicability, regimens, dismissal), `guidelines.html` (applicability, triggers, publication date, supporting document, regimen editor), `tests/guidelines.test.js` (fixture gets `publicationDate`).
**Modified SHARED files (Developer 3 / 4 must merge, do not overwrite):**
- `encounter.html` (Developer 3's screen): script tags, six `data-gstage` strips, elapsed schedule type, abbreviation box, "enter the dose myself", guidance module, extra order fields. Original kept by diff only.
- `pc-sched.js`: new `elapsed` schedule type + `parseHours`.
- `firestore.rules` line ~970: `'elapsed'` added to the allowed `scheduleType` list of `pc_treatment_orders`. **Not tested against the emulator.**
- `sw.js`: `VERSION` mc-v25 -> mc-v26; `pc-abbrev.js`, `pc-guidance-ui.js` added to the cache list.
`mc-core.js`, inventory and sales files are untouched.

## 3. Schema additions (all additive)
- `guidelines`: `applicability{minAgeMonths,maxAgeMonths,sex,pregnancy,minWeightKg,maxWeightKg}`, `triggers[]` (lines such as `vital: spo2 < N`, `symptom: x`, `test: name = result`, `diagnosis: x`, `medicine: x`; numbers are typed from the source), `regimens[]`, `publicationDate`, `supportingDoc`. Approval now requires `publicationDate`.
- `pc_treatment_orders`: `prescribingLevel` (guideline | rule_checked | clinician), `dosingCheck` (rule | not_checked), `checkedRuleId`, `checkedRuleVersion`, `guidelineRef`, `regimenLabel`, `abbreviation{code,meaning}`; `scheduleType: "elapsed"` with `sched.hours[]` (and optional `sched.doses[]`).
- `pc_clinical_notes` (accept): `noteType:"other"`, `structured{action:"accepted", stage, guidelineRef, reasons[]}`.
- `pc_audit_logs`: new actions `guideline.accept`, `guideline.dismiss` (existing shape).
- Dismissals are NOT stored in Firestore (per device, localStorage).

## 4. Rule changes
Only the `elapsed` enum value above. Proposed guideline rules from turn 1 (`docs/GUIDELINES_RULES_PROPOSAL.txt`) are still not in `firestore.rules`; until Developer 4 adds them `guidelines` is default-deny and strips stay empty. Suggested emulator test (NOT written, NOT run): create a `pc_treatment_orders` doc with `scheduleType:'elapsed'` as a prescriber (should succeed) and with `'bogus'` (should fail).

## 5. Dependencies
None added (no packages).

## 6. Tests and results
- `node --test "tests/*.test.js"`: **104 pass, 0 fail** (matcher, reasons, applicability, triggers, regimens, dismissal, abbreviations, elapsed schedules, no-clinical-content check, sw.js cache list).
- `node tests/encounter-guidance-check.js` (Chromium, real `encounter.html`, **in-memory Firestore stand-in**): PASSED. Proves in the actual visit screen: strips appear per stage; reason + source shown; drafts/unrelated/age-excluded guidance hidden; warnings visible and styled apart from recommendations; Accept writes a visit note + audit entry and creates no order/diagnosis; Dismiss hides it, same reasons do not bring it back, a new matching complaint does; regimen fitting by weight; "Use this regimen" pre-fills but saves nothing; saved order has exact events at 0/12/24 h; manual order without a dosing rule saves with `dosingCheck: not_checked`; abbreviation meaning shown and never sets the dose; QD flagged unsafe; empty visit shows nothing; user without prescribe permission gets a disabled button.

## 7. Actual Firebase status
**NOT tested against real Firebase.** Not run: the Firestore emulator and `firestore.rules` (including the `elapsed` change), real network, offline/online switching, multi-user or multi-device behaviour, a physical phone. The browser tests use an in-memory stand-in written for these tests.

## 8. Screenshots
`docs/screenshots-dev2/`: `e1-consult-mobile.png`, `e2-regimen-prefill-mobile.png`, `e3-treatment-mobile.png` (390 px), `e4-consult-desktop.png` (1280 px). Headless Chromium, not a real phone.

## 9. Known bugs and gaps
- No clinical content; a real source and a second qualified approver are needed.
- `guidelines.manage` / `guidelines.approve` are not yet in `users.html` (only the owner can manage/approve).
- Dismissals are per device and per visit, not shared.
- Pregnancy is inferred only from an active `pregnancy_breastfeeding` history entry; otherwise "not recorded" is shown.
- Strips exist only in `encounter.html` (not `patient.html` / `treatment.html`).
- Triggers are simple one-line comparisons; no free-text or combined (AND/OR) logic.
- A single out-of-range elapsed hour (e.g. 721) gives the generic "enter the hours" message.

## 10. Outstanding / dependencies on others
- Developer 4: merge the `firestore.rules` line, add the guideline rules, `sw.js`/`nav.js`, run the emulator.
- Developer 3: merge my `encounter.html` changes, add the permission keys to `users.html`.
- Real-Firebase, offline and phone testing by someone with access.
