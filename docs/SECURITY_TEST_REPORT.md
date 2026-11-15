# SECURITY_TEST_REPORT.md
Developer 4. Date: 2026-11-15. **Result: NOT VALIDATED.** The sandbox used for this work has no internet access, so the Firebase Emulator could not be installed or run. Nothing below has been executed against the Firestore rules engine. No security claim should be made from this document yet.

## What was done
| Item | State |
|---|---|
| Rules v15 written (prescriptions, dispense_records, guidelines, DISPENSE stock protection) | Written; brace/paren balance and structural checks pass in `tests/integration.test.js` |
| Emulator tests (`tests-emulator/rules.test.js`, 21 tests) | Written; syntax-checked; **never run** |
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
Run `npm install && npm run test:rules` or push to GitHub. Treat every failure as either a test bug or a rule bug and record the outcome here. Then repeat in the Rules Playground against the real project.
