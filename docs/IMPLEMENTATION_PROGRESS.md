# IMPLEMENTATION_PROGRESS.md

| Phase | Step | Status |
|---|---|---|
| 0 | Existing application audit | Delivered |
| 1a | (a) Rules v10 + migration notes | Published by the owner (2026-11-09). Playground checks not run |
| 1a | (b) Permissions on Users page + Patient Care switch on Shops page | Delivered, awaiting owner confirmation |
| 1a | (c) Registration + search | **Built and tested on a mock database; awaiting upload and phone test** |
| 1a | (d) Profile, history, allergies | Not started |
| 1a | (e) Duplicate detection | Done inside (c) at registration; post-sync duplicate scan not built |
| 1a | (f) Facility links + consent | Facility links done inside (c); consent not started |
| 1a | (g) Merge | Not started |
| 1a | (h) Regression | Not started |
| 1b | Cross-business sharing | Design only |

## Step (c) files
New: `patients.html`. Changed: `nav.js` (menu item "Patient Care"), `sw.js` (cache version mc-v17, page added to offline list). Docs updated.

## How step (c) was tested
Logic tests (names, phones, ages, duplicate scoring, search) in Node: all passed. Page run in a headless browser against a pretend database: register, search by name/phone/reg number, duplicate warning and forced registration with reason, linking a patient from another facility, operator without permission, shop without Patient Care, refused save. **Not tested against real Firebase or the real security rules.**

## Phone test for step (c)
1. Shops: Patient Care ticked for your shop. Open Menu > Patient Care.
2. Register a test patient (use a made-up name). It appears at once with a number like P-O-1.
3. Search by part of the name, by phone, and by the number.
4. Register the same name and phone again: a warning appears.
5. Turn on airplane mode, register another test patient, turn it off, and check it synced (no red NOT SAVED message).
6. Log in as an operator with and without Patient Care access.
7. Use Sell and Inventory once. Nothing there should change.

Known issues: menu shows Patient Care to every user (the page itself explains missing access); `reports (1).html` stray file; no automated tests in the repo.
