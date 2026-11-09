# EXISTING_ARCHITECTURE_AUDIT.md
Phase 0 – MediStock Cloud (repo snapshot dated 2026-11-08). No code was changed.

**Scope note:** I read the structure, `mc-core.js`, `sw.js`, `login.js`, `app.html`, and targeted parts of `users.html`, `shops.html`, `sales.html`. Items marked **(verify)** were not confirmed line-by-line and must be checked before Phase 1.

## 1. What the app is
- Plain HTML/JS/CSS, 47 files, **no build step, no package.json, no tests, no firestore.rules, no firebase.json** in the repo.
- Firebase JS SDK 12.19.0 loaded from gstatic CDN (modular). Project `medistock-cloud-93b83`.
- Installable PWA (`manifest.json`, `sw.js` cache `mc-v16`). Manifest orientation is `portrait` (needs review for PC).

## 2. Shell and navigation
- `app.html` is a shell. Each screen (`sales.html`, `inventory.html`...) is loaded as an **iframe**, kept alive in the background (max cap), routed by URL hash.
- `mc-core.js` is loaded once by the shell and hands Firebase + a local store to all iframes.
- `nav.js` provides shared navigation/UI helpers.
- **Consequence:** every new Patient Care page must be added to the `PAGES` list in `sw.js` (offline cache) and to nav, and must follow the iframe/`MC` pattern.

## 3. Authentication and roles (preserve)
- **Owner:** Firebase email/password. Signup creates `businesses/{id}`, `users/{uid}` (`role:"owner"`), first `shops/{id}`.
- **Operator:** Firebase account with synthetic email `op{operatorId}@{shopcode}.medistock.internal`, PIN as password. Created by the owner (`users.html`).
- `users/{uid}`: `businessId, role (owner|operator), shopId, operatorId, name, email, active, createdAt`.
- Only two roles exist. An operator is bound to **one** shop (`shopId`). Owner is business-wide.
- **No granular permission model found** in the files read **(verify in users.html/nav.js)**. The plan's 12 roles and per-restricted-operation permissions are new work.
- Deactivation: `active:false` blocks login; `permission-denied` handling exists in the UI, which implies Firestore rules exist in the console.

## 4. Data model (Firestore, flat top-level collections, tenant key = `businessId`, shop key = `shopId`)
`businesses, shops, users, drugs, batches, receipts, sales, credit_transactions, credit_accounts, suppliers, supplier_transactions, expenses, expense_categories, cash_adjustments, stock_transactions, stock_adjustments`
- `shops` = the facility concept today: `{businessId, ownerUid, name, location, shopCode}`. **No facility type, services, departments or timezone.**
- Customer credit exists (`credit_accounts/transactions`) but is customer-based, not patient/encounter-based.

## 5. Offline architecture
- Firestore `persistentLocalCache` with multi-tab manager, unlimited size. Writes use Firebase's own offline queue.
- `mc-core.js` adds an in-memory store per (collection + business [+ shop]) kept live via `onSnapshot`, with an IndexedDB snapshot (`mc-store-v1`) for fast start. `users` and `businesses` are never cached by this layer.
- Escape hatch: `app.html?nostore=1`.
- Pending-write counts and sync listeners already exist (`stats.pending`, `fireSync`) – reusable for sync-status UI.

## 6. Inventory and stock (reuse)
- `drugs` holds `currentStockBase`; `batches` hold `quantity`, `expiryDate`, cost.
- **FEFO is implemented client-side inside `sales.html`**: sort active batches by expiry (no-expiry sorts last), `writeBatch`, `increment(-take)` on batch and drug, with a fallback for stock with no batch.
- Stock changes are logged in `stock_transactions`.

## 7. Findings against the master plan

| # | Finding | Impact |
|---|---|---|
| 1 | **Firestore rules are not in the repo.** Tenant isolation cannot be verified. | Blocker. Patient data must not go live until rules are in version control and reviewed. |
| 2 | No server-side code (no Cloud Functions). Plan §16 requires server-side permission checks. | Rules can enforce role/facility checks; anything beyond needs Functions (Blaze plan). Decision needed. |
| 3 | FEFO/deduction logic lives inside `sales.html`. | Extract into a shared module before dispensing reuses it, with sales behaviour unchanged. |
| 4 | Deduction uses `writeBatch` + `increment`. Idempotency on retry **(verify)**. | Plan §11.4 needs idempotency keys (e.g. `dispensingId` doc created in the same batch). |
| 5 | Offline conflict handling is Firestore document-level last-write-wins. | Clinical records need append-only / versioned documents (amendments as new docs), otherwise §18.3 cannot be met. |
| 6 | Roles are owner/operator only; operator = one shop. | Needs a roles/permissions extension, and multi-facility operators if required. |
| 7 | `shops` has no type/services/timezone. | Add fields by additive migration (default `type:"drug_shop"`). Existing docs untouched. |
| 8 | Patient data cached unencrypted in IndexedDB/Firestore cache on shared phones. | Privacy risk; mitigate with session timeout, cache-age display, and a policy decision. |
| 9 | Repo holds a stray `reports (1).html`. | Cleanup candidate (not deleted). |
| 10 | No automated tests; development is phone-only. | See §9. |
| 11 | Page list is duplicated in `sw.js` and nav. | Every new screen touches both; bump `VERSION`. |

## 8. Reuse and migration strategy
**Reuse:** auth flow, `MC` core store, `drugs/batches/stock_transactions`, packaging/pricing logic, receipts/credit patterns, backup page, sync indicators.
**Additive migrations only (document each in DATABASE_SCHEMA.md):**
1. `shops`: add `facilityType`, `enabledServices`, `timezone`, `schemaVersion`.
2. `users`: add `roles[]`, `permissions` map, optional `facilityIds[]`; keep `role`/`shopId` working.
3. New collections namespaced `pc_*` (e.g. `pc_patients`, `pc_encounters`) so no clash with existing names. Every doc carries `businessId` (and `facilityId`).
4. New `pc_audit_logs` and `pc_access_logs`, append-only via rules.

## 9. Risk register
| Risk | Severity | Mitigation |
|---|---|---|
| Missing/loose Firestore rules | Critical | Export rules from console into repo, review, add rule tests |
| Breaking sales/stock when extracting FEFO | High | Extract behind identical behaviour, manual regression checklist (plan tests 38–40) |
| LWW overwriting clinical data | High | Append-only versioned clinical docs |
| Cross-facility leakage through global patient ID | High | Separate global identity (minimal) from facility records; consent docs |
| Phone-only development, no test runner | Medium | In-browser test page now; GitHub Actions + Firebase emulator for rules tests |
| Large iframe app + more pages on low-end phones | Medium | Lazy-load Patient Care screens; keep out of CORE preload list |
| Unencrypted local cache | Medium | Policy decision + timeout/lock |

## 10. Decisions (resolved 2026-11-09)
1. Firestore rules supplied (v9) – reviewed in section 12.
2. **Firebase Spark (free) plan → no Cloud Functions.** All enforcement is Firestore rules plus client logic.
3. Facilities may have many operators; each operator works **only in their assigned facility**. This matches today's model (`users.shopId`), so no multi-facility operators are needed.
4. Development is done on the github.com website from a phone. No PC, no local emulator.

## 11. Phase 0 acceptance
This audit documents architecture, reuse, migrations, risks and decisions. It does not authorise Phase 1 implementation; approval is required first.

## 12. Firestore rules review (v9)

**Good (keep):** tenant and shop isolation by `businessId`/`shopId`; operators need `active == true`; operator accounts only via owner invites; default-deny for any collection not listed (new `pc_*` collections stay closed until rules are added, so existing modules cannot break); `audit_log` is create-only.

**Gaps for clinical data**
| # | Gap | Consequence |
|---|---|---|
| R1 | Every operator has full read/update/delete on all shop data. No role or permission checks exist. | A cashier could read or delete clinical records. Patient Care needs per-permission rules on `pc_*`. |
| R2 | `update` rules only check the existing doc, not the new one. | An operator can change `businessId`/`shopId` on update. `pc_*` rules must lock these fields. |
| R3 | No immutability or versioning anywhere. | `pc_*` needs `delete: false`, status-only updates, amendments as new documents. |
| R4 | Rules cannot force a client to write an audit log or access log. | On the free plan these logs are tamper-evident, not tamper-proof. State this honestly in the security spec. |
| R5 | Stock docs (`drugs`, `batches`) stay writable by any operator in the shop. | Dispensing permission can only be enforced on dispensing records, not on stock itself, unless stock rules are tightened later (risk to Sales). |
| R6 | Cross-business patient lookup is risky rules-only (no server, no rate limiting). | Owner decided on cross-business sharing (2026-11-09). Mitigation: hash-ID `get`-only index, minimal response, consent-based clinical grants (PATIENT_MANAGEMENT_SPEC.md section 12). Residual risks documented. |

**Rules-only techniques available:** `getAfter()` to require paired writes in one batch; deterministic document IDs with create-only rules for idempotency (dispensing, administration events, bed allocation); `exists()` on consent documents for consent-based reads; `diff().affectedKeys()` for field locks.

**Free-plan limits to design around:** 50k reads/day, 20k writes/day, 1 GiB. Patient Care screens must NOT join the CORE preload list; load by facility, by recent date, with limits. Rule `get()` lookups also count as reads.

## 13. Deployment workflow (phone only)
- Keep `firestore.rules` in the repo as the source of truth (edit on github.com), then paste into Firebase Console > Firestore > Rules and publish. Test with the Rules Playground in the console.
- Optional later: a GitHub Actions workflow (created via github.com) can run rules unit tests with the Firebase emulator on every commit, giving automated tests without a PC.
