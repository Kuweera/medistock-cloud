# PATIENT_MANAGEMENT_SPEC.md
Phase 1 – Patient management foundation. **DRAFT for approval. No code has been written.**

## 1. Scope
Registration, permanent patient identity, search, profile, facility links, medical history, allergies, duplicate detection, controlled merge.
**Out of scope:** encounters/triage (Phase 2), break-glass access (see 9). Cross-business sharing is Phase 1b (section 12).

## 2. Assumptions (change any you disagree with)
- A facility = an existing `shops` document. Patient Care is **off by default** per shop (`enabledServices` contains `patient_care`), so existing shops are untouched.
- **Decision (2026-11-09): patient identity is shared across every business on MediStock Cloud.** Built in two parts: 1a within one business, 1b across businesses (section 12). Clinical data is never shared automatically in either part.
- Demographic identity (name, DOB, sex, phone) is readable by active operators of the same business who hold patient permission, so a patient registered at Facility A can be recognised at Facility B. **Clinical data stays facility-scoped** and is shared only through a recorded consent.
- Owner always has full access. Operators work only in their assigned facility (existing model).

## 3. Permissions (extends `users/{uid}`, additive)
`users/{uid}.roles: string[]` (label only) and `users/{uid}.perms: { [key]: true }`. Owner edits them on the Users page. Existing `role` and `shopId` fields are unchanged.
Phase 1 keys: `patient.register`, `patient.view`, `patient.edit`, `history.record`, `allergy.record`, `patient.merge`, `patient.consent`.
Rules check `perms` server-side; hiding buttons is not relied on. Operators with no perms see nothing new.

## 4. Collections (all prefixed `pc_`; every doc has `businessId, facilityId, schemaVersion, createdAt, createdBy, updatedAt, updatedBy`)

**pc_patients/{patientId}** – identity. `patientId` = Firestore auto-ID (created offline).
`fullName, nameKey, sex, dob, dobPrecision (exact|month|year|estimated), estimatedAgeYears, phone, phoneKey, address, village, district, nextOfKin{name,relationship,phone}, emergencyContact{...}, guardian{...}, registeredFacilityId, status (active|merged), mergedInto`.
`nameKey` = lowercase, accent-stripped, tokens sorted. `phoneKey` = last 9 digits.

**pc_patient_facility_links/{patientId_facilityId}** – deterministic ID prevents duplicate links. `localRegNo, registeredAt, registeredBy, status`.

**pc_allergies/{id}** – `patientId, substance, reaction, severity (mild|moderate|severe|unknown), recordedDate, recordedBy, status (active|entered_in_error)`.

**pc_medical_history/{id}** – `patientId, type (chronic_illness|previous_diagnosis|admission|operation|current_medicine|previous_medicine|family_history|social_history|pregnancy_breastfeeding), text, onset, status, supersedes`.

**pc_patient_consents/{patientId_grantedFacilityId}** – `sourceFacilityId, grantedFacilityId, purpose, grantedBy, grantedAt, revokedAt, revokedBy`.

**pc_patient_merges/{id}** – `survivorId, mergedId, reason, mergedBy, beforeSnapshot{survivor, merged}`.

**pc_audit_logs/{id}** and **pc_access_logs/{id}** – create-only. `actorUid, action, recordPath, before, after, at, purpose`.

## 5. Rules requirements (to be written and reviewed before UI work)
- `delete: false` on all `pc_*`.
- `businessId`, `facilityId`, `patientId`, `createdBy` immutable on update (`diff().affectedKeys()`).
- Allergies/history: updates may only change `status`; edits are new docs with `supersedes`.
- `pc_patients` create requires `patient.register` and `registeredFacilityId == own shop`; update requires `patient.edit`; changing `status` to `merged` only via a merge document in the same batch (`getAfter`) by a user with `patient.merge`.
- Clinical docs readable by own-facility operators with `patient.view`, or by another facility only if the consent doc exists and `revokedAt` is empty.
- Audit/access logs: `actorUid == request.auth.uid`; never updatable.
- Honest limit: rules cannot force a read to be logged. The app logs every profile open, but this is tamper-evident, not tamper-proof.

## 6. Behaviour

**Registration number** – generated on the phone, offline-safe, same approach Sales already uses for receipt numbers (operator ID + own counter). Verify existing counter code before reuse.

**Age** – exact DOB, or estimated age in years, or for infants days/months. Display age in days (<1 month), months (<2 years), years otherwise.

**Search** – prefix queries on `nameKey`, exact on `phoneKey` and `localRegNo`, limited to 20 results. No full patient preload (free-plan read quota).

**Duplicate detection** – at registration, score candidates: same `phoneKey` + similar name, same name + DOB, same guardian + child name. Show candidates; user must open one or confirm "different person" with a reason. Never auto-merge. Offline: checks only the cached patients, shows cache age, and queues a post-sync duplicate scan for review.

**Link to another facility** – search finds the patient in the business; "Register here" creates a link only, with its own local reg no. No clinical data is copied.

**Consent** – source-facility user with `patient.consent` grants a named facility access, with a purpose. Revocation sets `revokedAt`; history is kept.

**Merge** – needs `patient.merge` (owner by default), reason required, shows side-by-side. Writes the merge document and sets the duplicate `status: merged, mergedInto`. Nothing deleted; original IDs and links retained; clinical records keep their original `patientId` and resolve through the `mergedInto` chain. Unmerge is a later feature.

## 7. UI (fits the iframe shell)
- `patients.html` – search, list, Register patient.
- `patient.html?id=` – profile: Overview, Medical history, Allergies (other sections appear in later phases).
- Facility switch for Patient Care in `shops.html` (owner only).
- Nav entry "Patient Care" only when the shop has the service and the user has a perm.
- Add pages to `sw.js` `PAGES`, bump `VERSION`. Mobile-first with large touch targets; two-column layout on wide screens.

## 8. Migrations (all additive)
1. `shops`: add `facilityType` (default `drug_shop`), `enabledServices` (default `[]`), `timezone` (default `Africa/Kampala`).
2. `users`: optional `roles`, `perms`.
3. New `pc_*` rules appended to `firestore.rules`; existing rules unchanged.
No existing document is rewritten.

## 9. Deferred, with reason
- Fuzzy (similar-name) duplicate matching across businesses: impossible without exposing other businesses' patients; only exact-key matching is offered across businesses.
- Cross-business patient merge: needs a platform administrator (see 12).
- Break-glass emergency access: Phase after consent model is proven.
- Encryption of local cache: needs a policy decision; interim mitigation is cache-age display and sign-out clearing.

## 10. Acceptance tests (Phase 1)
Manual on phone and a wide-screen browser, with synthetic patients only:
1. Register a patient (online and offline, then sync).
2. Search by name, phone, reg number.
3. Registering a near-duplicate shows the warning.
4. Link the patient to a second facility of the same business.
5. Operator of Facility B cannot read Facility A allergies/history without consent; can after consent; cannot after revocation.
6. Operator without `patient.register` cannot register (Rules Playground confirms denial).
7. Record, then mark-as-error, an allergy; confirm no delete is possible.
8. Merge two synthetic patients; confirm originals and audit remain.
9. Existing Sales, Purchases, Inventory, Reports unchanged (regression checklist).
Rules tests: add a GitHub Actions + Firebase emulator workflow later (created on github.com).

## 11. Implementation order inside Phase 1
(a) rules + migration docs, (b) permissions on Users page, (c) registration + search, (d) profile + history + allergies, (e) duplicates, (f) links + consent, (g) merge, (h) regression. Each step is delivered and confirmed by you before the next.

## 12. Cross-business sharing (Phase 1b) – proposed design
Goal: the same person is recognised as one patient in every business, without any business seeing another's records.

**What is shared automatically:** only a permanent `globalPatientId` link. **Never automatic:** demographics, allergies, history, any clinical data.

**Collections (new)**
- `pc_global_index/{matchKey}` – document ID is a hash of normalised identifiers (name + DOB + last 9 digits of phone). Stores only `globalPatientId`, `sex`, `birthYear`, `holderCount`.
- `pc_global_holders/{globalPatientId}` – which business/facility holds the patient. Readable only by those holders.
- `pc_share_requests/{id}` – requesting facility, `globalPatientId`, purpose, status.
- `pc_cross_grants/{globalPatientId_requesterFacilityId}` – approval by a holder: scope (e.g. allergies only), expiry, `revokedAt`.
- Clinical docs (`pc_allergies`, `pc_medical_history`) also carry `globalPatientId`.

**Flow**
1. At registration the app computes `matchKey` and does a single `get` on `pc_global_index`. Rules allow `get` but **deny list/query**, so nobody can browse or scrape the index.
2. On a hit the user sees: initials, sex, birth year, "already registered on MediStock". With the patient present, the user confirms identity. The new facility enters its **own** demographics and links to the same `globalPatientId`. Nothing is copied from the other business.
3. To see another business's clinical data, the facility creates a share request. A holder user with `patient.consent` approves (scope + expiry) or declines. Rules then allow reads only while the grant exists, is not expired and not revoked.
4. Every request, grant, revocation and view is logged.

**Rules-only limits (free plan) – accepted risks**
- Existence of a patient can be confirmed by anyone who already knows name + DOB + phone and holds an operator account. The response is deliberately minimal.
- No rate limiting. Guessing is possible but slow and returns little.
- Routing a request to the holder without server code means the requester must be told which facility holds the patient. Recommended: show the facility's name only at request time, after the in-person identity confirmation.
- "Patient consented" is recorded by staff; rules cannot verify it. Audit logs are tamper-evident only.
- Fuzzy duplicate detection stays within a business. Cross-business merges can only be done by a platform administrator (a `platform_admins/{uid}` document you create in the console).

**Legal check before launch:** Uganda's Data Protection and Privacy Act, 2019 and any registration or consent duties for health data; confirm the Firestore region and get qualified legal advice.

**Acceptance (1b):** register in Business A; register the same person in Business B and get the match prompt; B cannot read A's allergies; A approves a scoped grant; B reads them; revoked/expired grant closes access; a third business cannot list or scrape the index; all steps appear in logs.

## 13. Step (c) decisions – registration and search (built 2026-11-09)
- **Loading:** `patients.html` loads the business's patients and facility links into the phone the same way Inventory loads drugs, so search and duplicate checks work offline. Fine for a few thousand patients; at larger sizes it must change to indexed search (needs a Firestore composite index).
- **Why no server-side search now:** a search with a business filter plus a name range needs a composite index created in the console. Avoided for now.
- **Writes:** patient, facility link and audit log are saved as three separate writes, in order. A single batch is NOT used because the security rules check `exists()/get()` against the state before the batch, so a link created in the same batch as its patient would be refused. If a batch is wanted later, the link rule must switch to `existsAfter()/getAfter()`.
- **Registration number:** `P-{operatorId}-{n}` (`P-O-n` for the owner), counter kept on the phone and seeded from existing links, as Sales does for receipts. Two phones signed in as the same operator can produce the same number.
- **Duplicate check:** name (words may differ by one letter only if they start with the same letter, so Okello and Akello stay different), phone, date of birth or birth year, next-of-kin phone. A phone match alone never flags. Strong match needs a typed reason to register anyway. Nothing is merged automatically.
- **Age:** exact date, estimated age (years/months/days, shown with ~), or unknown. Estimated ages keep ageing from the day they were recorded.

## 14. Future usage-based billing (owner note, 2026-11-09)
Billing will depend on facility type (drug shop, clinic, hospital, medical centre) and how many facilities an account has. Hooks already in place: `shops.facilityType`, `shops.enabledServices`. Warning: today the owner can switch services on or off themselves on the Shops page, which would let an account bypass paid services. Before billing starts, service entitlements should move to a field only you (a platform administrator) can write, and the Shops switch should read from it. Counting facilities and enforcing limits also cannot be done reliably with Firestore rules alone on the free plan; decide that when billing is designed.

## 15. Step (d) decisions – profile, medical history, allergies (built 2026-11-09)
- **Page:** `patient.html?id=` opens from "Open profile" on a patient in the list. Tabs: Overview, Medical history, Allergies. A red allergy banner shows at the top when the patient has active allergies recorded at this facility.
- **Facility-scoped:** allergies and history show only what this facility recorded. Records from other facilities stay hidden until the consent feature (step f) is built.
- **Loading:** these lists use direct Firestore queries (not the in-memory store used for patients) because the security rules only allow a facility-filtered query. They still work offline through Firestore's own cache.
- **Corrections:** entries are never deleted or edited. "Entered in error" needs a reason and keeps the entry on record (hidden unless "Show entries marked as error" is tapped). History entries can also be "Marked resolved". To correct a wrong entry, mark it as error and add a new one. A true edit-with-version flow is not built.
- **Logs:** every add, resolve and error writes `pc_audit_logs`. Opening a profile writes `pc_access_logs` (purpose "Viewed patient profile"); a failed access log is silent, a failed audit log is reported.
- **Not in this step:** editing patient details, merge, consent sharing, printing.

## 16. Step (f) decisions – consent sharing between facilities, typed dates, type-or-choose fields (built 2026-11-09)
**Sharing (same business only)**
- Sharing tab on the patient profile. A user with `patient.consent` (the owner always) picks another facility that has Patient Care switched on, says why, who agreed (patient or guardian) and how (said yes / signed), and ticks that the patient agreed. This creates the consent record `pc_patient_consents/{patientId}_{facilityId}`.
- The other facility then sees this facility's **allergies and medical history** (read-only) in its own Allergies and Medical history tabs, and shared allergies appear in the red banner marked "Shared by other facilities". Nothing is copied.
- "Stop sharing" ends access immediately (`revokedAt`). "Share again" re-grants the same record. The history stays in the audit log.
- Who agreed, how, and why are kept in `pc_audit_logs` (the consent record itself only has the purpose, because the published rules limit which fields can change on a re-grant). Every time a facility opens shared records, `pc_access_logs` records it with the purpose.
- **Limitation:** operators can read only their own facility, so only the owner can see the list of other facilities. An operator with sharing permission can stop sharing, but the owner must pick a new facility. Changing this needs a rules change.
- The owner can read all facilities' records under the published rules (owner = full business access); the consent screens control access for operators.
- No expiry date on consents yet.

**Dates:** every date box in Patient Care can be typed (`05/05/1990`, `5/5/1990` or `05051990`) or picked with the calendar button. The slashes appear by themselves. Real dates only, not in the future. Stored as yyyy-mm-dd. Shared code is in `pc-fields.js`. Other screens (Sales, Purchases, Reports...) were not changed.

**Type or choose:** relationship (next of kin, emergency contact), village, district (learned from patients already registered), allergy substance, allergy reaction, sharing purpose and "who agreed" accept typing and also offer a list. Fixed lists (sex, severity, history type, facility) stay as choices only.
