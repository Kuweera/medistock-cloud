MediStock Cloud - Developer 3, STAGE D (2026-11-28): close a take-home-only visit from the pharmacy. Apply AFTER Stage C (encounter.html, pharmacy.html and pc-dispense.js are CUMULATIVE). No rules, schema or permission change.

WHAT IT DOES
  Pharmacy page, for users with encounter.close: a "Close visit..." button in the header of a prescription group, shown when everything this page knows about that visit is take-home (a take_home medicine or a consumable). Pressing it makes the REAL check:
  it reads the visit and ALL its active orders (any kind), its draft notes and its tests with no verified result. Then:
   - Every active order is take-home or a consumable (and there is at least one): the card lists each item (fully supplied / partly: N not supplied / not supplied yet), warns about outstanding items, draft notes and unverified tests, and offers an optional closing note and "Close visit".
     The same three questions as the visit page are asked before closing (drafts, tests, then outstanding items); "No" to any of them writes nothing.
   - Anything staff give (a procedure, a facility-given or ward medicine, or an OLDER order with no care mode, which means today's behaviour = given by staff): not closed here; it says which, and "Open the visit" goes to encounter.html?id=<visit>&tab=close.
   - Already closed or cancelled / not found: says so. No patient access (rules refuse the reads): "You need patient access ...". Cannot be read (offline, nothing cached): "could not be checked" with Try again. Nothing is written in any of these cases.
  The close is the NORMAL one: status closed, closedAt, closedBy, closeNote, updatedAt, updatedBy (exactly the keys the rules allow with encounter.close while the visit is open) plus its audit record "encounter.close", in ONE batch.
  Saved like the visit page: closed on this phone at once ("Closed on this phone; it is sent when the connection returns" when offline); if the server later refuses (someone closed it meanwhile, no permission) the visit is open again, a red "NOT SAVED" line and an alert say why, and the button is back.
  Closing does NOT dispense, change stock or money, complete the plan or complete/stop any order (the plan may continue over later visits; undispensed items stay in the pharmacy queue).

ONE SHARED FUNCTION
  pc-dispense.js  NEW PCD.closeVisitWrites(p) (the close and its audit record; writes nothing) and PCD.takeHomeVisit(orders, prescriptionsById) (the decision above; pure, unit tested).
  encounter.html  the visit page's close now calls PCD.closeVisitWrites. Same writes as before (a unit test compares them with a hand copy of the old code; a NEW browser test closes a visit through the page, which had no test). The confirmations and the message are unchanged.
  pharmacy.html   NEW card #clCard, header button, openClose / clGo; a shared stampDoc() (Stage C's inline copy now uses it).

FILES: pc-dispense.js, encounter.html, pharmacy.html, tests/close-visit.test.js (NEW, 10 tests), tests/stageD-close-visit-check.js (NEW), tests/stageC-consumable-pharmacy-check.js (its visit-list assertion no longer assumes exactly three open visits),
  tests/harness-stage6.html (test support: user ?as=pharmclose, take-home visit fixtures V-30..V-36 incl. a procedure, a legacy order, a closed visit, a draft note and tests; batch update with a STAND-IN of the close rule; held batches are now checked against server state), docs/screenshots-dev3/stageD-*.png

EVIDENCE (in-memory stand-in with mirrored rules written from the rules text; headless Chromium 390px; NOT real Firebase, NOT the rules engine)
  The check FAILS on the Stage C pages and passes on the new ones. It covers: the visit page's own close (fields, trimmed note, only allowed keys changed, audit record); no button for users without encounter.close; button only where the page's own view is take-home;
  the happy path (one batch of two documents; fields; audit with the pharmacist's name; stock, stock movements, dispensing records, plan and orders untouched; the card closes; the confirmation; the button disappears at once);
  outstanding items + a draft note + a test with no verified result (a verified test is not counted): the three questions in order, "No" to each of them writes nothing and keeps the card open, "Yes" to all closes; empty note stored as "";
  a procedure the pharmacy does not load -> refused, names it, links to the visit's Close tab; a closed visit; a visit closed by someone else while the card was open -> NOT SAVED, their close is not overwritten, the button is back; server refusal; unreadable (Try again) and no patient access (clear message);
  offline: closed on this phone at once, REFUSED at sync -> open again + told, ACCEPTED at sync -> closed once, one audit record, no alert. 390px: no sideways scroll.
  Unit tests 282/282 (10 new). All earlier browser checks pass (28 with this one).
NOT TESTED: the real rules (please have CI run, as a user with encounter.close and WITHOUT the owner role: a batch of update(pc_encounters: status closed + the five other keys) + set(pc_audit_logs) on an open visit; it must pass, and be refused on a closed one);
  real Firebase, a real phone, real offline sync, two devices.
KNOWN LIMITS: a visit whose older orders have no care mode cannot be closed from the pharmacy (the visit page can); the pharmacy cannot tell from its own data that a visit was closed elsewhere, so the button stays until pressed ("already closed");
  the check needs the visit's data readable (online or cached); the close needs patient.view as well as encounter.close (the reads). Medicines cannot be dispensed or returned from this card (Stage F will offer the visit note after a close).
