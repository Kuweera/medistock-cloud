MediStock Cloud - Developer 3, Stage 1: pharmacy prescription grouping (2026-11-21)
Only changed and new files are in this zip. Paths are relative to the repository root.

1. Upload/replace the files at the same paths.
2. No rules, schema, sw.js, nav.js or permission change. No new page or script, so no offline-cache change.

Changed: pharmacy.html
  functions: cardHtml (now one medicine line), renderList (groups rows); CSS .rxgroup / .rxhead
  new functions: visitKey, groupRows, groupHtml
New:     tests/pharmacy-grouping-check.js, tests/harness-group.html,
         docs/screenshots-dev3/stage1-grouping-mobile.png, docs/screenshots-dev3/stage1-grouping-desktop.png

Run the new check:  python3 -m http.server 8765  (repo root), then  node tests/pharmacy-grouping-check.js

Tested (in-memory stand-in, headless Chromium, 390 px and 1280 px): grouping check passes; existing
browser-check, queue-check, registration-check pass; node --test "tests/*.test.js" = 153 of 153.
NOT tested: real Firebase, the emulator, a real phone, offline sync. No data or rules were changed.
