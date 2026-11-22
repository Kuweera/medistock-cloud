MediStock Cloud - Developer 3, Stage 6 (2026-11-22): consumables on the main inventory (Option B)
Apply AFTER Stages 1-5. encounter.html and pharmacy.html are CUMULATIVE. pc-dispense.js is unchanged here (see Stage 5 zip). Please bump the sw.js cache version.
RULES / SCHEMA / PERMISSIONS: none changed by me. Built to the uploaded firestore_1.rules (v23, CI-green per Lead): C1 order create, pending prescription create, dispenserOrderReadOk.
No new collection, no new permission key. consumable_items / consumable_movements / consumable_bundles and consumables.use / consumables.manage are NOT used by the new flow and nothing was deleted.

Changed: encounter.html (treatment tab only)
  new: openConsumable, closeConsumable, renderCnResults, saveConsumable, isConsItem, stockLine; "Add consumable" button on the plan; card #cnCard
  changed: rxEnding / rxInfo / stopOrder wording and orderHtml (a consumable shows Item and Quantity, a "Consumable" chip, supply status; only "Cancel request" is offered); the click handlers
  fix (Stage 2 gap): the pending prescription of a medicine now also carries qtyUnit (the stock base unit), so the pharmacy shows the unit
Changed: pharmacy.html
  the two order listeners now ask for kind in [medicine, consumable]; chipsOf adds a "Consumable" chip; the visit header counts "items" when a consumable is present;
  the optional "Record consumables used" button inside the dispensing panel is removed (new work must not use the old store); the old consumables card says "Legacy screen"
Changed: docs/FIELD_EXPLANATIONS.md (three rows)
Tests NEW: tests/stage6-consumable-check.js, tests/pharmacy-stage6-check.js, tests/harness-stage6.html
Tests UPDATED: tests/encounter-harness-rx.html (stock items, mirror of v23 consumable rules), tests/harness.html + harness-group.html + harness-stage3.html (the stand-in now understands the Firestore "in" filter), tests/stage5-mode-check.js (course length depends on the clock)
Run: python3 -m http.server 8765 (repo root); node tests/stage6-consumable-check.js ; node tests/pharmacy-stage6-check.js ; node --test tests/
