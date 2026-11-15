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

## 4. Review findings (not yet done)
Counted help text is thin everywhere (2 to 7 hints per page; encounter.html has 74 inputs).
1. **encounter.html**: consultation, triage and the treatment-order form are the largest. Needs the 3-step flow (basic -> extra -> review) and plain-language schedule picker with an example per type.
2. **Error messages**: pages show "Could not save: <raw message>" or mention rules versions (v11, v12, v14) to ordinary staff. Replace with `PCUX.friendlyError`. Keep the "rules not published" wording only for the owner.
3. **patients.html / patient.html**: show age automatically from date of birth (`PCUX.ageFromDob`); BMI beside weight and height in triage (`PCUX.bmi`).
4. **Typed medicines** in the order form should use the drugs catalogue picker, so Dev 1's pharmacist does not have to match stock by hand.
5. **Related guidance link** from each clinical screen to Dev 2's library: `mcGo(PCG.linkFor({ q: complaint }))` (needs `pc-guidelines.js` on the page).
6. Phone layout and tap sizes for the long forms not yet checked.

## 5. Not done, needs agreement before I start
- Progressive (stepped) forms change the save flow of `encounter.html`; I will do one form at a time and re-run the Phase 2 to 4 checks.
- Changing what a form saves (for example splitting blood pressure into two fields) needs Dev 4 and the owner of that data first.
