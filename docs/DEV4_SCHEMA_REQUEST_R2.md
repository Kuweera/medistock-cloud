# Developer 4 → Lead: request R2 — alert rules, range additions and observation storage

Date: 2026-11-24. Approved in principle by the Master Planner (collections `pc_reference_ranges` and `pc_alert_rules`, shared engine, Option A for the form, reproductive context, observation storage, draft-only importer). **Nothing here has been implemented in any shared file.** Everything below is exactly what the engine in `pc-ranges.js` and `pc-obs.js` (241 tests, all pass) reads, so the rules can match it field for field. The rules, `users.html`, `sw.js`, `DATABASE_SCHEMA.md`, and `triageOk` are yours.

## 1. Changes to `pc_reference_ranges` (v28, additive)
| Field | Type | Meaning / limit |
|---|---|---|
| `lactation` | string | `any`, `lactating`, `not_lactating`. **Absent on old records = `any`**; the rule must not require it |
| `setting` | string ≤ 60 | clinical setting the range applies to (for example stable or emergency care); `""` = any |
| `requireFlags`, `forbidFlags` | list of strings | clinical signs that must be present or absent (names like `emergency_signs`, `^[a-z][a-z0-9_]{1,40}$`, ≤ 10 each); `[]` = none. Absent = `[]` |
| `boundaryNote` | string ≤ 300 | optional text shown when a value is exactly at a limit of the interval |
| `guidelineTitle`, `sourceOrg`, `sourceType`, `sourcePage`, `sourceVersion`, `sourceUrl`, `notes` | strings | source view: the planner's and evidence brief's list (title, organisation, page or section, version, URL, evidence notes). `source` (≥ 3 characters) stays required |
| `allAges` | bool | a vital with no age bounds must carry `allAges: true` (the screen asks the approver to confirm it does not depend on age) |
| `origin` | string | `manual` or `evidence_import` |
| `proposal` | map | **set once at creation by the importer, never changed afterwards:** the original proposed values as imported |
| `decisionReason` | string ≤ 500 | why the reviewer edited, rejected or replaced a proposal |
| `rejectedBy`, `rejectedByName`, `rejectedAt`, `rejectedReason` | | rejection record (reason ≥ 3 characters) |
- **A normal interval becomes optional.** v28's `rrBoundsOk` requires a minimum, a maximum or `refText`. A measurement that has only an alert rule (temperature, for example) would not need an interval. I suggest a range document keeps that requirement, and measurements with no interval simply have no range document.
- **Status values.** The engine treats `draft`, `draft_evidence_based` and `review_required` as "proposals, never used", `approved` as the only active one, and `rejected`, `superseded`, `retired` as ignored. **Recommendation: keep one draft status (`draft`) and add `rejected`**, and use `origin` and `proposal` to say where a draft came from. Several draft statuses behave identically and would triple the rules cases. Your call.
- **Replace `pregnancy` or keep it?** The planner chose independent fields, so `pregnancy` stays as it is and `lactation` is added beside it. A rule for "pregnant or lactating" is written as two rules.
- **Age convention is unchanged:** `minAgeMonths ≤ age < maxAgeMonths`, completed months. The importer converts the planner's inclusive maxima (+1).
- Reviewer actions on a range: approve (as v28), **reject** (new: draft → rejected with reason, by `ranges.approve`), edit a draft and approve (the original stays in `proposal`), replace (new version, supersede as v28), leave unconfigured (nothing to do).

## 2. New collection `pc_alert_rules` (facility-scoped, same lifecycle as ranges)
Document id `ar_{ruleKey}_v{version}`. Stamp as everything else (`pcCreateOk`).
| Field | Type | Rule |
|---|---|---|
| `ruleKey`, `version` | string, int ≥ 1 | id must be `ar_` + ruleKey + `_v` + version |
| `approvalStatus` | string | create: `draft` only. Then approved, rejected, superseded, retired as for ranges |
| `subjectType`, `subjectId`, `paramKey`, `unit` | strings | as ranges (`vital`, `lab_test`, `lab_param`); unit required |
| `ruleType` | string | `screening`, `alert`, `emergency` (the engine maps these to a screening, moderate or critical level) |
| `operator` | string | `lt`, `lte`, `gt`, `gte`, `range` |
| `value` | number | for `lt`, `lte`, `gt`, `gte` |
| `min`, `max` | number | for `range` only: `min ≤ x < max`, and `min < max` |
| `message`, `urgencyText` | strings ≤ 500 | what the reviewer wants shown. The engine adds a neutral line only when these are empty |
| `group` | string ≤ 60 | rules in one group compete: the most specific applicable one is used (for example stable and emergency care) |
| `requiresAck` | bool | optional; always true in effect for `emergency` |
| context | | `sex`, `minAgeMonths`, `maxAgeMonths`, `pregnancy`, `lactation`, `method`, `setting`, `requireFlags`, `forbidFlags` (same definitions and limits as ranges) |
| source and review | | `source` or `sourceTitle` (≥ 3), `sourceOrg`, `sourceType`, `sourcePage`, `sourceVersion`, `sourceUrl`, `notes`, `origin`, `proposal`, `decisionReason`, `effectiveDate` (needed to approve), `reviewDate` |
| approval, supersede, retire, reject | | exactly as in your v28 `pc_reference_ranges` rules |
- **Read:** `canAccessShop` and `patient.view`. **Create and edit a draft:** `ranges.manage`. **Approve, reject, supersede, retire:** `ranges.approve`. **I recommend reusing the two existing keys** rather than adding `alerts.*`, because the same people maintain both. Your call.
- The v28 supersede rule also works here unchanged in structure (same facility, same key, higher version).

## 3. Observation storage on `pc_triage` (additive) and `triageOk`
Today a triage document holds fixed numeric fields and `triageOk` refuses unknown keys. A repeat measurement is simply **another triage document**, so no new collection is needed.
| Field | Type | Meaning |
|---|---|---|
| `interp` | map keyed by measurement key (`pulse`, `spo2`, …) | per measurement, written once at entry, **never updated**: `{ key, value, unit, state, tone, text, referenceLine, rangeId, rangeVersion, alerts: [ {ruleId, version, level, ruleType, group, message, threshold, requiresAck} ], needs: [string], ageMonths, ageBasis, sex, pregnancy, lactation, setting, method, resolvedAt, requiresAck }`. `state` ∈ the ten engine states. The engine returns exactly this as `snapshot` |
| `ctx` | map | context captured: `pregnancy`, `lactation` (`pregnant`/`not_pregnant`, `lactating`/`not_lactating`, or absent), `method`, `setting`, `flags` (map of name → bool), plus form details such as cuff size and position, calm or crying, stable pulse-wave confirmed |
| `ack` | list of maps | `{ key, ruleId, ruleVersion, by, byName, at, note }`: `by` must equal the signed-in user, `at` must be the server time or close to it, `note` ≤ 500. Written with the document |
| `repeatOf` | string | id of the first triage document for a repeat measurement |
- **Rules to enforce:** `interp` and `ctx` and `ack` and `repeatOf` can be set on create only; a triage document is not edited afterwards for these keys. Maps and lists are size-limited (for example ≤ 12 measurements, ≤ 10 alerts each, ≤ 20 acknowledgements).
- **A critical alert cannot be saved unacknowledged:** the screen enforces it; a rule can check that for every `interp[k].alerts[i].requiresAck == true` there is an `ack` entry whose `key` is `k|ruleId`. I suggest you decide whether the rules enforce this or only the screen does.
- **Offline:** the interpretation and the rule id and version are computed on the device at entry and stored in the document, so synchronisation never recomputes them.
- No existing field changes. Older documents have none of these keys and the screens must show them without an interpretation ("recorded before reference rules were configured"), never a recalculated one.

## 4. Emulator cases I would expect (your tests)
Ranges: create with `lactation`, `setting`, flags, `boundaryNote`, `proposal` allowed; invalid `lactation`, a flag name with capitals, more than 10 flags, `boundaryNote` > 300 denied; `proposal` cannot change on update; `reject` needs a reason and `ranges.approve`; a rejected range cannot be approved. Alert rules: every operator with its required fields; `range` with `min ≥ max` denied; `lt` without `value` denied; create only as `draft`; approve, reject, supersede, retire as for ranges; no cross-facility supersede. Triage: `interp`, `ctx`, `ack`, `repeatOf` allowed on create and denied on update; an `ack` whose `by` is another user denied; oversize maps denied; a document without the new keys still passes.

## 5. How the seed will enter (3e), for your information
A JSON importer on the management screen that can only create `draft` documents with `origin: "evidence_import"` and the original values in `proposal`. It never creates an approved rule and never touches an existing approved one (a new proposal for something already approved arrives as a draft version above it). The source-linked draft dataset will be shown to you with the approve, reject and edit workflow before anything is activated, as the evidence brief requires.

## 6. What I need from you
1. Approval of sections 1 to 3 (or changes), especially: one draft status plus `rejected`; reuse of `ranges.manage` and `ranges.approve` for alert rules; `triageOk` changes; whether the rules enforce the critical acknowledgement.
2. `users.html`: no new keys if you agree to reuse.
3. `sw.js`: add `pc-obs.js` (and later `pc-obs-ui.js`) when a page loads them (3b, with `pc-ranges.js`).
4. Confirmation that Developer 3 will mount the component in the triage screen once 3d is ready.
