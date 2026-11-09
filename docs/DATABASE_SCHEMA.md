# DATABASE_SCHEMA.md
Patient Care – Phase 1a, step (a). Every migration is additive. No existing document is rewritten.

## M1 – `shops/{shopId}` (set from Shops > Edit; no console editing needed)
| Field | Type | Default if missing |
|---|---|---|
| `enabledServices` | array of strings | `[]` (Patient Care off). Add `"patient_care"` to turn it on |
| `facilityType` | string: `drug_shop`, `pharmacy`, `clinic`, `hospital` | `drug_shop` |
| `timezone` | string | `Africa/Kampala` |

## M2 – `users/{uid}` (set from Users > Patient Care access; operators cannot edit their own)
| Field | Type | Meaning |
|---|---|---|
| `roles` | array of strings | Labels only, e.g. `["nurse"]` |
| `perms` | map of string → true | e.g. `{ "patient.register": true, "patient.view": true }` |

Phase 1a keys: `patient.view`, `patient.register`, `patient.edit`, `history.record`, `allergy.record`, `patient.consent`, `patient.merge`, `audit.view`. Owner has all keys implicitly. Missing `perms` means no Patient Care access.

## M3 – new collections (all prefixed `pc_`, created on first write; no data migration)
Every document has: `businessId, facilityId, createdBy, createdAt (server time), schemaVersion (int)`. Updates add `updatedBy, updatedAt`.

| Collection | Document ID | Key fields |
|---|---|---|
| `pc_patients` | auto-ID | `fullName, nameKey, sex, dob, dobPrecision, estimatedAgeYears, phone, phoneKey, address, village, district, nextOfKin, emergencyContact, guardian, registeredFacilityId, status (active/merged), mergedInto` |
| `pc_patient_facility_links` | `{patientId}_{facilityId}` | `patientId, localRegNo, registeredAt, registeredBy, status` |
| `pc_patient_consents` | `{patientId}_{grantedFacilityId}` | `patientId, grantedFacilityId, purpose, grantedBy, grantedAt, revokedAt, revokedBy` |
| `pc_allergies` | auto-ID | `patientId, substance, reaction, severity, recordedDate, recordedBy, status (active/entered_in_error), errorReason` |
| `pc_medical_history` | auto-ID | `patientId, type, text, onset, status (active/resolved/entered_in_error), supersedes` |
| `pc_patient_merges` | id of the merged-away patient | `mergedId, survivorId, reason, mergedBy, beforeSnapshot` |
| `pc_audit_logs` | auto-ID | `actorUid, action, recordPath, before, after, at` |
| `pc_access_logs` | auto-ID | `actorUid, patientId, purpose, at` |

Notes: `createdAt` must equal server time (stops back-dating). The real event time for offline entries goes in a separate client-time field, for example `clientCreatedAt`.

## Rules (see firestore.rules, v10 PROPOSED)
- The v9 rules are included **unchanged**; the Patient Care section is appended after them. A collection with no rule stays closed.
- No `delete` on any `pc_*` collection.
- Allergies and history can only be marked `entered_in_error` (with a reason) or `resolved`.
- A patient can only become `merged` in the same batch that creates its merge record.
- Consent: a facility may read another facility's allergies/history only while a consent document exists and has no `revokedAt`.
- Known limits: reads cannot be forced to be logged; consent is recorded by staff and cannot be verified by rules.

## How to apply and test (phone, Firebase Console)
1. Open Firestore > Rules and paste the full `firestore.rules` into the editor. **Do not tap Publish yet.** The editor shows any syntax errors, and the Rules Playground tests the rules in the editor before they go live.
2. In Firestore Data, on ONE test shop add `enabledServices: ["patient_care"]`; on ONE test operator add `perms: {patient.view: true, patient.register: true, allergy.record: true}`.
3. Check in the **Rules Playground** (simulate as that operator):
   - Create `pc_patients` with all required fields: **allowed**.
   - Same create using a shop without `patient_care`: **denied**.
   - Same create by an operator with no `perms`: **denied**.
   - Delete any `pc_patients`, `pc_allergies` or `pc_audit_logs` doc: **denied**.
   - Change `businessId` on an existing patient: **denied**.
   - Read another facility's allergy with no consent doc: **denied**; with a live consent doc: **allowed**; after `revokedAt` is set: **denied**.
4. Regression: sign in as owner and as an operator and use Sales, Purchases, Inventory, Reports once. Nothing in them should change.
5. When every check passes, tap Publish.
6. If anything shows `permission-denied` in the existing app, restore the v9 rules from the repo copy immediately.

## Status
Written and reviewed by reading only. **Not yet run against Firebase.** Step (a) is complete only after the Playground checks above pass.

## Step (c) additions (fields now actually written)
`pc_patients` also stores: `registeredFacilityId`, `dobApprox` (date used for matching and for ageing estimated ages), `ageRecordedOn`, `estimatedAge {years, months, days}`, `createdByName`, `clientCreatedAt` (phone time in ms).
`pc_patient_facility_links`: `patientId, localRegNo, registeredAt, registeredBy, status`.
`pc_audit_logs` (actions so far): `patient.register` (with `duplicateOverrideReason`, `duplicateCandidates`), `patient.link`.
No new rules were needed for step (c); the published v10 rules are enough.

## Step (d) additions
`pc_allergies`: `patientId, substance, reaction, severity, recordedDate, recordedBy, recordedByName, status, errorReason`.
`pc_medical_history`: `patientId, type, text, onset (free text), status (active/resolved/entered_in_error), recordedBy, recordedByName, errorReason`.
`pc_access_logs`: `actorUid, actorName, patientId, purpose, at`.
Audit actions added: `allergy.add`, `allergy.error`, `history.add`, `history.resolve`, `history.error`.
No new rules were needed; the published v10 rules cover these writes. Not yet confirmed against real Firebase.

## Step (f) additions
`pc_patient_consents/{patientId}_{grantedFacilityId}`: `patientId, facilityId (source), grantedFacilityId, grantedFacilityName, facilityName (source name), purpose, grantedBy, grantedAt, revokedAt, revokedBy`.
Audit actions added: `consent.grant` (with `consentMethod`, `consentGivenBy`, `purpose`, `granteeFacilityId`), `consent.revoke`.
`pc_access_logs` also gets `sourceFacilityId` when shared records are opened.
No new rules were needed. Not yet confirmed against the real security rules.
