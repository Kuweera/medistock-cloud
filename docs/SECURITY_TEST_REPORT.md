# SECURITY_TEST_REPORT.md
Developer 4. Date: 2026-11-15. **Result: PASSED in the Firebase Emulator, 2026-11-15 (GitHub Actions run #8): 22 of 22 emulator tests pass, and the 58 offline tests in the `checks` job pass.** Not yet verified against a real Firebase project, so this is not a release approval.

History: run #7 had 2 failures, both mistakes in the tests, not in the rules (a read-back helper that returned nothing, and `firestore()` called twice in one context). Fixed; run #8 is clean.

Known observation: the guidelines `update` rule reports "maximum of 1000 expressions" on requests that are correctly denied. Every request that should succeed (approve, replace a version, retire, discard) passed in run #8, so it is harmless today. Re-check if guideline documents grow large, and watch the Rules Playground in the real project.

## What was done
| Item | State |
|---|---|
| Rules v15 written (prescriptions, dispense_records, guidelines, DISPENSE stock protection) | Written; brace/paren balance and structural checks pass in `tests/integration.test.js` |
| Emulator tests (`tests-emulator/rules.test.js`, 22 tests) | **22/22 pass** (run #8) |
| GitHub Actions (`.github/workflows/ci.yml`) | Written; runs syntax checks, 58 offline tests, then the emulator job |
| Rules v12-v14 | Not re-tested. Three v14 behaviours are included in the emulator file (dosing-rule approval, signed notes, patient isolation) |

## Design of v15
- Facility isolation: every read/write needs `canAccessShop(businessId, facilityId)`; other businesses have no access.
- Roles: `dispense.view` read, `dispense.perform` write, `guidelines.manage` draft, `guidelines.approve` approve/retire.
- Append-only: `dispense_records` update/delete = false; `prescriptions` and `guidelines` delete = false.
- Duplicate prevention: record id = `requestId_lineNo`, so a second submission is an update, which is denied. The transaction also checks `{requestId}_0` before writing.
- Prescription integrity: quantities may only increase, outstanding must equal prescribed minus dispensed, and the change must equal `groupQty` of a dispense record written in the same commit (`existsAfter/getAfter`).
- Protected stock transactions: `type == 'DISPENSE'` entries cannot be updated or deleted, cannot be relabelled from another type, and can only be created with their dispense record.

## Known limits (cannot be fixed in rules)
- `drugs.currentStockBase` and `batches.quantity` are writable by any shop member; a hand edit is not blocked.
- List queries are not filtered: guideline drafts are readable by business members (screen hides them).
- Rules cannot force an audit record to be written.
- Rules read limits (10 document lookups per write) were counted by hand: worst case about 6. The emulator will confirm.

## Required next
Publish rules to a TEST Firebase project and repeat the key checks in the Rules Playground, then do the phone tests in OFFLINE_SYNC_TEST_REPORT.md. Only then consider the real project.
