# PATIENT_EDIT_REVIEW.md
Developer 2 · 2026-11-21 · STAGE0 finding S4: rules check `patient.edit`, no page tested it.

## Finding
Before this change no page edited `pc_patients` after registration, so `patient.edit` was checked only by the rules and nothing in the UI could use or enforce it.

## What was done (patient.html only)
- New "Update contact details" button, shown only when `can("patient.edit")` (owner or key), the patient is active and the page is not in shared read-only mode.
- Editable: phone, address, village, district, next of kin, emergency contact. `phoneKey` is recomputed (last 9 digits) so duplicate detection stays correct.
- One batch: update `pc_patients/<id>` (`updatedAt`, `updatedBy` as `pcUpdateStamped` requires; no locked fields) plus an audit entry `patient.edit` listing `changedFields` (names only, not values).
- Phones must be 7-15 digits; "Nothing was changed" is refused.
- Tested: button hidden without the key; cancel writes nothing; invalid and unchanged saves refused; save writes fields, `phoneKey` and one audit entry (tests/profile-check.js).

## Where `patient.edit` applies
| Place | Enforced by |
|---|---|
| `pc_patients` update | Rules (also need registering facility, active status, no locked fields) |
| Contact edit button | UI `can("patient.edit")` + rules |
| Other pages | None use it (not needed) |

## Decisions needed
1. **Identity corrections** (name, sex, date of birth) are deliberately not editable. They affect duplicate matching, shared snapshots and printed records. Propose: a separate, audited "correct identity" action requiring a reason. Needs a decision.
2. **Facility link / registration number** edits are not offered.
3. Shared snapshots go stale after an edit (see SHARED_PATIENT_REVIEW.md gap 1).
