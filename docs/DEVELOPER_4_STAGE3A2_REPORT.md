# Developer 4 — Stage 3a report: the pure interpretation engine

Date: 2026-11-24. Reported in the separate categories the Master Planner asked for. **Stage 3a is complete as a pure engine with unit tests. The module as a whole is not complete.**

## 1. Unit test results (verified)
- `node --test "tests/*.test.js"`: **241 run, 241 pass, 0 fail** (rules v28 CI reported green by the Lead; `sw.js` mc-v31 in place).
- New or changed: `tests/pc-obs.test.js` (23 tests, the interpretation engine) and `tests/pc-ranges.test.js` (23 tests, the shared range selection, now with lactation, setting and clinical flags).
- **Mutation checks** (I broke the code on purpose and confirmed tests fail): critical alert without acknowledgement; missing range read as normal; unstated context ignored; a range conflict hiding a firing alert; alert band maximum made inclusive; saving without the acknowledgement; pregnancy rule applied to a non-pregnant patient; lactation rule ignored; drafts allowed to alert (two independent guards, so one alone changes nothing and both removed fails).
- A seeded property test of 5,000 random situations asserts: every result is one of the ten states; an alert only ever comes from an approved rule; "normal" only with an approved numeric range and nothing unresolved; invalid is never saveable; a critical alert always needs acknowledgement; the stored snapshot survives a JSON round trip.
- Evidence-brief acceptance scenarios covered at engine level: exactly 11.5 cm uses the configured boundary; exactly 50 breaths/min in the 2 to under 12 months group; exactly 12 months and exactly 72 months each enter one group only (checked for every age 0 to 700 months); pregnancy rules never apply to non-pregnant patients; lactation independent of pregnancy; an unapproved rule never alerts; a rejected proposal never becomes active or reappears; a stored interpretation is unchanged when new rule versions appear. The test numbers for the 11.5 and 50 cases are **test fixtures written in the test file only; nothing is loaded into the app and no value is approved.**

## 2. Integration, Firebase emulator, real database, mobile and desktop, offline and synchronisation: **not done**
- Integration: no screen uses the engine yet (3b to 3d). Nothing integrated.
- Firebase emulator: the new collection and fields have no rules yet. The Lead's CI is reported green for v28, which I have not seen in detail and which does not cover alert rules.
- Real database, mobile and desktop, offline and synchronisation: not tested. The engine is pure and runs without a network by design, but that has not been demonstrated on a device.

## 3. What was built
- `pc-obs.js` (new): `interpret()`, `validateEntry()`, alert-rule evaluation, `makeAck()`, `pendingAcks()`, `canSave()`, `snapshotOf()`, `ruleErrors()`, `sourceView()`.
- States: normal, outside_reference, screening_positive, moderate_alert, critical_alert, invalid, not_configured, context_required, conflict, pending_review.
- `pc-ranges.js` (extended): lactation (independent of pregnancy; old records without it mean "any"), clinical setting, required and forbidden clinical flags, pending versus ignored lifecycle statuses, "not stated" kept distinct from "does not match", one shared `failures()` and `contextOf()` used by ranges and alert rules alike, wording "Reference range not configured".
- No clinical value or clinical message is written anywhere in the code. The only wording is neutral (what a state means).
- `docs/DEV4_SCHEMA_REQUEST_R2.md`: the schema and security request to the Lead (`pc_alert_rules`, range additions, triage storage, review fields).

## 4. Decisions made in the engine that the Planner or Lead should confirm
1. **A tenth state, `screening_positive`.** The Planner's list has no state for a positive screen, and the evidence brief says a screening threshold is not an alert and not every abnormal result is critical. It needs no acknowledgement and is shown amber.
2. **A danger is never hidden.** A firing alert wins over a range conflict, over a disagreement between equally specific alert rules, and over a missing range. Where a rule would fire but needs context that was not stated (for example whether emergency signs are present), the result is `context_required`, shown red when the possible alert is critical, with the sentence saying what it would mean. It does not block saving and does not silently choose the lower threshold.
3. **Missing context makes an observation `context_required`, but the laboratory screens keep the Lead's earlier rule** (a general range still applies when pregnancy is "not stated"). I surface the missing context as a note there. Please confirm that difference is intended.
4. **`pending_review`** is shown when only unapproved proposals exist. It never shows their numbers as if they were in force. A rejected proposal is simply ignored.
5. **Entry limits** (the form's existing `BOUNDS`) stay data-entry checks and produce `invalid`, never an abnormal result. A decimal comma is refused (1,5 could be read as 1500).
6. **Exact boundaries** belong to the configured operator: `lt`, `lte`, `gt`, `gte`, and `range` as minimum inclusive up to maximum exclusive. A value exactly at a limit of a normal interval is normal; an optional `boundaryNote` on the rule adds a caution text, because the evidence brief says exactly 90% SpO2 must not be presented as reassuring without context. That is data on the rule, not logic.

## 5. Known limitations
- Derived or paired measurements (BMI, blood pressure as a pair, growth percentiles) are not interpreted. A rule's age window is how a measurement is limited to an age (for example child MUAC), as the evidence brief says.
- No unit conversion. A rule in another unit never applies.
- Repeat-measurement comparison, the calm-child reminder, the stable pulse-wave confirmation and cuff size and position are form behaviour (3d), not engine behaviour.
- The engine trusts the caller for who is signed in and for the clock; the acknowledgement identity must come from the signed-in user.

## 6. Remaining work (3b to 3f)
3b management screen (ranges and alert rules, review actions approve, reject, edit and approve, replace, leave unconfigured; source view; overlap warnings; draft importer UI). 3c laboratory integration with `refApplied`. 3d `pc-obs-ui.js` and the triage storage, mounted by Developer 3. 3e the corrected, source-linked draft JSON file for review. 3f integration, security, offline and device tests. All blocked or paced by the Lead's approval of `DEV4_SCHEMA_REQUEST_R2.md`.

## 7. Requests to the Lead
See `DEV4_SCHEMA_REQUEST_R2.md` section 6, and `sw.js` for `pc-obs.js`/`pc-ranges.js` when 3b loads them.
