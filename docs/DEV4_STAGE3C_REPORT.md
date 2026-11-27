# Developer 4: Stage 3c report. Reference ranges at laboratory result entry (2026-11-27)

Base: the Lead's slim repo (sw.js mc-v38, rules v29, contract section 18). No rules, schema or `sw.js` change is needed. `PCO.deviceStatus` and `PCO.statusOfRecord` are untouched.

## What changed
At result entry in `laboratory.html` the reference range is chosen by `pc-ranges.js` from the APPROVED ranges of this facility, using the patient's age and sex, pregnancy, breastfeeding, the unit, the specimen, the method and the laboratory. The test's own catalogue range stays as a labelled fallback ("facility setting"). The choice is written once with the result as `refApplied` (contract section 14), one element per number or numeric part.
- No range applies: the screen says "Reference range not configured" (with the reason when there is one), no flag is calculated, and nothing is called normal. Drafts, rejected, retired, replaced and not-yet-effective ranges are never used. Two equally specific approved ranges show a conflict and give no flag. A range in another unit is never used and nothing is converted. A text-only range is shown and gives no flag.
- Pregnancy and breastfeeding are asked at entry only when an approved range of this test depends on them and the patient is not known to be male. "Not stated" is the default and never matches a range that depends on it. The answer is kept in `refApplied` only, never on the patient.
- The flag box is filled from the applied range as the value is typed; the person can still change it (the audit entry records `flagPicked`). Multi-part tests: each numeric part has its own reference line, flag and element; the overall flag is the worst part.
- The reference fields beside a result (`refMin`, `refMax`, `refText`, `refSource`) now show the range that was actually applied, or are empty when none was, so older screens never show a range the engine did not use.
- Verify screen: the stored range is shown as stored. If the situation has changed since entry (a newer version, or a range now exists), a notice is shown. The stored result is never rewritten.
- Results saved before this stage have no `refApplied` and are shown exactly as before. Text, qualitative and other non-numeric tests are untouched.
- Audit entry `lab.result` gains `refStates` and `flagPicked` (audit documents are free-form).

## Files (7): 4 changed, 3 new
CHANGED `laboratory.html` (loads `pc-ranges.js`, which `sw.js` already caches), `pc-lab.js` (`rangeViews`, `applyRanges`, `contextControls`, `staleFor`), `pc-ranges.js` (`describe` also works on a stored element), `docs/FIELD_EXPLANATIONS.md` (the 2 new labels, and the Flag line).
NEW `tests/lab-ranges.test.js`, `tests/lab-ranges-check.js`, `docs/DEV4_STAGE3C_REPORT.md`.

## Tests (in memory only; no Firebase, no security rules)
- `node --test "tests/*.test.js"`: 282 run, 282 pass. New: 12 tests in `tests/lab-ranges.test.js`, including a property test over 4,000 random situations: a flag is never given without an applicable numeric range, and an unavailable or conflicting range never leaves a stored range behind. I also broke the engine on purpose in four ways (a missing range labelled normal, elements for parts with no value, a stale notice never shown, pregnancy asked of males); each was caught.
- Chromium, phone (390x844) and desktop (1280x800), real `laboratory.html`: `node tests/lab-ranges-check.js` passes at both sizes with no page errors and no sideways scroll. Covered: no range; a range arriving while the screen is open; live flag; saved `refApplied`, mirror fields and audit entry; verify screen with stored range; stale notice with the stored result unchanged; pregnancy asked, "not stated" refused, male not asked, nothing written to the patient; catalogue fallback; multi-part test; unreadable patient; old result; qualitative test.
- Still passing: `lab-check.js`, `lab-reports-check.js`, `lab-catalogue-check.js`, `ranges-admin-browser-check.js`.
- NOT run: the Firestore emulator on v29 with a result containing `refApplied`; real Firebase; offline on a device; a slow network; two devices; a screen reader. The stand-in does not apply the rules. By reading the v29 rules, a result create has no key restriction and the update after verification is limited to named keys, so `refApplied` cannot be rewritten later; please have CI confirm with one result document.

## Decisions to confirm
1. `subjectId` of a range = the order's `investigationId` (the catalogue document id); a part uses `paramKey`. Orders made before `investigationId` existed match no context range and use their catalogue range only.
2. `labName` is the facility name. A range that names a laboratory applies only when it matches the facility name as shown.
3. The patient's age and sex are read from `pc_patients` (needs `patient.view`, which the laboratory quick-fill includes). A patient shared from another facility, or one that cannot be read, gives "age/sex unknown": ranges that depend on them are not used, and the screen says so. Save waits for the patient lookup (button "Loading patient details…") and then proceeds even if it failed.
4. The existing screen never showed a numeric reference line on saved results (it reads a field the result does not hold). I left that as is and show the applied range from `refApplied` instead.

## Known limits
- If orders carried the patient's sex and date of birth, shared patients would work without a read. That is a schema request for the Lead and Developer 3 if wanted; not needed for this stage.
- `lab-reports.html` shows no ranges and is unchanged. `encounter.html` result display (Developer 3) can use `PCR.describe(result.refApplied[i])`; the mirror fields already show the applied range.
- Seed ranges (3e) and the guideline links in the visit screen are later stages. No clinical value is in code.

## Next
3d notifications schema request (Stage 4: reminders, acknowledgements, delivery log), then 3e seed proposals.
