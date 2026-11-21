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

## Step (f2) – rules v11 and new collections
**Retired:** `pc_patient_consents` (unused; any test documents can be ignored).
**`pc_shares/{patientId}_{sourceFacilityId}_{granteeBusinessId}`**: `businessId, facilityId (source), patientId, granteeBusinessId, granteeBusinessName, granteeFacilityId, granteeFacilityName, sourceBusinessName, sourceFacilityName, purpose, consentMethod (verbal/written), consentGivenBy, patientSnapshot{...}, grantedBy, grantedAt, revokedAt, revokedBy`.
**`pc_directory/{facilityId}`**: `businessId, businessName, facilityId, facilityName, facilityType, district, phone, description, services[], listed, schemaVersion, updatedBy, updatedAt`.
**`pc_patients`**: new optional field `sharedFrom` (the share it was prefilled from).
**Rule changes in v11:** `pc_patients` and `pc_patient_facility_links` readable only by the owning facility (or owner); allergies/history also readable by a facility with a live share; `pc_shares` and `pc_directory` rules added. Everything above the Patient Care section is unchanged from v9.
**Not tested against Firebase.** Syntax and logic reviewed by reading; use the Rules Playground after publishing.

## Phase 2 – collections (rules v12)
All have `businessId, facilityId, schemaVersion, createdBy, createdAt, clientCreatedAt`. Child records also `encounterId, patientId, status (active/entered_in_error), errorReason, recordedBy, recordedByName, recordedAt`.
- `pc_encounters/{id}`: `encId (= id), patientId, patientName/Sex/Dob/DobApprox/DobPrecision (copy for the queue), encounterNo, type, reason, status (open/closed/cancelled), stage (registered/triaged/in_consultation), triageCategory, arrivalAt, arrivalDay, openedBy, openedByName, closedAt, closedBy, closeNote, cancelReason`.
- `pc_triage`: `temperatureC, bpSys, bpDia, pulse, respRate, spo2, weightKg, heightCm, bmi, glucose, glucoseUnit, painScore, consciousness, muacCm, category, notes`.
- `pc_complaints`: `name, onset, durationValue, durationUnit, severity, progression, associated, aggravating, relieving, previousEpisodes, notes`.
- `pc_prior_medications`: `medicineName, strength, dose, frequency, route, duration, lastDose, course, response, reportedBy`.
- `pc_clinical_notes`: `noteType (hpi/examination/assessment/progress/other/amendment), content, structured, authorId, authorName, status (draft/signed/entered_in_error), signedBy, signedByName, signedAt, amends, errorReason`.
- `pc_obs_rules/{facilityId}`: `ranges{field:{min,max}}, source, effectiveDate, version, approvedBy, approvedByName`.
Rules v12 are only added after the existing Patient Care rules. Not yet confirmed against real Firebase.

## Phase 3 - collections (rules v13)
All have `businessId, facilityId, schemaVersion, createdBy, createdAt, clientCreatedAt`.
- `pc_inv_catalogue`: `name, category, specimen, resultType (number/text/choice), choices[], units, refMin, refMax, refText, refSource, price, active`.
- `pc_inv_orders`: `encounterId, patientId, patientName, encounterNo, investigationId, name, category, specimen, resultType, choices, units, refMin, refMax, refText, refSource, price (copies from the catalogue), priority, clinicalNote, status (requested/collected/processing/resulted/verified/reviewed/cancelled), requestedBy/ByName/At/Day, collectedAt/By/ByName, sampleId, processingAt/By/ByName, resultedAt/By/ByName, currentResultId, verifiedAt/By/ByName, reviewedAt/By/ByName, reviewNote, cancelReason, cancelledAt/By/ByName`.
- `pc_inv_results` (first result has the same id as the order): `orderId, encounterId, patientId, testName, value, valueType, unit, refMin, refMax, refText, refSource, flag, comments, resultAt, enteredBy, enteredByName, status (unverified/verified/entered_in_error), amends, verifiedAt/By/ByName, errorReason`.
- `pc_diagnoses`: `encounterId, patientId, name, icd10, role, certainty, findings, notes, authorId, authorName, status (active/superseded/entered_in_error), version, diagKey, supersedes, supersededBy, errorReason`.
Rules v13 are added after the Phase 2 rules and need them. Not yet confirmed against real Firebase.

## Phase 4 - collections (rules v14)
All have `businessId, facilityId, schemaVersion, createdBy, createdAt, clientCreatedAt`.
- `pc_dosing_rules`: `medicineName, version, approvalStatus (draft/approved/retired), source, jurisdiction, effectiveDate, reviewDate, doseUnit, dosePerKg, minDosePerAdmin, maxDosePerAdmin, maxDailyDose, minWeightKg, maxWeightKg, minAgeMonths, maxAgeMonths, allowedRoutes[], pregnancyWarning, paediatricWarning, highRisk, notes, supersedes, approvedBy/ByName/At, retiredReason`.
- `pc_treatment_plans`: `encounterId, patientId, patientName, encounterNo, title, careSetting, priority, startAt, expectedEnd, reviewDate, diagnosisIds[], diagnosisNames[], clinicalNotes, status (active/completed/stopped/cancelled), prescriberId/Name, endedAt/By/ByName, endReason`.
- `pc_treatment_orders`: `planId, encounterId, patientId, patientName, encounterNo, kind (medicine/procedure), version, supersedes, supersededBy, status (active/stopped/completed/superseded), prescriberId/Name, prescribedAt, scheduleType, sched{}, startAt, tz, totalEvents, instructions, warnings[], overrideReason`; medicine: `medicineId, medicineName, generic, formulation, strength, doseValue, doseUnit, route, quantityPrescribed`; procedure: `procedureName, category, materials, responsible, durationMinutes`; weight-based: `ruleId, ruleVersion, ruleSource, weightKg, doseConfirmedBy, doseConfirmedAt`; ended: `endedAt/By/ByName, endReason`.
- `pc_treatment_events/{orderId}_{0000}`: `orderId, idKey, idx, planId, encounterId, patientId, patientName, kind, label, plannedAt, plannedLocal, plannedDay, tz, plannedDoseValue, doseUnit, route, instructions, status (pending/administered/refused/missed/held/not_given/cancelled), lastRecordId, actualAt, actualDoseValue, administeredBy/ByName, cancelReason`.
- `pc_mar_records`: `eventId (null for PRN), orderId, planId, encounterId, patientId, patientName, label, kind, outcome, plannedAt, actualAt, actualDoseValue, doseUnit, route, prescribedDoseValue, reason (PRN), observations, adverseReaction, omissionReason, overrideReason, warnings[], status (active/entered_in_error), errorReason, administeredBy/ByName`.
Rules v14 are added after the Phase 3 rules and need them. Not yet confirmed against real Firebase.

## Laboratory (Developer 4) - rules v18
Existing collections extended; nothing existing was renamed or removed. Old orders without the new fields keep working.
- `pc_inv_catalogue` (new optional fields): `resultType` may now also be `qualitative, semiquant, categorical, multi, titer, organism` (old `number, text, choice` still valid); `choices[]`, `scale[{term, meaning}]`, `titerMode` (numeric|categorical), `params[{key,label,type,unit,refMin,refMax,refText,refSource,choices,scale}]`, `resultCodes[]`, `antibiotics[]`, `organisms[]`, `critical {low, high, values[], source}` (source required), `method, equipment, collection, processing, interpretation`, `approvalStatus` (draft|approved; missing = approved), `approvedBy/ByName/At`. A draft or inactive test cannot be requested (rules).
- `pc_inv_orders` (new optional fields): `profile` (a snapshot of the test setup, so the order is self-contained), status values `received`, `accepted`, `rejected` (added), `receivedAt/By/ByName`, `acceptedAt/By/ByName`, `specimenCondition`, `rejectedAt/By/ByName`, `rejectReason`, `rejectCode`. Path: requested -> collected -> received -> accepted | rejected -> processing -> resulted -> verified -> reviewed. The older collected -> processing step is still allowed.
- `pc_inv_results` (new optional fields): `values` (map: panel parameters, or organisms with susceptibility), `critical` (bool), `criticalWhy[]`, `correctionReason` (required by the rules when a result amends another). `value` always holds a readable summary so older screens still show something.
- `pc_lab_alerts/{resultId}` (NEW): critical-result notice. `orderId, encounterId, patientId, patientName, testName, resultId, resultSummary, why[], status (open|informed|acknowledged), informedBy/ByName/At, informedPerson, informedHow, ackedBy/ByName/At, ackNote`. Created only in the same commit as a result whose `critical` is true. Never deleted.
- `pc_lab_bills/{orderId}` (NEW): one bill per order (document id = order id, so it cannot be billed twice). `orderId, encounterId, patientId, patientName, testName, price, amountPaid, amountOutstanding, amountWaived, status (paid|part_paid|credit|waived|no_charge|reversed), paymentMethod, customerId, customerName, creditTxnId, waiveReason, waivedBy, reverseReason, reversedBy/ByName/At`. Readable only with `lab.payment` or `lab.report`.
- Existing collections written (no schema change): `credit_accounts/dspca_{patientId}` (the same account the pharmacy uses; created if missing, `source: "laboratory"`), `credit_transactions/labct_{orderId}` (`CREDIT_SALE`, no receiptId) and `credit_transactions/labrv_{orderId}` (`LAB_REVERSAL`, negative `balanceChange`). No `receipts` or `sales` are written for lab money, so Sales reports are not double counted.
- New permission keys: `lab.payment`, `lab.report` (Users page also now lists Developer 1's `dispense.reverse`, `consumables.use`, `consumables.manage`).

## v19 - `prescriptions` created as `pending` (PROPOSED, see DATA_CONTRACT_V19.md section 1)
New optional fields: `planId, encounterId, patientName, medicineName, orderVersion, qtyUnknown (bool), qtySetBy ("prescriber"|"pharmacy"), endedBy, endedAt, endReason, supersededBy`. New status values: `pending` (stored at prescribing), `cancelled`, `superseded`. `drugId` and, with `qtyUnknown`, `qtyPrescribed: 0` may be open until first dispensing. Existing documents are unchanged and valid. Rules changed; no page uses the new fields yet.

## v21 (PROPOSED, see DATA_CONTRACT_V19.md section 8)
`pc_patient_corrections/{patientId}_{n}`: `patientId, version, reason, before{}, after{}, correctedBy, businessId, facilityId, schemaVersion, createdBy, createdAt`. Append-only. New optional fields `pc_patients.identityVersion` (int), `pc_shares.snapshotAt` (timestamp), `pc_shares.consentExpiresAt` (timestamp or null).
