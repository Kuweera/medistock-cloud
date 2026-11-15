# UX_FORM_SIMPLIFICATION.md
Phase 5, Developer 3 (User experience). Status: **first pass delivered, not tested on a phone, not released.**

## 1. Data Contract: confirmed
I use the contract names exactly and change **no** field names, collections or business logic.
- `prescriptions`, `dispense_records`, `guidelines`: read-only for me; I do not write them.
- `mc-core.js` not edited. `inventory`/`sales` schemas not touched.
- Every change below is label text, help text, permission lists, or a new pure helper file.

## 2. Files changed
| File | Change |
|---|---|
| `users.html` | 5 permission keys added: `dispense.view`, `dispense.perform`, `dispense.report` (Dev 1) and `guidelines.manage`, `guidelines.approve` (Dev 2). New **Pharmacist** quick-fill. Existing keys and presets unchanged. |
| `encounter.html` | "Duration unit" -> "How long has the patient had this complaint? (unit)" with help. "Quantity to supply" -> "How much should the pharmacy give?" with help that it is in the medicine's smallest unit (Dev 1 request). Element ids unchanged. |
| `dosing-rules.html` | "Dose per kg" -> "Dose for each kilogram of body weight" with the explanation from the plan. "Per administration" labels reworded; the difference from "Highest total dose in 24 hours" is explained beside the field. |
| `pc-ux.js` (new) | `PCUX.friendlyError`, `ageFromDob`, `bmi`, `savedText`. Pure functions. |
| `tests/ux.test.js` (new) | `node --test tests/ux.test.js` (2 tests, pass). |

## 3. Integration lines for Developer 4 (not applied by me)
- `sw.js` PAGES: add `"pc-ux.js"`; bump `VERSION` once, together with Dev 1 and Dev 2's lines.
- `firestore.rules`: the new permission keys only matter once Dev 4 uses them in the rules.
- Pages that want friendly errors add `<script src="pc-ux.js"></script>` and call `PCUX.friendlyError(err, "patient")` in their catch blocks.

## 4. Second pass (completed)
| Area | What changed (labels, help and messages only; saved fields identical) |
|---|---|
| Treatment-order form (`encounter.html`) | Schedule names in plain language: Give once / at regular intervals / at selected times every day / on selected weekdays / only when needed / Reduce the dose in stages / Select individual dates and times / dose worked out from weight. A short explanation **and an example** appear under the choice (`SCHED_HELP`). Option values (`once`, `interval`, `daily`, `fixed`, `weight`, `prn`, `taper`, `custom`) unchanged. Dose, unit, route, instructions, first dose and time relabelled with help. |
| Error messages (9 pages) | `patients, patient, encounters, encounter, investigations, laboratory, treatment, dosing-rules, users`: save failures use `PCUX.friendlyError`; raw "Firestore refused…", "(v12) rules not published" and database messages removed from user screens (the raw error goes to the browser console only). Pages still work if `pc-ux.js` is not cached yet (fallback text). |
| Age (`patients.html`) | Live "Age: 6 years" line under the date of birth. Display only. |

**Correction to my first-pass note:** BMI (with the under-2-years guard) and age text already existed in `encounter.html` and `patients.html`; I did not replace them. `PCUX.bmi` is not used.

## 5. Not done, needs agreement before I start
- Stepped forms (basic -> extra -> review) for the long forms: they change `encounter.html` save flow. One form at a time, after Developer 4's first check.
- Medicine catalogue picker on the order form, "Related guidance" links, and a phone layout check.
- Owner-only technical hints (for example "publish rules v14") were removed from ordinary screens; Developer 4 may want an owner diagnostics page.
