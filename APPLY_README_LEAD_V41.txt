LEAD DELIVERY (2026-11-28): sw.js mc-v41, nav.js, emulator tests v31, contract section 20
Upload these 4 files + this note to GitHub (same paths):
  sw.js                              mc-v41: adds pc-remind.js and treatment-alerts.html to the offline cache
  nav.js                             menu entry "Treatment alerts" (audit.html was already there)
  tests-emulator/rules.test.js       4 new emulator tests (Stage D close, Stage 7 no-glucose triage, Stage 4 acknowledgement permissions). GitHub CI only.
  docs/DATA_CONTRACT_V19.md          new section 20 (R4 decision: no composite index; Stage C/D decisions)
Rules are NOT changed (still v30). After CI: refresh the app twice so mc-v41 replaces mc-v40.
Checked in the sandbox: node --test "tests/*.test.js" = 309 pass, 0 fail; node tests/remind-check.js = phone ok, desktop ok, no page errors.
NOT checked: the 4 new emulator tests have never run (no emulator here).
