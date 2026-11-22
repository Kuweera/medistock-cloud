MediStock Cloud - Developer 3, Stage 5 (2026-11-22): administrationMode + attendance; engine accepts consumable orders
Apply AFTER Stages 1-4. encounter.html and pc-dispense.js are CUMULATIVE. Please bump the sw.js cache version.
RULES: I changed none. Built to (a) the v22 administrationMode rule text in the uploaded firestore.rules and (b) rules A1-A5 as written in DEV3_RULES_REQUEST_V23.md.
I have NOT seen the v23 file. Please confirm CI is green for A1-A5 and that a take_home order cannot have events, before this goes live.

Changed: pc-dispense.js  (Lead's C4 correction) three kind checks now accept "consumable": runDispense (not_medicine check), the read probe (kind in [medicine, consumable]), the report filter. Message text updated.
Changed: encounter.html (treatment tab only)
  new: MODE_LABEL, MODE_OPTS, MODE_HELP, defaultMode, fillModeBox, showModeHelp; select #obMode ("How will this treatment be given?")
  changed: openOrder (fills the select), saveOrder (writes administrationMode at creation; take_home creates NO planned doses, totalEvents 0), orderHtml (mode chip, take-home text, arrived / did not attend counts)
  default: inpatient plan = ward chart; outpatient/home plan = take-home (medicine) or given at facility (procedure); procedure room = facility; an OLD plan with no care setting keeps today's behaviour (planned doses, ward chart). Route never decides it.
Changed: treatment.html
  new: modeOf, isFac, isApptEv, overdueAppt, attChip, arrive, undoArrival; new tab "Appointments"
  changed: record (did-not-attend = missed + administration record + attendance in ONE batch), correct (clears attendance when a did-not-attend record is corrected), cardHtml, renderAct, render, renderPrn (take-home PRN orders are not on the ward PRN list)
Changed: docs/FIELD_EXPLANATIONS.md (one row for the new field; tests/fields-doc.test.js requires it)
Tests: NEW tests/stage5-attendance-check.js, tests/stage5-mode-check.js, tests/treatment-harness-att.html (mirror of rules A1-A5), tests/encounter-harness-rx.html (adds a mirror of the mode rules);
       UPDATED tests/dispense-stage3.test.js (consumable engine test), tests/stage4-treatment-ui-check.js (course length depends on the clock time of the first dose)
Run: python3 -m http.server 8765 (repo root); node tests/stage5-attendance-check.js ; node tests/stage5-mode-check.js ; node --test tests/
