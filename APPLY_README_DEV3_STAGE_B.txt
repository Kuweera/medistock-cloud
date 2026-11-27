MediStock Cloud - Developer 3, STAGE B (2026-11-27): dates on a phone. Apply AFTER the address-links delivery (encounter.html is CUMULATIVE). No rules, schema, permission, sw.js change. pc-fields.js and patients.html NOT touched.

CAUSES (reproduced on the real page at 390px before changing anything)
  1. LAYOUT: the help text of Expected end (pEnd) and Review date (pReview) sat INSIDE the .dateField flex row, between the typing box and the calendar button. The help took 240px of the 324px row: the typing box was 22px wide, so a date could not be typed.
  2. FUTURE DATES: the shared PCF.initDates() sets max = today on every native calendar. A plan's expected end, review date, first dose (obStartDate) and the planned dose dates of a custom schedule are FUTURE dates: those days could not be picked.
     (Typing a future date already worked; on a phone, typing needed the box that cause 1 destroyed.)

CHANGES (encounter.html only)
  - pEnd and pReview: the help text moved OUTSIDE the wrapper (same ids, same words).
  - NEW data-future on the wrapper of pEnd, pReview ("from-today"), obStartDate and every custom-schedule date row ("open"), and NEW function initDates() in the page which calls PCF.initDates() and then removes the max cap
    ("from-today" also sets min = today, refreshed on every calendar tap so a page left open overnight stays right). All 5 calls of PCF.initDates() in this page now go through it, so rows added later are uncapped too.
  - Save of a NEW plan: a typed expected end or review date in the past is refused ("The expected end date cannot be in the past." / "The review date cannot be in the past."), as the follow-up review date already is. Blank stays allowed.
  - Past-only dates are untouched and keep their cap: last dose taken, test dates (itemRow aside), "date this happened" in treatment.html (treatment.html is unchanged: it has no future date field. Correction: I first thought it had pEnd/pReview; it does not).
  - nFuDate (follow-up review date) already worked and is unchanged.
  NEW tests/stageB-dates-check.js (about 40 s). Run: python3 -m http.server 8765 ; node tests/stageB-dates-check.js docs/screenshots-dev3

DECISIONS FOR THE LEAD
  a. First dose and planned dose dates: I lifted the cap only and added NO minimum (typing a past first dose was already accepted; the order form's start defaults to now). Say if you want min = today there.
  b. The typed-past refusal for expected end / review date applies only to the NEW plan form (no prefilled values), so editing an old plan can never be blocked by an old date.
  c. The cap lives in the shared pc-fields.js. I did not edit it. Other pages with future dates (patients.html, Developer 2) have the same cap unless they handle it; the fix there is the same two lines.

EVIDENCE (in-memory stand-in, headless Chromium)
  Reproduction: pEnd/pReview typing box 22px at 390px, max = today on pEnd, pReview, obStartDate (nFuDate max empty, min today).
  The check FAILS on the previous encounter.html (a .dateField holds help text) and passes on the new one. It checks, at 390px: typing box >= 200px and a full date never clipped; button on the same row and inside the screen; help text below; no sideways scroll;
  for pEnd and pReview the calendar gets no cap and min = today, and the browser's own validity says tomorrow, next month, next year and today are selectable and yesterday is not; the chosen day appears as DD/MM/YYYY;
  digits typed one by one become DD/MM/YYYY; a plan saved with a future expected end and review date stores yyyy-mm-dd; past dates and "99/99/9999" are refused and nothing is saved; blank dates stay optional;
  first dose and custom-schedule rows are uncapped (also rows added later) and fit; a first dose typed for tomorrow is saved as a future start; last dose taken stays capped. At 1280px: layout and limits again.
  Unit tests 264/264. All other browser checks pass (stage A and links also re-run and pass; links takes 72 s).
NOT TESTED: the real native calendar popup (headless Chromium cannot show it: the check uses what the button hands to showPicker and the browser's own rangeOverflow/rangeUnderflow, which is what disables days), real phone browsers (iOS Safari, Android Chrome), real Firebase.
