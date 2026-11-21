MediStock Cloud - Developer 3, Stage 2 (2026-11-21): pending prescription with the order; STOP vs COMPLETE; plan end
Only changed and new files. Paths relative to the repository root. Apply AFTER the Stage 1 zip (pharmacy.html is unchanged here).

BUILT AGAINST: the uploaded firestore.rules (v22 proposed, v19 prescription rules). administrationMode is NOT used in this stage.
RULES / SCHEMA / PERMISSION CHANGES BY ME: none. Needs from Lead: sw.js cache version bump so phones load the new encounter.html and pc-dispense.js.

Changed: encounter.html (treatment tab only)
  changed functions: saveOrder, stopOrder, endPlan, commitOps, click handler of #planList (odone / ostop texts)
  new functions: rxOf, rxDispensed, rxCancellable, rxUpdateOp, rxEnding; new listener on prescriptions (patient scoped, same as plans/orders)
Changed: pc-dispense.js (runDispense only)
  a pending prescription with qtyUnknown uses the pharmacist's stated quantity; the first dispensing sets qtyPrescribed/qtyUnknown/qtySetBy and/or drugId/drugName as the rules allow
New tests: tests/stage2-prescription-check.js, tests/encounter-harness-rx.html (stand-in WITH A MIRROR of the prescription rules), tests/dispense-pending.test.js

Behaviour
  - Saving a medicine order writes prescriptions/{orderId} (status pending) in the SAME batch. Procedure orders write none.
  - STOP: reason required; order stopped; pending prescription cancelled if nothing dispensed; if part was dispensed the prescription is left alone ("stopped, do not dispense"); future doses cancelled. Message starts "STOPPED before the course finished".
  - COMPLETE (one order): its own confirm text and message ("COMPLETED, the course has finished"); does not complete the plan.
  - Plan complete / plan stop: separate confirm and message with counts. Nothing is deleted.
  - Change (new version): old pending prescription becomes superseded, new one is pending; warning if part of the old one was already dispensed.
  - If the server refuses the prescription update (pharmacy started dispensing meanwhile) the order stop is retried without it.

Run: python3 -m http.server 8765 (repo root); node tests/stage2-prescription-check.js ; node --test tests/
