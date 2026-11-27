MediStock Cloud - Developer 3: ADDRESS LINKS (2026-11-26). Apply AFTER Stage 7 and Stage A (encounter.html and pharmacy.html are CUMULATIVE). No rules, schema, permission, sw.js or other-module change.

SUPPORTED ADDRESS FORMATS (for Developer 2)
  encounter.html?id=<visit>&tab=<tab>          <visit> = the same encId the visits list already uses. Parameters may be in any order.
      <tab> is one of:  triage | consultation | notes | tests | diagnosis | treatment | close      (lower case; capitals and spaces are tolerated)
      No tab, an empty tab, or any other value (including consult, dx, treat): the visit opens on its first tab, with no message.
      From the app shell the same query is used:  app.html#encounter.html?id=<visit>&tab=treatment
  pharmacy.html?patient=<patient id or name>
      <patient id> is the patientId stored on the order (matched exactly) - OR part of the patient's name (any case; encode spaces as %20).
      The queue then lists only that patient's prescriptions, on every tab (Waiting, Partially, Fully dispensed, Cancelled). A line "Showing prescriptions for: <value>  [Show everyone]" is shown; the button clears it.
      Not supported: registration number, visit number. No patient parameter: the whole queue, as before.

PERMISSIONS (encounter tab link). The tab opens only if the user holds at least one of the permissions that works in that tab (the same keys the page already uses for that tab's actions; the owner holds all):
      triage -> triage.record | consultation -> consult.record | notes -> consult.record or consult.sign | tests -> investigation.request or investigation.review
      diagnosis -> diagnosis.record | treatment -> treatment.prescribe | close -> encounter.close
  Otherwise the visit opens normally on the first tab and shows: "You do not have permission to use the <Tab> tab, so the visit was opened on the first tab."
  NOTE for the Lead: before this change every tab could be opened by anyone with patient.view (the tabs show read-only data without the action permission). The link rule is stricter than clicking. If you want the link to follow
  patient.view only, it is one line (LINK_TABS in encounter.html). If the user cannot view the visit at all, the page's existing gate message is shown, as before.

CHANGES
  encounter.html  NEW const LINK_TABS and function openTabFromAddress (next to the tab buttons' click handler); called once when the visit has loaded; it clicks the normal tab button. NEW <div id="linkMsg">. Nothing else touched.
  pharmacy.html   NEW patientFilter, matchesPatient (applied in renderList), <div id="pfNote"> with a "Show everyone" button. The text of the address value is escaped (shown as text, never run).
  NEW tests/stageL-links-check.js    Run: python3 -m http.server 8765 ; node tests/stageL-links-check.js docs/screenshots-dev3

EVIDENCE (in-memory stand-in, headless Chromium 390px; NOT real Firebase)
  The check passes on the new pages and fails on the original ones. It covers: every accepted value (owner), exactly one tab shown and selected; no/empty/unknown/odd values (bogus, constructor, __proto__, markup, consult, treat);
  case and spaces; parameter order; a visit that does not exist; a nurse (patient.view, consult.record, consult.sign): consultation and notes open, triage/tests/diagnosis/treatment/close open normally with the message;
  tab buttons still work afterwards; pharmacy by id, by name (part, any case, encoded spaces), unknown patient (empty list, button still there), markup in the value is not run, Show everyone restores the queue.
  Unit tests 264/264. All earlier browser checks pass (26 in total with this one and Stage A).
NOT TESTED: through the real app.html shell (the harness points the iframe at the address, as app.html does), real Firebase, a real phone.
