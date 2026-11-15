# PHARMACY_DISPENSING_SPEC.md
Phase 5, Developer 1. Status: **built and tested on an in-memory Firestore stand-in. Not run against real Firebase. Not released.**
Owned files: `pharmacy.html`, `pc-dispense.js`, `tests/*`, this document. No existing file was changed (checked by diffing against the supplied zip).

## 1. How the Data Contract was applied
| Contract item | What was built | Why / difference |
|---|---|---|
| `prescriptions` fields (id, patientId, encounterId, drugId, drugName, dose, qtyPrescribed, qtyDispensed, qtyOutstanding, status, createdAt) | All present with those names | Extra fields added (below) |
| `prescriptions.id` | **Equals the id of the medicine order in `pc_treatment_orders`** | One prescription document per order. Makes creation idempotent and needs no change to the treatment form |
| `prescriptions.status` pending / partially_dispensed / completed | Same three values | A document is created **at first dispensing**, so `pending` is never stored. "Waiting" is shown from the order alone. "Cancelled or stopped" is read from the order's own status (`stopped`, `superseded`), not stored here |
| `dispense_records` fields (id, prescriptionId, patientId, drugId, batchId, qtyDispensed, dispensedBy, dispensedAt, isSynced) | All present with those names | **One record per batch used** (id = `{requestId}_{lineNo}`) because the contract has one `batchId` per record |
| `isSynced` | Always `true` on a stored record | Records are only written inside the server transaction. A request still waiting on a phone is NOT a document; it lives in the phone queue and is shown as "Pending sync" |
| `guidelines` | Not used by Developer 1 | |

**Added to both collections (needed by the plan and the rules, additive):** `businessId`, `facilityId`, `schemaVersion`, `createdBy`, `createdAt` (server time), `clientCreatedAt`.
**Extra on `prescriptions`:** `orderId`, `patientName`, `encounterNo`, `planId`, `prescribedName`, `formulation`, `strength`, `route`, `instructions`, `prescriberId/Name`, `prescribedAt`, `qtyUnit`, `qtySetBy` (prescriber|pharmacist), `drugLinkedBy` (prescriber|pharmacist), `orderVersion`, `supersedes`, `firstDispensedAt`, `lastDispensedAt`, `lastDispensedBy`, `lastRequestId`, `updatedBy`, `updatedAt`.
**Extra on `dispense_records`:** `requestId`, `lineNo`, `lines`, `groupQty`, `batchNumber`, `expiryDate`, `drugName`, `qtyUnit`, `patientName`, `encounterId`, `dispensedByName`, `dispensedDay`, `dispensedMonth` (YYYY-MM, used for history queries without a composite index), `stockTxnId`, `source` (online|offline_replay), `batchMode` (fefo|manual), `clientDispensedAt`.

Existing collections touched with their **existing shape only**: `drugs.currentStockBase`, `batches.quantity`, `stock_transactions` (new `type` value `"DISPENSE"`, same fields as `WRITE_OFF`), `pc_audit_logs`. `history.html` and `users.html` ignore unknown stock types (checked), so Sales, Purchases and the activity log are unaffected.

## 2. The dispensing transaction (`PCD.runDispense`, one `runTransaction`)
Reads: first record `{requestId}_0` (duplicate check) → order → prescription → drug → each candidate batch (fresh).
Refuses (plain-language messages in `PCD.FRIENDLY`): order missing / not active / not a medicine / other facility; drug missing, other shop, or different from the one on the order or earlier dispensing; quantity ≤ 0; quantity > outstanding; patient or medicine not confirmed; batch expired / wrong drug / not enough; manual picks not adding up; drug total below the quantity (would go negative); stock with no batch record unless the pharmacist confirmed it.
Writes together: batch quantity(ies), drug `currentStockBase`, one `stock_transactions` doc per batch (`dsp_{requestId}_{n}`), one `dispense_records` doc per batch, the `prescriptions` doc (create or update), one `pc_audit_logs` doc (`dispense_{requestId}`, action `dispense.confirm`).
It **never** writes `pc_treatment_events` or `pc_mar_records` (tested).
Expiry and FEFO rules are copied from `sales.html` (no expiry = never expires, sorted last; expired = excluded). A test loads `daysUntil`/`expiryMs` from `sales.html` and checks they behave identically. **Nothing was extracted from sales.html**, so Sales and Purchases were not touched.

Quantity unit: **the medicine's smallest unit** (e.g. tablets, ml). `quantityPrescribed` on the order has no unit label today; Developer 3 should label that field accordingly.

## 3. Offline behaviour
Firestore transactions need the server, so they cannot run offline. Offline, a confirmed dispensing is stored in a **phone queue** (`localStorage`, key `mcDispQ:{uid}:{facilityId}`) with a fixed `requestId`. It is shown as PENDING SYNC and stock is not reduced. When online it is replayed through the same transaction: success → removed; duplicate (the first try had actually committed) → removed, no second deduction; business-rule failure (stock gone, order stopped, already complete) → kept as "Problem" with a reason; the operator can Try again or Remove (reason required, logged as `dispense.queue_discard`). Queued quantities are subtracted from what can be dispensed on that phone. Two devices cannot silently dispense the same stock: the second transaction re-reads the batches and fails.
Limit to be aware of: the medicine may already have been handed over when a replay fails. The screen says so and the pharmacist in charge must reconcile.

## 4. Requirements for Developer 4 (rules, tests, integration)
**Rules are NOT in `firestore.rules`.** Until they are added, `prescriptions` and `dispense_records` are default-deny and every dispensing will fail with permission-denied. Proposed (untested) rules, to follow the v14 helper style:
- `prescriptions/{id}`: read `canAccessShop && hasPerm('dispense.view')`; create `pcCreateOk && hasPerm('dispense.perform') && id == orderId && qtyDispensed > 0 && qtyDispensed <= qtyPrescribed && qtyOutstanding == qtyPrescribed - qtyDispensed && existsAfter(dispense_records/{lastRequestId}_0)` and the order (get) is `active`, same business and facility, `kind == 'medicine'`; update only `affectedKeys().hasOnly([qtyDispensed, qtyOutstanding, status, lastDispensedAt, lastDispensedBy, lastRequestId, updatedBy, updatedAt])`, `qtyDispensed` must increase, `qtyPrescribed`/`drugId`/`patientId` unchanged, and `existsAfter` the new record; `delete: false`.
- `dispense_records/{id}`: read as above; create `pcCreateOk && hasPerm('dispense.perform') && id == requestId + '_' + lineNo && dispensedBy == auth.uid && dispensedAt == request.time && isSynced == true && qtyDispensed > 0`; `update, delete: false` (append-only).
- `stock_transactions`: today any shop member can update or delete. To protect dispensing entries, deny update/delete when `resource.data.type == 'DISPENSE'`. Check against Sales/Purchases first.
- Known limit (audit finding R5): `drugs` and `batches` stay writable by every shop member, so stock itself cannot be locked to dispensers without risking Sales.
- Reads needed by dispensers: `pc_treatment_orders` (rule `childReadOk` requires `patient.view`), `pc_patient_facility_links`, `pc_allergies`, `drugs`, `batches`. Either give dispensers `patient.view` or add `dispense.view` to those read rules.
- `pcCreateOk` needs the shop to have `patient_care` enabled, so a drug shop without Patient Care cannot use this page.
- Queries used (all equality only, no composite index needed): orders `businessId, facilityId, kind, status`; prescriptions `businessId, facilityId, status`; dispense_records `businessId, facilityId, dispensedMonth`; batches `businessId, shopId, drugId`.
- Tests to run: `node --test tests/dispense.test.js` (28 tests, Node 18+, no installs). `tests/browser-check.js` + `tests/harness.html` drive the page in Chromium against an in-memory database (serve the repo, e.g. `python3 -m http.server 8765`). Emulator rule tests for the collections above still need writing.
- Integration lines (not applied): `nav.js` ITEMS: `["pharmacy.html", "Pharmacy"]`; `sw.js` PAGES: `"pharmacy.html", "pc-dispense.js"` and bump `VERSION`. The page can be opened now through `app.html#pharmacy.html`.

## 5. Requirements for Developer 3
- New permission keys the page checks (owner has all): `dispense.view` (queue and history), `dispense.perform` (confirm dispensing), `dispense.report` (reports). They need adding to `users.html` (and a Pharmacist quick-fill). Until then only the owner can use the page.
- Order form: the "Quantity to supply" field should say it is in the medicine's smallest unit. If left blank the pharmacist must enter a quantity, recorded as `qtySetBy: "pharmacist"`.
- Typed medicines that match no catalogue item get `medicineId: null`; the pharmacist then picks the exact stock item. Making the medicine field a catalogue picker removes that step.
- Do not rename fields read by the pharmacy page: `pc_treatment_orders` (`medicineId, medicineName, formulation, strength, doseValue, doseUnit, route, instructions, quantityPrescribed, status, supersedes, version, encounterNo, patientName, prescribedAt, prescriberName`).

## 6. Known gaps (not built)
- Not tested against real Firebase or the real rules. Not tested on a phone.
- If an order is changed (new version) after part of it was dispensed, the new version starts at zero; the screen warns about earlier dispensing but does not subtract it.
- Reports count what is loaded on the screen ("received" uses active and loaded stopped orders). Large histories may need an index or a summary document.
- The phone queue stores patient name and medicine in `localStorage` until synced (shared-phone privacy; see audit finding 8).
- Pack-level (strip/packet) quantities are displayed but dispensing is entered in the smallest unit.
