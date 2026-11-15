# TREATMENT_PLAN_ENGINE_SPEC.md
Phase 4 - Treatment plans and orders. Built 2026-11-14. Facility-only data; nothing is deleted.

## Plans (`pc_treatment_plans`) - visit > Treatment
A plan holds the medicines and procedures for one problem: title, care setting (outpatient, home, inpatient, procedure room), priority, expected end, review date, the diagnoses it treats, clinical notes, prescriber. A patient can have several plans at once, and a plan continues over later visits. Starting a new plan never changes an old one. A plan can be completed or stopped (stopping needs a reason); either cancels all administrations still pending. "Review due" shows when the review date has arrived.

## Orders (`pc_treatment_orders`)
Every medicine or procedure is its own order. A medicine order records the medicine (chosen from this shop's medicine list, so the same medicine catalogue is used and no second list is made; a medicine not in the list can be typed), formulation, strength, dose and unit, route, instructions, optional quantity, the prescriber, and the "how often" schedule (see MEDICATION_SCHEDULING_SPEC.md). A procedure order records the procedure, category, instructions, materials, who does it, duration and schedule.
- **Changing a dose or schedule never edits the old order.** It saves a new version that points to the old one; the old order is marked "replaced", its pending administrations are cancelled, and the reason is recorded. Administrations already given are untouched.
- Stopping or completing an order cancels its pending administrations. Orders are never deleted.

## Clinical safety checks (shown before saving)
- **Allergy warning:** compares the medicine and generic name with the patient's recorded allergies **by name only**. Allergies to a whole group (for example "penicillins") are not detected, and the screen says so.
- **Same-medicine warning:** another active order for the same medicine.
- **Dose, daily total, route and unit checks:** only against a **dosing rule your facility entered and approved** (menu: Dosing rules). With no approved rule the screen says "the dose is NOT checked".
- **Rule texts:** warnings for children, pregnancy/breastfeeding and a high-risk flag are shown only if the facility's rule contains them. A rule past its review date shows a notice.
- Warnings that matter (allergy, duplicate, dose outside a rule) need a written reason before the order can be saved; the warnings and the reason are stored on the order. Hard problems (weight outside what a rule supports, no rule for a weight-based dose) cannot be overridden.
- The app contains **no dosing knowledge and no built-in rules.** It never prescribes and never suggests a medicine.

## Weight-based doses
Only possible when an approved rule with a dose per kg exists for the medicine. The app uses the weight from triage (or one you type), works out the dose, limits it to the rule's maximum per dose, refuses weights or ages outside the rule's range, and shows the rule, its version and source. The clinician must tick that they checked and confirm the dose. The rule version, weight and confirmation are stored on the order.

## Dosing rules (`pc_dosing_rules`) - menu: Dosing rules
Medicine, source (required), country, version, in-force date, review date, dose unit, dose per kg, lowest and highest dose per administration, highest per day, weight range, age range in months, allowed routes, warnings, high-risk flag. Draft, approved or retired; needs permission "Set up and approve dosing rules". A new version is a new record; the highest approved version in force is used. Past versions stay visible.

## Permissions (Users page)
`treatment.prescribe` (plans, orders, changes, stopping), `treatment.administer` (record giving), `mar.amend` (correct wrong records), `rules.manage`. Quick-fills: Nurse adds record giving; Clinician adds prescribing and correcting.

## Known limits
No interaction checking (no validated data is built in). No stock check or dispensing yet (Phase 5). Medicine expiry is not checked here. Pregnancy status is not recorded, so the pregnancy text is shown for every patient who is not recorded as male.
