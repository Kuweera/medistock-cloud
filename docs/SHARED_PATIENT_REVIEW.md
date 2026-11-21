# SHARED_PATIENT_REVIEW.md
Developer 2 · 2026-11-21 · Brief item 2 (shared patients, consent and origin labelling). Review of what exists; no rules or schema changes.

## What a receiving facility can do today
| Action | Possible? | Where |
|---|---|---|
| Find a shared patient in the main list | Yes. Scope "Shared with us"; also in "All". Search by name, phone, reference number | patients.html |
| See where it came from | Yes. Shared chip, "From <facility> (<business>)", purpose, `Ref <source reg no>` | patients.html, patient.html |
| Read the snapshot (name, sex, age, contact) | Yes, read-only (`?share=<id>`) | patient.html |
| See live allergies and history from the source facility | Yes, read-only | patient.html |
| See the source's visits, diagnoses, treatment, tests | No. Hidden in the page and blocked by rules | – |
| Edit the patient or add allergies/history | No (read-only mode) | – |
| Start a visit | Only after "Register as our patient" (`patients.html?fromShare=`), which creates our own local record linked by `sharedFrom` | patients.html |
| Duplicate protection | Registering checks live shared snapshots too; a share already registered locally is hidden from the Shared list | patients.html |
| Revoked shares | Hidden from lists | patients.html |

## Consent and origin labelling (Master Directive §3)
- Origin is always visible: facility, business, purpose, source reference.
- The purpose is shown as written at grant time. Granting and revoking each write an audit entry (`share.grant`, `share.revoke`), now readable in the audit viewer.
- Local and Shared are different chips and never mixed up in one row.

## Gaps and decisions for the Lead
1. **Stale snapshots.** `patientSnapshot` is copied when the share is granted. If the source later changes contact details (now possible: "Update contact details"), the receiving facility keeps the old copy. Options: re-grant, or a rule/Function to refresh the snapshot. Not built; needs a decision.
2. **No consent expiry or "consent given by" display.** The share has a purpose only. If expiry or the patient's consent record is required, it needs new fields (Lead approval).
3. **Matching is snapshot-only** (as instructed). A shared patient who is also local is only caught by name/phone/DOB scoring, not by identity.
4. **`sourceRegNo`** is a field I add inside the snapshot at grant time; rules only require the snapshot to be a map, so no rules change. Older shares show a short ID instead.
5. **Not tested** against real Firebase rules or two real devices.
