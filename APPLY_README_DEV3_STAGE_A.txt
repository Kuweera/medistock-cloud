MediStock Cloud - Developer 3, STAGE A (2026-11-26): stale pharmacy list and MAR leftovers
Apply AFTER Stage 7. pharmacy.html and treatment.html are CUMULATIVE. No rules, schema, permission or sw.js change. Phones need the sw.js cache version bump (Lead) to load the new pages.

CAUSES (reproduced with real records, see the report)
  A1 pharmacy.html: a row's state comes from its prescription, known only from three live lists. "completed" was loaded lazily (only when "Fully dispensed" is opened). When a prescription completed it left the
     pending list, the page could not see it, queueGroup(order, null) gave "waiting": the row stayed Waiting, and confirm was refused by the server ("This prescription has already been dispensed.").
  A2 treatment.html: renderPlans listed and counted every active order of a plan, with no check of kind or administrationMode.

CHANGES
  pharmacy.html   NEW checkMissingRx, readRx, forgetChecked, refreshOpen, state rxChecked/rxNone/rxTry/rxFirst; rxOf also consults rxChecked; renderList calls forgetChecked first and checkMissingRx last;
                  the three first-snapshot flags are set in the orders, partial and pending listeners; the finished-prescription text now starts "Fully dispensed."
    - An ACTIVE order with no prescription in any loaded list gets ONE check of prescriptions/<orderId> (local cache first: only a terminal answer is trusted from the cache; otherwise the server).
    - completed / cancelled and "no prescription exists" are remembered for the page session: no second read. A live list always wins and clears the remembered answer (a return can reopen a prescription).
    - Nothing is checked before the orders, pending and partial lists have answered once (otherwise every order would be read at startup). At most 120 orders per pass, 8 at a time. A failed check is retried after 30 s.
    - Server unreachable and nothing cached: no error, nothing blocked, the prescription stays dispensable; the server refuses safely at sync (consistent with the G decision).
    - An open dispensing form whose prescription turns out to be completed is replaced by the "Fully dispensed" view: no confirm button.
    - NOT done, on purpose: a recent-window listener on completed prescriptions. A window needs a composite index (businessId, facilityId, status, lastDispensedAt) that firestore.indexes.json does not have, and the per-order
      check is correct without it and reads only orders that need it. If you want the window as well, please add that index and tell me. The lazy "Fully dispensed" tab keeps its existing limit of 300.
  treatment.html  NEW staffGives(o) = kind medicine or procedure AND administrationMode is not take_home. Active plans lists and counts only those and hides a plan with none; the tab count uses the same rule.
                  Plans are NOT hidden by visit status and no plan status is changed (decision of the Lead). Due, PRN and appointments were already correct.
  tests/harness-stage6.html  test support only: read log (window.__reads server, window.__cacheReads cache) and window.__failReads (server unreachable).
  NEW tests/stageA-stale-check.js (runs about 45 s because it waits 31 s for the retry). Run: python3 -m http.server 8765 ; node tests/stageA-stale-check.js docs/screenshots-dev3

EVIDENCE (in-memory stand-in, headless Chromium 390px; NOT real Firebase)
  The check FAILS on the previous pharmacy.html (row stays Waiting) and on the previous treatment.html (4 active orders listed: take-home, consumable), and passes on the new files.
  Unit tests 264/264. All 23 earlier browser checks pass, with the new one 24/24.
  What the check proves: dispensed row leaves Waiting and the tab count drops by one; its panel says Fully dispensed with no confirm; an earlier-completed prescription is found with at most one read, an old order with no
  prescription stays Waiting with exactly one server read, nothing is read again after many re-renders; an open form switches to Fully dispensed; unreachable = still dispensable, no error, checked again once reachable;
  MAR lists only staff-given orders, procedures included, counts them, hides a take-home-and-consumable-only plan, and the tab count matches the list.
NOT TESTED: real Firestore cache behaviour (here the "cache" returns the stored truth), real offline, a real phone, two devices.
KNOWN LIMITS: a form with typed-in values is replaced when its prescription completes elsewhere (nothing is lost: it could not have been confirmed). A completed prescription that was never cached and cannot be reached stays listed
  until reachable. Old orders with no prescription document still cost one server read per page session.
