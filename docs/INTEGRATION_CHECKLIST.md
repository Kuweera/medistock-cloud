# INTEGRATION_CHECKLIST.md
Developer 4. Date: 2026-11-15. Legend: [x] done and checked here · [~] written, not yet run against real tooling · [ ] not done.

## A. Data Contract conformance (checked by `tests/integration.test.js`)
- [x] `prescriptions`, `dispense_records`, `guidelines`: every contract field name is written by the code. Extra fields are additive only.
- [x] `mc-core.js`, Sales, Purchases, Inventory, Batches, Suppliers, Expiring, What to Buy, Expenses, Credit, Cash Position, Reports, Backup, Shops are byte-identical to the supplied zip (SHA-256 baseline).
- [x] Pharmacy page never writes `pc_mar_records` or `pc_treatment_events` (dispensing is not administration).
- **Team decision needed:** the contract lists status `pending`. Developer 1 only creates a `prescriptions` document at the first dispensing, so `pending` is never stored (waiting orders are shown from `pc_treatment_orders`). Rules v15 therefore accept only `partially_dispensed` and `completed`. If the team wants stored `pending` documents, Developer 1 and 4 must change this together.
- **Team decision needed:** `dispense_records` has one document per batch used (contract has a single `batchId`). Accepted; `groupQty` ties the lines together.

## B. Integration files (Developer 4 only)
- [x] `nav.js`: Pharmacy and Guidelines added.
- [x] `sw.js`: `pharmacy.html`, `pc-dispense.js`, `guidelines.html`, `pc-guidelines.js`, `pc-ux.js` cached; version mc-v24. A test fails if any page uses a script the service worker does not cache.
- [x] `users.html` (Developer 3) already has `dispense.view/perform/report`, `guidelines.manage/approve` and a Pharmacist quick-fill. Rules v15 use the same keys.
- [x] `firestore.rules` v15: prescriptions, dispense_records (append-only), guidelines, protected DISPENSE stock entries. 22/22 emulator tests pass (CI run #8). Real-project check still pending.
- [x] `docs/IMPLEMENTATION_PROGRESS.md` updated. [ ] `docs/DATABASE_SCHEMA.md`: add the three collections (use PHARMACY_DISPENSING_SPEC section 1 and GUIDELINES_SPEC section 1) - owners to supply final text.

## C. Before anything is released
- [x] `rules` job green (run #8).
- [ ] Publish rules v12-v15 to a **test** Firebase project, repeat the Rules Playground checks.
- [ ] Phase 1-4 phone tests (master plan section 5 gate) - owner.
- [ ] Phase 5 phone tests, two-device stock conflict test, airplane-mode test (see OFFLINE_SYNC_TEST_REPORT.md).
- [ ] Sales, Purchases, Inventory manual regression on the deployed build.

## D. Findings for other developers
1. Dev 1: `node --test tests/` (documented in the spec) fails on Node 22; use `node --test "tests/*.test.js"`.
2. Dev 1: dispensers need `patient.view` to read `pc_treatment_orders` (rule `childReadOk`). The Pharmacist quick-fill includes it; a user given only `dispense.*` will see an empty queue.
3. Dev 1: a shop without Patient Care switched on cannot dispense (`pcFacilityOk`). Drug shops must enable it.
4. Dev 1: `drugs` and `batches` stay writable by any shop member (needed by Sales), so rules cannot stop a manual stock edit that bypasses dispensing. Residual risk, covered only by audit logs and stock-take.
5. Dev 2: a guideline can be edited/approved only by users of the facility that wrote it (rules use the writer's `facilityId`). Cross-facility approval is not possible. Say so in the guide or change the rule.
6. Dev 2: self-approval is allowed and flagged (`selfApproved`). Not forbidden by rules.
7. Dev 3: `pc-ux.js` was missing from the offline cache before this change.
