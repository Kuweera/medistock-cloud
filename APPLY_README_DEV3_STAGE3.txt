MediStock Cloud - Developer 3, Stage 3 (2026-11-21): pharmacy with pending prescriptions; stopped-after-partial; stock/money/reversal proof
Apply AFTER Stage 1 and Stage 2. pc-dispense.js here is CUMULATIVE (contains the Stage 2 change plus the Stage 3 one-line change). pharmacy.html is cumulative with Stage 1.
Rules / schema / permissions: no change by me. Built against the uploaded firestore.rules (emulator-green per Lead). sw.js: please bump the cache version.

Changed: pharmacy.html
  new: statusOf; new listener rxPending (prescriptions with status pending); rxOf now also returns pending prescriptions
  changed: cardHtml and renderAct (use statusOf; stopped prescriptions explain who/why/how much was dispensed and "Do not dispense the remaining N")
Changed: pc-dispense.js  qtyState: a prescription with qtyUnknown is treated as "no quantity stated"
New tests: tests/pharmacy-stage3-check.js, tests/harness-stage3.html, tests/dispense-stage3.test.js, screenshots stage3-stopped-*.png

Run: python3 -m http.server 8765 (repo root); node tests/pharmacy-stage3-check.js ; node --test tests/
