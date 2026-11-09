# IMPLEMENTATION_PROGRESS.md

| Phase | Step | Status |
|---|---|---|
| 0 | Existing application audit | Delivered, decisions answered |
| 1a | (a) Rules v10 + migration notes | **Published in Firebase by the owner (2026-11-09).** Rules Playground checks not yet run |
| 1a | (b) Permissions on Users page + Patient Care switch on Shops page | **Built, awaiting upload and phone test** |
| 1a | (c) Registration + search | Not started |
| 1a | (d) Profile, history, allergies | Not started |
| 1a | (e) Duplicate detection | Not started |
| 1a | (f) Facility links + consent | Not started |
| 1a | (g) Merge | Not started |
| 1a | (h) Regression | Not started |
| 1b | Cross-business sharing | Design only (PATIENT_MANAGEMENT_SPEC.md section 12) |

## Step (b) details
Changed files: `users.html`, `shops.html`. New files: `firestore.rules` (copy of what is published), `docs/*.md`.
- Users page: each active operator has a "Patient Care access" button with 8 tick boxes and quick-fill (Reception, Nurse, Clinician, Clear all). Saved as `perms` on the operator's `users` document, with `permsUpdatedAt` / `permsUpdatedBy`.
- Shops page (Edit): Facility type and a "Patient Care" switch. Saved as `facilityType`, `enabledServices`, `timezone`. Existing shop fields are untouched.
- No change to Sales, Purchases, Inventory, Reports, login, or the service worker.

## Phone test for step (b)
1. Shops > Edit your shop > tick Patient Care > Save Changes. Reopen Edit: the tick is still there.
2. Users > an operator > Patient Care access > tick two boxes > Save access. Reopen: the same two are ticked, and the card says "2 of 8 permissions".
3. Use Sell, Inventory and Users once as owner and once as an operator. Everything works as before.
4. Operator login still works.

Known issues: rules not yet checked in the Playground; `reports (1).html` stray file; no automated tests exist.
