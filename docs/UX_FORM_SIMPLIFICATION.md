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

---
# Third pass (master implementation plan, Developer 3)
Status: **follow-up interface built and browser-tested on an in-memory stand-in. Not tested against real Firebase. Not tested on a real phone.**

## What was built
**Follow-up plan** (deliverable 7), inside `encounter.html`, Notes tab: choose *Type of note -> Follow-up plan*.
| Field | Explanation shown to the user | Required |
|---|---|---|
| Review date | The day the patient should come back. Leave empty if no review is needed. Must not be in the past. | Optional |
| What happens next? | Come back for review / Continue treatment at home / Come back with test results / Refer to another facility / Admit the patient / No further action needed | Optional |
| How is the patient progressing? | Improving / Same as before / Getting worse / Not stated | Optional |
| Instructions for the patient | Free text | Optional |
| Still open on this visit | **Filled in automatically**: tests with no verified result and treatment plans still active. The clinician does not retype them. | Automatic |
At least one of review date, next action or instructions is needed. The plan is a normal draft/sign note, so it keeps the existing amend and entered-in-error rules.

**Close-visit check:** the Close card now starts with "Before you close this visit": tests without a verified result, treatment still active, and whether a follow-up plan exists (with the review date).

## Database and rules: no change
- The plan is saved as an existing note: `pc_clinical_notes`, `noteType: "progress"`, with a `structured` map `{ kind: "followup", reviewDate (ISO), nextAction, progress, instructions, pendingTests[], outstandingTreatment[] }` and a readable `content` text.
- I checked `firestore.rules`: `noteType` is limited to `hpi, examination, assessment, progress, other, amendment`, and `structured` is not restricted. So **no rules change is needed and none was made.** I did not add `followUp` fields to `pc_encounters` because its close rule only allows `status, closedAt, closedBy, closeNote, cancelReason, updatedAt, updatedBy`.
- Consequence for Developer 4: follow-up plans are found by `noteType == "progress"` and `structured.kind == "followup"`. If a "patients due for review" list is wanted later, it needs an index or a dedicated collection, which is a rules decision for Developer 4.

## Files changed in this pass
`encounter.html` (note form, close card), `tests/encounter-harness.html` (one-word fix: the stand-in stored the visit under `enc1` but the page uses `e1`, so stage updates failed; Developer 2's check still passes), `tests/followup-check.js` (new), `docs/UX_FORM_SIMPLIFICATION.md`, `docs/screenshots-dev3/*.png` (new).

## Tests
- `node --test tests/*.test.js`: 104 of 104 pass (unchanged count; the new check is a browser test).
- `tests/followup-check.js` (Chromium, in-memory stand-in): form shows/hides correctly; empty, malformed and past dates are refused and nothing is saved; a valid plan saves as a signed `progress` note with the right structured values; the note list says "Follow-up plan"; the close card shows the review date and open treatment; a visit without a plan is reminded to add one; no sideways scrolling at 320 px; no page errors. Developer 2's `encounter-guidance-check.js` still passes.
- Run: `python3 -m http.server 8765` in the repo root, then `node tests/followup-check.js docs/screenshots-dev3`.
- **Not tested:** real Firebase, security rules with this note, offline sync, two users at once, a real phone.

## Master-plan deliverables: honest status
| # | Deliverable | Status |
|---|---|---|
| 1 | Registration | Existing form already has address, next of kin, date of birth or estimated age. Not changed in this pass. |
| 2 | Triage | Existing form has all listed vitals and pain score. Not changed. Showing only fields relevant to the service is **not done**. |
| 3 | Consultation | Existing complaint, history, medicines, notes with structured examination. Not changed. |
| 4 | Diagnosis | Existing form with codes. Not changed. |
| 5 | Treatment plan | Plain-language schedule names and examples (pass 2). Medicine vs procedure distinction, consumables: **not done** (consumables belong to Developer 1). |
| 6 | Medication administration | **Not done.** `treatment.html` exists; a review against the plan (given/withheld/refused/missed, reason, actual time) is still needed. |
| 7 | Follow-up | **Done** (above), for the visit. A "patients due for review" list is **not done**. |
| 8 | Screenshots | Follow-up form (mobile, desktop) and close card (mobile) in `docs/screenshots-dev3/`. Other forms **not done**. |
| 9 | Field-by-field explanations | Follow-up fields (above) and pass 1 to 2 labels. A complete document for every form is **not done**. |
| - | Facility-type workflows | **Not done.** Needs a decision on how a facility declares its services. |
| - | Reuse (allergies, diagnosis in test requests, dispensing history in patient history, lab results in review) | Allergy banner and weight reuse already exist. The other three were **not checked or built**. |

## Dependencies
- Developer 2: guidance strips and abbreviation box in `encounter.html` are merged and untouched.
- Developer 1: dispensing history on the patient screen needs the dispense records read access; not started by me.
- Developer 4: the real-Firebase test of the new note, and any decision on a "due for review" list.
