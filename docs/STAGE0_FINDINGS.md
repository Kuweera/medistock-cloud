# STAGE0_FINDINGS.md
Lead Developer, 2026-11-20. Findings only; no code or rules were changed.

| # | Finding | Evidence | Action (Lead, rules v19) |
|---|---|---|---|
| S1 | The emulator cannot run in the Lead's sandbox: Java is present, but `node_modules`/firebase-tools are missing and npm has no network. Rules remain unverified until the GitHub CI `rules` job (or a test project) runs them. | `npm ping` fails; no `node_modules` | Owner runs CI after v19 is pushed; results go in SECURITY_TEST_REPORT.md |
| S2 | `dispense.report` is enforced **only in the interface** (`pharmacy.html` hides the Reports tab). Rules let any `dispense.view` user read `dispense_bills` and `dispense_records` directly, so billing figures are not actually protected. This is the "hiding a failure behind the interface" pattern the directive forbids. | `pharmacy.html` L794/815; rules L1350-1353 | v19: `dispense_bills` read requires `dispense.report` or `dispense.perform` (cashier role). Check the pharmacy screens that read bills for `dispense.view` only users first |
| S3 | `audit.view` is checked by the rules (L514, L521) but **no screen reads `pc_audit_logs` or `pc_access_logs`**. Audit trails are written everywhere and can never be reviewed in the app. | grep: only writers exist | New small read-only audit screen, owner/`audit.view` only (Dev 2, after contract approval) |
| S4 | `patient.edit` is checked by rules but no page tests it; edit buttons may show or hide on another key. | grep | Verify with a rules test and the patient page (Dev 2) |
| S5 | Order-update rules reach the 1000-expression limit (`pc_inv_orders`, guidelines). Denied cases hit it today; legitimate cases passed in CI run 8. | SECURITY_TEST_REPORT.md | Refactor guidelines update like `orderStepPerm()` in v19; re-run CI |
| S6 (DONE: moved to `tests/archive/`, nothing deleted) | Root `rules.test.js` and `dispense.test.js` are stale copies; `node --test` from the repo root picks them up and fails (missing module). `tests-emulator/rules.test.js` is the real file. CI runs the correct commands, so CI is unaffected. | root run: 2 fails | Owner approval to delete or move to `tests/archive/` (not deleted by the Lead without approval) |
| S7 | `tests/guidelines-browser-check.js` fails on the unmodified original zip too (known to Dev 3/4). | Lead run | Dev 4 fixes or replaces the stale assertion |
