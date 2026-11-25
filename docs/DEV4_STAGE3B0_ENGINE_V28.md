# Developer 4 — Stage 3B-0: engine agrees with rules v28 (2026-11-25)

Files changed (4) and added (this note). No database, rules, sw.js or other developers' files touched.
`pc-ranges.js`, `pc-obs.js`, `tests/pc-ranges.test.js`, `tests/pc-obs.test.js`.

## What changed
Checked against the text of the uploaded `firestore.rules` v28 (not against section 17 of the contract: only the rules file reached me).
1. `lactation` stays its own field. A `null` lactation is now refused by `PCR.validate` (the rules refuse it). `reproductive` is refused unless `"any"`.
2. `requireFlags` / `forbidFlags`: at most 10 items. `boundaryNote` / `decisionReason`: text, at most 500 characters.
3. A vital-sign range or alert rule needs an age limit or `allAges: true` (rules v26 line, also in v28). Labs are unaffected.
4. Alert rules (`PCO.ruleErrors`): message 3 to 300 characters (before: up to 500, so 301 to 500 would have been refused by the rules); `urgencyText` at most 300; `contextRequired` at most 5 items; an emergency rule or `level: "critical"` must have `requiresAck: true`; `level` must be screening, moderate or critical.
5. New `PCR.cleanForWrite(doc)`: omits empty `boundaryNote`, `decisionReason`, empty flag lists, null `lactation`, and `reproductive: "any"`. Never writes null. The input object is not changed.
6. New `PCR.approvalStampErrors({reviewerCredential, approvalNote})`: credential 2 to 100 characters, note at most 500 (v27 approval rule).
7. A text-only range (`refText` only) still never produces a numeric flag (`flagAllowed` false). Existing test kept.

## Tests (run here, Node, in-memory only)
`node --test "tests/*.test.js"`: 243 run, 243 pass, 0 fail (was 241). Two test fixtures changed because the stricter rules made them invalid: vital fixtures got `allAges: true`; one alert fixture got a message. Two new tests cover items 1 to 6.
NOT run: Firestore emulator against v28, browser, offline. The CI result for v28 is the Lead's statement; I have not seen it.

## Entry sanity limits (step 2). For owner approval
`pc-obs.js` and `pc-ranges.js` contain NO numeric limits: callers pass them to `PCO.validateEntry`. The only table is `BOUNDS` in `encounter.html` line 583 (Developer 3's file), used at line 707 to refuse a triage save. No source for these numbers is recorded in the code or the repo; I am not inventing one.

| Measurement | Min | Max | Unit stated in code |
|---|---|---|---|
| Temperature (temperatureC) | 25 | 45 | °C |
| Systolic BP (bpSys) | 20 | 300 | mmHg (label only) |
| Diastolic BP (bpDia) | 10 | 200 | mmHg (label only) |
| Pulse | 10 | 300 | /min |
| Breathing rate (respRate) | 2 | 100 | /min |
| SpO2 | 30 | 100 | % |
| Weight (weightKg) | 0.3 | 500 | kg |
| Height (heightCm) | 20 | 260 | cm |
| MUAC (muacCm) | 3 | 60 | cm |
| Glucose | 0 | 1000 | NOT STATED |
| Pain score | 0 | 10 | scale |

Points for the owner:
- Glucose has no unit in `BOUNDS`. 0 to 1000 only makes sense in mg/dL; in mmol/L it would accept impossible values. Needs a unit decision.
- These are entry sanity limits, not reference ranges and not alert thresholds. The owner (or a clinician they name) should approve the numbers and record where they come from.
- `encounters.html` and `patient.html` display vitals but I found no second limits table. Laboratory result entry currently has no numeric limits; 3c will not add any without an approved list.
- Any change to `BOUNDS` is a change request to Developer 3 by name (`BOUNDS`, encounter.html).

## Requests for the Lead (R3)
- `pc-obs.js` and `pc-obs-ui.js` in `sw.js` when a page loads them (page and names will be given on delivery of 3b).
- Stage 4 schema request (reminders, acknowledgements, delivery log) will follow separately; nothing is written yet.

## Known limits
- `ruleErrors` mirrors the rules by hand; the emulator test (rules refuse what the engine accepts, and the reverse) is still to do.
- Approval by a second person is a screen policy (the rules allow `selfApproved` true). 3b will refuse approval by the creator and show `selfApproved` when it is set.

## Apply
Copy the 4 files and this note into the repo at the same paths. Nothing else changes.
