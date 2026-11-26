MediStock Cloud - Developer 3, STAGE 7 (2026-11-26): data-entry limits and glucose device status in the triage form (encounter.html)
Agreement: docs/DATA_CONTRACT_V19.md section 18 (rules v29) and docs/DEV4_DEVICE_STATUS_ENGINE.md. No field was invented. No rules, schema or permission change by me.
Apply AFTER Stages 1-6 and fix1. encounter.html is CUMULATIVE (it contains the earlier treatment-tab work).

SCRIPTS: encounter.html now loads pc-ranges.js and then pc-obs.js (in that order; pc-obs.js needs PCR). Both are ALREADY in the sw.js cache list. The sw.js cache VERSION must still be bumped (Lead) so phones load the new page.

encounter.html - what changed (triage form only; nothing else touched)
  const BOUNDS            glucose removed (its limit depends on the unit)
  NEW GLU_MAX, OBS_NAME, limitProblem(k, val, unit)   one place for every limit message
  triageLine              glucose part only: a stored status is shown with PCO.statusOfRecord(...).line; a number shows as before
  saveTriage              badInput refused; limits per unit; zero/negative refused; diastolic must be BELOW systolic (equal is refused; before, equal was accepted);
                          glucoseUnit saved with a number OR a status; status fields come from PCO.deviceStatus(...).fields; no glucose key, no interp for a status
  NEW handlers (next to the tWeight handler)   unit change, status change
  HTML                    glucose limit hint, "Device reading" select, "Device name (optional)" (max 100), notice line
docs/FIELD_EXPLANATIONS.md  Blood glucose row updated, two rows added (tests/fields-doc.test.js requires them)
Not touched: interpretation, reference ranges, alert rules, prescribing, any other encounter workflow.

BEHAVIOUR DECISIONS (Lead please confirm)
  1. Pain score 0 is SAVED: the approved table says 0 to 10. "Reject zero" is applied to every measurement whose minimum is above zero, and to glucose.
  2. Switching the glucose unit: a number that is invalid in the new unit is CLEARED with a visible message; a number valid in both is KEPT exactly as typed with a message that it was NOT converted.
  3. Choosing a status clears and locks the number box (with a message if a number was there). Unit stays visible and editable.
  4. If pc-obs.js ever failed to load, a status cannot be saved (message), and an old status record still shows a plain fallback line.

TESTS (in-memory stand-in, headless Chromium 390px and 1280px; NOT real Firebase, NOT the rules engine)
  NEW tests/stage7-limits-check.js: 39 records written by the real page; each also run through a JavaScript PORT of the v29 triageOk rule. Run: python3 -m http.server 8765 ; node tests/stage7-limits-check.js docs/screenshots-dev3
  Before/after on the ORIGINAL file: glucose 0, glucose 100 mmol/L and BP 120/120 were all SAVED; the new file refuses all three.
  node --test "tests/*.test.js": 264 of 264.   All 23 earlier browser checks: PASS.   Screenshots: docs/screenshots-dev3/stage7-*.png
NOT RUN: Firestore emulator on v29 (Lead's CI), real Firebase, real phone, real offline then sync, two devices.
  Please have CI create one pc_triage from this page's three shapes: (a) a number with its unit, (b) a status with NO glucose key and glucoseDevice left out, (c) no glucose at all (glucose: null, glucoseUnit: null).
