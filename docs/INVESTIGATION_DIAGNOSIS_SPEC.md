# INVESTIGATION_DIAGNOSIS_SPEC.md
Phase 3 – Tests (investigations) and diagnoses. Built 2026-11-13. Facility-only data; nothing is deleted.

## Test catalogue (`pc_inv_catalogue`) - menu: Test catalogue
Each facility lists the tests it offers: category (malaria, haematology, biochemistry, urinalysis, pregnancy, microbiology, stool, imaging, other), name, sample type, how the result is written (number with units, one of a list, or free text), optional reference range, optional price, and offered / not offered.
- **Nothing is filled in for you.** Name suggestions only (no prices, units or ranges). A reference range may be saved only with a **source** (for example the analyser manual); prices are only what the facility enters.
- Needs permission "Set up the list of tests, prices and reference ranges". Tests are hidden, never deleted. Past requests keep the name, units, range and price they had when requested.

## Requesting tests (visit > Tests)
A clinician ticks one or more tests, sets priority (routine, urgent, stat) and a reason. Each test becomes its own order (`pc_inv_orders`). Needs "Request tests". A test can be cancelled with a reason until a result is entered.

## Laboratory workflow (menu: Laboratory)
Requested, then Sample collected, then Processing, then Result entered, then Verified, then Reviewed by the doctor. Steps cannot be skipped or done backwards; the security rules enforce the order and who may do each step (permissions: collect, process, enter results, verify, doctor review). Stat first, then urgent, then routine.
- **Results (`pc_inv_results`)** store value, units, reference range and its source (copied at the time), a flag (within / below / above range, abnormal), comments, who entered it and when, who verified it and when. A flag is only a comparison with the reference range the facility entered, never a diagnosis.
- **A result is never overwritten.** If it is wrong, the lab enters a **corrected result**: a new result that points to the old one. The old result stays on record, shown as an earlier result, and the corrected one needs verifying again. A result can also be marked "entered in error" with a reason.
- Pending, not verified, and verified are clearly different in the lab queue and in the doctor's view. The doctor sees "Result entered, NOT yet verified" until it is verified.
- Every step is logged (who, what, when).

## Diagnoses (`pc_diagnoses`) (visit > Diagnosis)
Several per visit. Each has: name (type or choose from earlier ones), optional ICD-10 code (format checked, not looked up), primary or secondary, confirmed / provisional / suspected, what supports it, notes, who recorded it and when. **Changing a diagnosis creates a new version** and marks the old one as replaced; earlier versions stay visible under "Show earlier versions". A diagnosis can be marked "entered in error" with a reason. **The app never suggests a diagnosis and never prescribes from one.** Needs "Record and change diagnoses".

## Closing a visit
If tests have no verified result yet, the app warns before closing; the laboratory can still finish them after the visit is closed.

## Permissions added (Users page)
`investigation.request`, `investigation.review`, `diagnosis.record`, `catalogue.manage`, `lab.collect`, `lab.process`, `lab.result`, `lab.verify`. Quick-fills: Clinician now includes request, review and diagnosis; a new **Laboratory** quick-fill gives collect, process, result and verify.

## Known limits
Verification may be done by the same person who entered the result (small facilities); both names are recorded. No separate imaging reports or images yet. No billing yet (the test price is saved on each order for Phase 7). No result alerts or reminders.
