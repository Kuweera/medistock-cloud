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

## v18 (Developer 4, laboratory) - added
Rules changes (all in `firestore.rules`, header note v18): catalogue approval status and critical-limit source; orders may request only active and approved catalogue tests; new order steps received/accepted/rejected with their own permission and field lists; a correction needs `correctionReason`; new `pc_lab_alerts` (only with a critical result in the same commit; acknowledged only with `investigation.review`; no deletes); new `pc_lab_bills` (one per order, amounts must add up to the price, no-charge needs reason and authoriser, reversal needs reason, read only with `lab.payment` or `lab.report`, no deletes); `credit_accounts` get of a MISSING document is now also allowed for `lab.payment` (same narrow fix as dispensers, nothing else changed).
Status: 142 offline file/logic tests pass (`node --test "tests/*.test.js"`).
**First emulator run (GitHub Actions, 2026-11-18, run by the owner): 41 tests, 33 pass, 8 fail.**
- Passed: v18 specimen steps (receive/accept, reject needs a reason), v18 bills (one per order, sums, no-charge reason, reversal reason, lab-only staff cannot read bills, no deletes), v18 credit-account lookup for the cashier.
- Failed, test code (not rules): tests 23 and 30-33 (earlier pharmacy phases) and my v18 tests 38 and 39 built a new Firestore object on every call ("Provided document reference is from a different Firestore instance"; test 23 "Firestore has already been started"). Fix: one Firestore object per user (`db()` now caches). Test 29 did not give the pharmacist `dispense.report`; fixed in the test.
- Found by the run, real: the log shows "maximum of 1000 expressions" for the `pc_inv_orders` update rule. Cause: `hasPerm` was called in each of 12 branches. Fix in v18: the permission for a step is looked up once (`orderStepPerm()`), cancel keeps its own check. Meaning is unchanged (same permission per step).
- **After these fixes the tests were NOT re-run** (the build sandbox has no emulator). Re-run in CI before publishing. The same 1000-expression warning also appears for denied cases of older rules (guidelines, around L1522); those tests pass because the request is denied either way, but a legitimate request in those rules could be at risk and should be reviewed by whoever owns them.
**Second CI run (same day): tests 30 and 33 now pass; 31, 32 and 23 still failed.**
- 31 and 32 (reversal) were a real gap from the pharmacy phase: the reversal first reads `pc_mar_records` to check no dose was given, but a pharmacist with `dispense.reverse` and without `patient.view` could not read them, so every reversal was refused ("mar_unchecked", fail closed). Fix in v18: `pc_mar_records` may also be READ by a user with `dispense.reverse` in the same facility (read only; no write change). This slightly widens who can read administration records; it is the minimum that lets the safety check run.
- 23 ("Firestore has already been started"): **third CI run: 41 of 42 passed; only 23 failed.** Cause found: the test called `c.firestore()` twice on one context. Test code only, fixed (one call kept in a variable). Not re-run.
- Neither fix has been re-run (no emulator in the build sandbox).
Document-lookup counts in the new rules were counted by hand only.
Open: `credit_transactions` creation is shop-scoped only (an existing rule). Lab credit relies on it, as the pharmacy does; it is not permission-checked.

## v19 (Lead Developer, 2026-11-20) - PROPOSED, NOT YET RUN
CI baseline before v19: run #60 ("Add files via upload", seen by the Lead as a screenshot from the owner) had both `checks` and `rules` jobs green on the emulator. Test counts were not visible in the screenshot, so the exact number is unconfirmed.
Rules changes (see header of `firestore.rules`, and `docs/DATA_CONTRACT_V19.md`): pending prescription create by the clinician (same commit as the order), clinician cancel/supersede while nothing is dispensed (same commit as the order stop), pharmacy first dispensing when quantity/drug were left open, clinician READ of `prescriptions` and `dispense_records`, `dispense_bills` read needs `dispense.report`/`dispense.perform`/`dispense.reverse`.
Seven new emulator tests are appended to `tests-emulator/rules.test.js` (all names start "v19:"). **Written without an emulator; the first CI run decides.** If a v19 test fails, check the test fixture before the rule, as happened in the v18 runs. Offline suite: 142 pass. No page uses pending prescriptions yet, so nothing in the app changes until Developer 3 builds on this.

### v19 first CI run (2026-11-20, owner's screenshots): 50 tests, 44 pass, 6 fail. Diagnosis and fixes (Lead)
| Failed | Cause | Fix |
|---|---|---|
| 11, 26, 27 (older read tests) | They asserted a nurse (`treatment.administer`) cannot read prescriptions/records. Owner decision 2 (clinicians may read dispensing) changed that on purpose. **Rule behaved as designed; the tests were out of date.** | Tests now expect nurse = allowed; a receptionist (`patient.view` only) = refused |
| 31, 32 (v17 reversal) | **Real regression caused by v19.** The two new `prescriptions` update rules were evaluated before the reversal rule and used up Firestore's 1000-expression budget (log: "maximum of 1000 expressions" at the update rules). A valid reversal was refused. | Every `prescriptions` update rule now starts with a cheap check that fails fast when the rule does not apply (`status`, `qtyDispensed` direction, substitution reason). Meaning unchanged; five rules edited (marked `v19: cheap check`) |
| 46 (v19 stop/cancel) | Test bug: `ctx.firestore()` called twice in one context ("Firestore has already been started") | One variable per context |
Tests 47-50 (pending first dispensing, clinician reads, bill read, lab ledger) **passed** in this run. The reversal fix is **not yet confirmed**: it needs the next CI run. Expression budget is still tight on `prescriptions`; any new update rule there must start with a cheap check and be re-run in CI.
