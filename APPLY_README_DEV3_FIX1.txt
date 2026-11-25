MediStock Cloud - Developer 3, FIX 1 (2026-11-25): pharmacy queue after Stop/Complete, and offline dispensing safety
Apply AFTER Stages 1-6 (pharmacy.html and pc-dispense.js are CUMULATIVE). No rules, schema or permission change. Please bump the sw.js cache version.

1. STOP / COMPLETE still showing in the pharmacy (cross-module)
   Reproduced with real records: the treatment screen leaves no order active (verified), but pharmacy.html listed a stopped line inside the Waiting tab when another medicine
   of the same visit was still waiting (my Stage 1 grouping showed every loaded line of a visit in every tab), and a plan COMPLETED with nothing dispensed vanished from the
   pharmacy altogether (only stopped/replaced orders were loaded, not the cancelled prescription).
   pharmacy.html: groupHtml / renderList  each tab lists ONLY its own lines; the header still summarises the visit ("3 medicines in this visit: 2 waiting, 1 stopped. Listed here: 2")
                  new ensureCancelledRx, rxCancelled; rxOf and allRows include cancelled prescriptions; the stopped panel says CANCELLED/STOPPED by the prescriber (stopped or completed) with the reason
2. OFFLINE: queued dispensing must count against stock and quantity
   Reproduced: inside the dispensing panel the saved stock and quantity WERE already taken off (second prescription showed 10 of 30 available, confirm disabled). Real gaps fixed:
   - the queue is stored per signed-in user ("mcDispQ:<user>:<facility>"): a second user of the same device did not see the first user's saved dispensing -> now every user of the device counts
   - the queue list row still offered the full outstanding quantity -> it now shows what is saved on this device and the reduced outstanding
   pc-dispense.js: new deviceQueued, reservedByDrug, reservedByOrder (exported on PCD). pharmacy.html: queuedQty, queuedByDrug use them; cardHtml shows the reservation.
   NOT fixable on one device: two DIFFERENT devices both offline cannot see each other. The server re-checks stock and quantity when each queued dispensing syncs; the second one becomes a visible "conflict".
   NOT covered here (protected files): Sales / Inventory on the same device still show the unreduced server stock. They can call PCD.reservedByDrug(localStorage, facilityId, drugId). Lead's decision.
Tests NEW: tests/cross-module-stop-check.js, tests/offline-safety-check.js  UPDATED: tests/pharmacy-grouping-check.js, tests/harness-stage6.html (offline scenario seed)
Run: python3 -m http.server 8765 (repo root); node tests/cross-module-stop-check.js ; node tests/offline-safety-check.js ; node --test tests/
