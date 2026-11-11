# REGRESSION_REPORT.md
Phase 1 (patient management foundation), 2026-11-11. Checks that existing MediStock operations are untouched.

## 1. What was compared
The repository you uploaded on 2026-11-09 (47 files) against the final set delivered through steps (a) to (g).

| Result | Files |
|---|---|
| Identical (byte for byte) | 41 files, including `sales.html`, `purchases.html`, `inventory.html`, `reports.html`, `expenses.html`, `credit.html`, `suppliers.html`, `login.html`, `mc-core.js`, `app.html`, `manifest.json` and every other page not listed below |
| Changed | `nav.js`, `sw.js`, `shops.html`, `users.html` |
| New | `patients.html`, `patient.html`, `directory.html`, `pc-fields.js`, `firestore.rules`, `docs/*.md` |
| Removed | none |

## 2. The four changed files (all small and additive)
- `nav.js`: 2 lines added (menu items Patient Care, Facility Directory). All 22 original menu items kept, in the same order.
- `sw.js`: cache version raised (mc-v16 to mc-v20) and 4 pages added to the offline list. All 42 original cached pages are still listed.
- `shops.html`: the Edit form gets Facility type and a Patient Care tick box. One original line replaced: the shop save now also writes `facilityType`, `enabledServices`, `timezone` next to `name` and `location`. Nothing else in the shop or business records changes.
- `users.html`: 82 lines added, 3 lines modified, all to show a Patient Care access panel on each active operator. Creating, deactivating and resetting operators is unchanged. The panel saves only `perms`, `permsUpdatedAt`, `permsUpdatedBy` on that operator's user record.

## 3. Security rules
The v9 rules you had are included word for word, and the Patient Care rules come after them. A new collection is closed unless a rule opens it, so Sales, Purchases, Inventory and Reports data cannot be reached through the new rules. Rules v11 have **not** been run in the Firebase emulator (not possible from a phone); they are checked only by reading and by the app working with them.

## 4. Checks that were run
- All page scripts in the final repository parse without syntax errors.
- Menu and offline list checks in section 2.
- `users.html` and `shops.html` run in a headless browser against a pretend database: operator list, Patient Care panel, presets, save, shop edit save. No errors, and only the expected fields were written.
- All Patient Care pages run in a headless browser against a pretend database: registration (typed and calendar dates), search, duplicate warning, profile, allergies, history, corrections, sharing and stopping, directory listing, shared view, register-as-ours, duplicate scan, merge, permission hiding, refused-save messages. No errors.
- Name, phone, age, date and duplicate-scoring logic unit-tested.

## 5. NOT checked (be clear about this)
- Nothing was run against your real Firebase project or the published rules.
- Sales, Purchases, Inventory and Reports were not executed. They are unchanged files, so they should behave as before, but only your phone test proves it.
- Behaviour on slow networks, several phones at once, and real offline sync of the new pages.

## 6. Owner phone checklist (about 15 minutes)
1. Sell one item as owner and as an operator; check stock goes down and the receipt prints.
2. Record one purchase; check stock goes up.
3. Open Inventory and Reports; numbers look as before.
4. Create an operator, log in with the PIN, deactivate and reactivate.
5. Switch between shops (owner) and check each shows its own stock.
6. Airplane mode: make one sale, go online, check it syncs.
7. Patient Care: register a patient, add an allergy, share with a facility, merge two test patients (use made-up names).

## 7. Rules Playground checks (Firebase console, optional but useful)
- Operator without perms: read `pc_patients` denied; create `pc_patients` denied.
- Operator of shop B: read a patient registered at shop A denied.
- Any user: delete on any `pc_*` document denied.
- Operator: update `businessId` on a patient denied.
- Receiving facility: read allergies of a shared patient allowed while the share has no `revokedAt`, denied after.

## 8. Known issues and risks
- Operators see only their own facility, so inside a business they can choose a sibling facility only if it is listed in the directory.
- Similar-name duplicate checks work inside one facility only; matching across facilities or businesses is not built.
- No un-merge; no consent expiry.
- Patients load up to 3000 per facility; the free Firebase plan allows 50,000 reads a day, so very large facilities need indexed search later.
- Patient data is cached on the phone unencrypted (a policy decision is still open). Staff should not share phones.
- Audit and access logs are written by the app; the rules cannot force them, so they show tampering but cannot prevent it.
- `reports (1).html` stray file remains in the repository (not removed).
- The repository still has no automated tests.
