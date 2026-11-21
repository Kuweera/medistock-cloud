MediStock Cloud - Developer 3, Stage 4 (2026-11-21): treatment plan interface
Apply AFTER Stages 1-3. encounter.html here is CUMULATIVE (contains the Stage 2 changes). No rules, schema or permission change. Please bump the sw.js cache version.

Changed: encounter.html (treatment tab only)
  rewritten: orderHtml(o, p)  (was orderHtml(o)); orderTitle removed (was only used by orderHtml)
  new: ordMs, dOnly, orderSpan, rxInfo, expandedOrd; click handler of #planList gets data-oxp (open/close a medicine); renderTreat passes the plan to orderHtml; CSS .ordgrid
Each medicine now shows on the main list: dose, route, frequency, duration, start date, end date, care setting, status, and the pharmacy status.
Stop / Complete / Change / planned times / write next days appear only when the medicine is opened ("Details and actions").
New test: tests/stage4-treatment-ui-check.js (uses tests/encounter-harness-rx.html from the Stage 2 zip); tests/stage2-prescription-check.js updated (it opens the medicine before pressing Stop/Complete/Change); screenshots stage4-treatment-*.png
Run: python3 -m http.server 8765 (repo root); node tests/stage4-treatment-ui-check.js
