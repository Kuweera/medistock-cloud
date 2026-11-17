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
| 6 | Medication administration | **Reviewed and clarified (fourth pass, below).** Already recorded every item the plan lists. Added the missing explanations. |
| 7 | Follow-up | **Done** (above), for the visit. A "patients due for review" list is **not done**. |
| 8 | Screenshots | Follow-up form (mobile, desktop) and close card (mobile) in `docs/screenshots-dev3/`. Other forms **not done**. |
| 9 | Field-by-field explanations | **Done (fifth pass): `docs/FIELD_EXPLANATIONS.md`, 186 fields, with a test that keeps it complete.** Required/optional marking on screen is only partly done (see below). |
| - | Facility-type workflows | **Decision made by the owner: facilities choose the services they offer and are not limited.** Nothing built so far hides a screen or makes a step compulsory. No further build needed for this; see rule below. |
| - | Reuse (allergies, diagnosis in test requests, dispensing history in patient history, lab results in review) | Allergy banner and weight reuse already exist. The other three were **not checked or built**. |

## Dependencies
- Developer 2: guidance strips and abbreviation box in `encounter.html` are merged and untouched.
- Developer 1: dispensing history on the patient screen needs the dispense records read access; not started by me.
- Developer 4: the real-Firebase test of the new note, and any decision on a "due for review" list.

---
# Fourth pass: medication administration, and the facility rule
Status: **tested in Chromium on an in-memory stand-in only. Not tested on real Firebase or a real phone.**

## Rule from the owner (applies to all my screens)
Each facility decides which services it offers. The app must **not limit** them. So: no screen is hidden by facility type, no step is compulsory because of a facility type, and every field I added is optional unless it is needed to keep a record safe (for example a reason when a medicine was not given). The follow-up plan, the "before you close" check and the administration help are all optional to use.

## Review of `treatment.html` against the plan (item 6)
| Plan asks for | Already in the screen? |
|---|---|
| Medicine, dose, route | Yes (shown on the card; planned dose pre-filled) |
| Scheduled time / actual time | Yes (planned time shown; date and time of the event entered, not in the future) |
| Administrator | Yes (name recorded automatically) |
| Given / withheld / refused / missed | Yes: Given, Patient refused, Hold (withheld), Not given, Missed |
| Reason or notes | Yes: reason is **required** for everything except Given; observations and reaction are optional |
| Separate from dispensing | Yes in the data (nothing in pharmacy or stock is written). It was not explained on screen. |
| Allergy safety | Yes: a matching allergy blocks "Given" until a clinician's authorisation is ticked |
| Corrections | Yes: "This record is wrong: correct it" keeps the original |

## What changed (text only; saved data and rules identical)
- A line under "Record what happened": *This records what was given to the patient. Dispensing from the pharmacy is recorded separately and does not count as giving the medicine.*
- A "Which button?" explanation of Patient refused / Hold / Not given / Missed. Staff were never told how Hold, Not given and Missed differ.
- Labels: "Date" and "Time" are now "Date this happened" and "Time this happened" (they are used for not-given outcomes too). The reason label now says it is needed for everything except Given. A hint says the dose shows the planned amount and should be changed only if a different amount was given.

## Files in this pass
`treatment.html` (help text only), `tests/treatment-harness.html` (new, reuses Developer 2's in-memory shim with one due medicine), `tests/treatment-check.js` (new), screenshots `administration-*.png`.

## Tests
`tests/treatment-check.js`: explanations present; "Not given" without a reason is refused and nothing saved; "Missed" with a reason saves outcome, reason, who gave it and when, and updates the event; "Given" saves the actual and the planned dose and **writes nothing to `dispense_records`, `prescriptions`, `sales` or `inventory`**; a matching allergy blocks "Given"; desktop and 320 px layouts; no page errors. All pass. `node --test tests/*.test.js` 104/104 and the other two browser checks still pass.
Run: `python3 -m http.server 8765`, then `node tests/treatment-check.js docs/screenshots-dev3`.

## Still not done
- Showing the pharmacy's dispensing record next to the administration (Dev 1's data; needs a read permission decision with Dev 4).
- "As needed" (PRN) screen and the correction flow were reviewed by reading only, not in the browser.
- The complete field-by-field document, other forms' screenshots, triage fields that change by service.

---
# Fifth pass: field-by-field explanations (deliverable 9) and on-screen help
Status: **tested in Chromium on an in-memory stand-in and by unit tests only. Not tested on real Firebase or a real phone.**

## What was built
1. **`docs/FIELD_EXPLANATIONS.md`**: every labelled field in the nine patient-care pages (186) with what it means and whether the screen marks it required, optional or neither. I wrote it from the real forms and checked option lists against the explanations; three explanations were wrong on the first draft (sex has four options, history types, consent methods) and were corrected.
2. **On-screen explanations** (a short grey line under the box) for the fields that confuse most, including the five the plan names:
   - Frequency, route, duration: *Medicines taken before* (how often, route, for how long).
   - Specimen and reference range: *Test catalogue* (sample, result type, units, reference range in words, where the range comes from) and the lab result flag and sample number.
   - Triage: category, consciousness, MUAC, pain score. Diagnosis: how sure, role, ICD code. Plan: setting, review date, expected end, materials used. Order form: hours between doses, number of doses, and the as-needed limits (what it is for, shortest time between doses, most doses a day, most total, how many days).
   - 30 explanations in all: `encounter.html` 21, `investigations.html` 5, `laboratory.html` 2, `patients.html` 1, `patient.html` 1. They describe the field only. **No clinical advice or dosing numbers were added.**
3. **Tests that keep this honest**
   - `tests/fields-doc.test.js` (10 tests): fails if a plainly labelled field in any of the nine pages is not in the document. I proved it by deleting one row: it failed naming the field, then passed when restored.
   - `tests/hints-check.js` (Chromium): the explanations appear on screen, including those built in JavaScript (the scheduled and as-needed order fields), are not duplicated when the form re-renders, and the page has no errors. The test-catalogue explanations are checked in the source file because that page needs the app shell to render; this is a source check, not a rendered one.

## Test results
`node --test tests/*.test.js`: **114 of 114** (104 earlier + 10 new). Browser checks `hints-check`, `treatment-check`, `followup-check` and Developer 2's `encounter-guidance-check` all pass.

## Findings (not fixed)
- **Required/optional marking is only partly done.** Of the 186 fields, 37 are marked required, 16 are marked optional and **133 are marked neither way**. The plan asks that required and optional fields are clearly identified. I did not mark the 133, because whether a field is really optional is decided by the code that saves it, and each one needs checking against that code (and, for records, the rules). This is the natural next piece of work.
- The document was produced with a helper script that is not in the repository. The test above is the safeguard; regenerating the document from scratch would need that script rewritten.
- The laboratory section describes the current screen. Developer 4 is rebuilding it, so it will need an update.

## Files in this pass
`encounter.html`, `investigations.html`, `laboratory.html`, `patients.html`, `patient.html` (explanation lines only; `encounter.html` also contains the earlier follow-up change, so merge rather than overwrite), `docs/FIELD_EXPLANATIONS.md`, `docs/UX_FORM_SIMPLIFICATION.md`, `tests/fields-doc.test.js`, `tests/hints-check.js`, screenshots `hints-*.png`.
