# IMPLEMENTATION_PROGRESS.md

| Phase | Step | Status |
|---|---|---|
| 0 | Existing application audit | Delivered |
| 1a | (a) Rules v10 + migration notes | Published by the owner (2026-11-09). Playground checks not run |
| 1a | (b) Permissions on Users page + Patient Care switch on Shops page | Delivered, awaiting owner confirmation |
| 1a | (c) Registration + search | **Built and tested on a mock database; awaiting upload and phone test** |
| 1a | (d) Profile, history, allergies | **Built and tested on a mock database; awaiting upload and phone test** |
| 1a | (e) Duplicate detection | Done inside (c) at registration; post-sync duplicate scan not built |
| 1a | (f) Facility links + consent | Facility links in (c). **Consent sharing built and tested on a mock database; awaiting upload and phone test** |
| 1a | (g) Merge | Not started |
| 1a | (h) Regression | Not started |
| 1b | Cross-business sharing | Design only |

## Step (f) files
New: `pc-fields.js`. Changed: `patients.html`, `patient.html`, `sw.js` (cache version mc-v19). Docs updated. Upload steps (c) and (d) first if you have not.

## Phone test for step (f)
1. Switch Patient Care on for two shops (Shops > Edit). Register a patient and add an allergy at the first shop (as owner).
2. Profile > Sharing: choose the second shop, purpose, type who agreed, tick the box, Share records.
3. Switch to the second shop (or log in as an operator of it with View patients). Open the same patient: the allergy shows in the banner and in the Allergies tab under 'From ...'.
4. Back at the first shop press Stop sharing: the second shop no longer shows it.
5. Dates: type 5/5/1990 in Date of birth (becomes 05/05/1990), and use the calendar button too.
6. Try typing in Relationship, Village, Allergic to, Reaction: suggestions appear but you can type anything.

## Step (d) files
New: `patient.html`. Changed: `patients.html` (adds the Open profile button), `sw.js` (cache version mc-v18, page added). Docs updated. Upload the step (c) zip first if you have not already.

## Phone test for step (d)
1. Patient Care > tap a patient > Open profile.
2. Allergies tab: save an allergy. A red banner appears at the top. Mark it as entered in error with a reason; the banner goes away and the entry stays under 'Show entries marked as error'.
3. Medical history tab: add an entry, then mark it resolved.
4. Log in as an operator with only View patients: the add forms must not appear.
5. Airplane mode: add an allergy, go online, check there is no red NOT SAVED message.

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
