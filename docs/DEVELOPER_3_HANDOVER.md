# DEVELOPER_3_HANDOVER.md
From Developer 3 (patient workflow and form user experience) to Developer 4 (integration, security, testing).
Status: **my phase is built and tested on an in-memory stand-in. It is NOT tested on real Firebase, with the real security rules, offline, or on a real phone. That is your part. Some items in my scope are still open: section 6 lists them honestly.**

## 1. What I changed
| Area | Files | What |
|---|---|---|
| Permissions | `users.html` | Keys `dispense.view/perform/report`, `guidelines.manage/approve`; Pharmacist quick-fill |
| Plain-language labels and help | `encounter.html`, `dosing-rules.html`, `investigations.html`, `laboratory.html`, `patients.html`, `patient.html` | Clearer labels; 30 short explanation lines; schedule names with an example per pattern |
| Friendly errors | nine patient-care pages + `pc-ux.js` | Raw database messages replaced by plain wording; the raw error goes to the browser console only |
| **Progressive forms** | `patients.html`, `encounter.html` | Registration, triage, complaint, earlier medicines and diagnosis: main fields visible, extras under one expandable heading. Field ids unchanged |
| **Follow-up plan** | `encounter.html` | New note type, and a "Before you close this visit" check on the Close card |
| **Diagnosis when requesting tests** | `encounter.html` | One-tap buttons for this visit's diagnoses and complaints fill the (optional) reason box |
| Required/optional | 11 forms | One line under each form heading saying what is required (code read, then tested) |
| Administration help | `treatment.html` | Explanations only |
| Documents | `docs/FIELD_EXPLANATIONS.md`, `docs/UX_FORM_SIMPLIFICATION.md`, this file | |
| Tests | 10 browser checks, 3 unit test files, 3 harnesses, 1 screenshot script | See section 4 |
| Harness fix | `tests/encounter-harness.html` | One word: the stand-in stored the visit as `enc1` but the page uses `e1` (Developer 2's check still passes) |

## 2. What I did NOT change (verified)
`firestore.rules`, `sw.js` and `mc-core.js` are **byte-identical** to the zip I was given. No new collection, no new field on any existing collection, nothing touching inventory, sales, `prescriptions`, `dispense_records` or `guidelines`. No rules change is needed for anything I built.

## 3. The one data decision you need to know about
The follow-up plan is saved as an ordinary clinical note: `pc_clinical_notes`, `noteType: "progress"`, with `structured: { kind: "followup", reviewDate (ISO), nextAction, progress, instructions, pendingTests[], outstandingTreatment[] }` and readable `content`. The rules limit `noteType` to `hpi, examination, assessment, progress, other, amendment`, leave `structured` unrestricted, and the visit's close rule only allows `status, closedAt, closedBy, closeNote, cancelReason, updatedAt, updatedBy`, so a follow-up field on the visit would have been **denied**. I did not work around any rule.
- Find follow-up plans with `noteType == "progress"` and `structured.kind == "followup"`.
- A "patients due for review" list is **not built**; it needs an index or a collection, which is a rules decision for you.
- The diagnosis-as-reason buttons save nothing new: they only fill the existing `clinicalNote` text on a test order.

## 4. Test status
| Check | Result | Run |
|---|---|---|
| Unit tests | **123 of 123 pass** (104 at the start of this phase, plus 19 new: `fields-doc` 10, `required-fields` 9) | `node --test "tests/*.test.js"` (`node --test tests/` fails on Node 22) |
| Browser, Chromium, in-memory stand-in: **mine** | `registration-check`, `progressive-check`, `required-check`, `order-form-check`, `dosing-rules-check`, `test-request-check`, `followup-check`, `treatment-check`, `prn-correction-check`, `hints-check` all pass | `python3 -m http.server 8765` in the repo root, then `node tests/<name>.js` |
| Browser: Developer 1 and 2 | `encounter-guidance-check`, `browser-check` pass | same |
| **Existing failure, not mine** | `tests/guidelines-browser-check.js` fails ("Everything needed for approval is filled in") **on the untouched zip I was given too** | for Developer 2 / you |
The in-memory stand-in is a small imitation of Firestore. It does **not** run security rules, model offline sync or two devices, or produce real error objects.

## 5. What you must test on real Firebase and a real phone
1. **Follow-up plan:** save a draft, sign, amend, mark entered in error; the stored note has `noteType: "progress"` and the `structured` map. A user without `consult.record` should not see the form; one without `consult.sign` cannot sign.
2. **Close card:** open tests, active treatment and the review date correct for a real visit; closing works with and without a plan.
3. **Friendly errors:** cause a real `permission-denied` (operator without the permission) on registration, a note, an order and a test. The message must be plain. I mapped the usual Firebase error codes but have never seen a real error object.
4. **Offline:** save a follow-up plan, a complaint and a registration in airplane mode; they must sync later; `pc-ux.js` must load offline (it is in `sw.js` v mc-v26, guarded by your test).
5. **Collapsible sections on a real phone:** the "+ More ..." headings are large enough to tap; values typed inside a collapsed section are saved (proven in the stand-in only).
6. **Administration:** Given / Refused / Hold / Not given / Missed, as-needed doses with the interval and daily warnings, and the correction (the original record stays, marked in error, and the dose returns to pending). Giving must write nothing to pharmacy or stock data.
7. **Test request:** the diagnosis and complaint buttons appear and fill the reason; a request with no reason is accepted.
8. **Phones:** 320 px and 390 px on triage, registration, the order form and the close card. The app's floating calculator button overlaps a corner of the time box on the administration screen (not my change).
9. **Existing screens:** repeat the Phase 2 to 4 checks; label, help text and layout changed on `encounter.html`, `patients.html`, `patient.html`, `treatment.html`, `investigations.html`, `laboratory.html`, `dosing-rules.html`, `users.html`.
10. **Operator form** (`users.html`): I only read it. It creates real sign-in accounts, so I could not run it.

## 6. Master plan: what is done and what is not
| Item | Status |
|---|---|
| A. Progressive forms | **Done for five forms** as expandable sections (not multi-step wizards). The order form already shows fields by pattern. Notes, profile, laboratory and administration forms were not changed. |
| A. Plain language, defaults | Done for the main forms (labels, 30 explanation lines). Not every screen reviewed. |
| A. Required/optional clearly shown | **151 of 186 fields** are clear (marked on the box, or stated in the document and under the form heading). **35 are not**: plain notes, merge and sharing, laboratory result entry, administration beyond the reason rule, the hours-after-start and weight-based order patterns, and some filters. |
| B1 Registration | Done. Already has an automatic registration number (`localRegNo`). |
| B2 Triage | Done, including pain score. "Only show fields relevant to the service": **not done by design**. The owner's rule is that facilities are not limited, so every field stays available and the less-used ones are one tap away. |
| B3 Consultation | Existing complaint, earlier medicines, structured examination and notes; extras collapsed. |
| B4 Diagnosis | Done (primary/secondary role, certainty, code). Guideline suggestions are Developer 2's strip. |
| B5 Treatment plan | Medicine and procedure orders are separate; follow-up done. **Consumables:** only a free-text "materials used" box; real stock-linked consumables are Developer 1's integration and are **not done**. |
| B6 Administration | Reviewed and tested, including as-needed and correction. Explanations added. |
| B7 Follow-up | Done for a visit. The "due for review" list is **not done** (see section 3). |
| C. Explanations | Done: `docs/FIELD_EXPLANATIONS.md` (186 fields, kept complete by a test). |
| D. Reuse | Allergy warning in orders, weight reuse, laboratory results in the visit: already existed. **Diagnosis when requesting tests: done.** **Dispensing records in the patient's treatment history: not done.** It needs the rules to let clinicians read `dispense_records`; that is a decision for you and Developer 1. |
| Priority 2: guideline placement | Reviewed: Developer 2's strips sit on triage, consultation, tests, diagnosis, treatment and follow-up, outside the forms I collapsed, and are labelled as reference only. The patient profile and administration screens have none, which seems right. |
| 8. Screenshots | Visit screens (consultation, diagnosis, plan, order, tests, notes), registration, triage, follow-up, administration, mobile and desktop. **Not done:** the patient profile forms, the test catalogue and laboratory. |
| Facility-type workflows | The owner's rule is recorded: facilities choose their services and are not limited. Nothing I built hides a screen or forces a step by facility type. |

## 7. Other open items
- **Laboratory rebuild:** my `FIELD_EXPLANATIONS.md` describes the current laboratory screen. When you rebuild it, `tests/fields-doc.test.js` will fail for new labels; that is the intended safeguard.
- The field document was produced with a helper script that is not in the repository; the test is the safeguard.
- `docs/FIELD_EXPLANATIONS.md` marks the operator-form requirement as "read from the code; not run".

## 8. Suggested lines for `docs/INTEGRATION_CHECKLIST.md`
- [ ] Dev 3: run section 5 above on the test project (follow-up note and rules, friendly errors on a real `permission-denied`, offline, phone layout).
- [ ] Dev 2 / Dev 4: `tests/guidelines-browser-check.js` fails on the original zip.
- [ ] Decide: "patients due for review" list (index or collection)?
- [ ] Decide: let clinicians read `dispense_records` so the treatment history can show dispensing?
- [ ] Developer 1: stock-linked consumables for procedures.
- [ ] Mark required/optional on the remaining 35 fields.

## 9. Applying my work
**The final handover zip alone, applied on top of the zip I was given, is enough.** It contains the latest version of every file I touched. The earlier pass zips are superseded by it.
