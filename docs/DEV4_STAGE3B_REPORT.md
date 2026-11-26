# Developer 4: Stage 3B report. Management screen and drafts-only importer (2026-11-26)

## What was built
A second tab, "Reference ranges and alert rules", on `investigations.html` (the Tests tab is unchanged). Logic is in a new, tested file `pc-ranges-admin.js` (global `PCA`); the page only draws and calls it. No clinical value is in code.
- List of ranges or alert rules, filter by status and search, with interval or rule text, context, source (link only if http/https, opens with `noopener noreferrer`), origin, approval label, "Clinician decision needed" for open proposals, reasons.
- Create a draft (range or alert rule), edit a draft, make a new version above an approved one.
- Approve (reviewer credential required, `selfApproved` recorded and labelled, never blocked; the previous approved version is replaced in the SAME batch), reject (reason), retire or discard (reason).
- Importer: drafts only; ids `rr_<key>_v<n>` / `ar_<key>_v<n>`; an id that exists in ANY status is skipped (checked against the loaded list AND the server, item by item; if it cannot be checked, the item is NOT imported); approval fields in a file are refused; `origin: "evidence_proposal"`; original values kept in `proposal`; `reviewRequired: true` is kept in `proposal` (no new field).
- Every write goes through `PCR.cleanForWrite`; every approval through `PCR.approvalStampErrors`. Audit records (`pc_audit_logs`): range/rule create, edit, approve, supersede, reject, retire, and `ranges.import` (counts).

## Files (6): 3 changed or new for the app, 3 for tests and docs
- NEW `pc-ranges-admin.js`
- CHANGED `investigations.html` (new tab, 3 script tags, one `startRanges()` call, `writeBatch` added to the API list)
- CHANGED `docs/FIELD_EXPLANATIONS.md` (additive section for the new labels; the existing test requires it)
- NEW `tests/pc-ranges-admin.test.js`, NEW `tests/ranges-admin-browser-check.js`, NEW `docs/DEV4_STAGE3B_REPORT.md`
`pc-ranges.js`, `pc-obs.js` and their tests are unchanged since DEV4_STAGE3B0_ENGINE_V28.zip.

## For the Lead: sw.js
Page: `investigations.html`. Scripts it now loads: `pc-ranges.js` (already cached), `pc-obs.js`, `pc-ranges-admin.js` (both NEW to the cache list). Raise the cache version. Until then `tests/integration.test.js` "service worker: every local script/page ... is cached" fails (it says `investigations.html uses pc-obs.js but sw.js does not cache it`). That failure is expected and is the only one.

## Tests run (in memory only, no Firebase, no security rules)
- Node: `node --test "tests/*.test.js"` = 257 run, 256 pass, 1 fail (the sw.js test above). The new file `tests/pc-ranges-admin.test.js` has 14 tests, all pass.
- Chromium via Playwright, phone (390x844) and desktop (1280x800): `node tests/ranges-admin-browser-check.js`: both sizes pass, no page errors, no sideways scroll. Covered: vital range refused (decimal comma, no source, no age limit) then saved as draft; approve refused without credential or effective date; self-approval label; edit keeps creator and created time; new version; approving it supersedes the old one in the same commit; lab range with unit prefilled and text-only interval; alert rule (emergency forces acknowledgement, short message refused), reject with reason; import (create, skip existing, refuse approval fields, `javascript:` link not clickable, second import creates nothing); audit entries; Tests tab still opens.
- NOT run: the Firestore emulator against rules v28 with documents written by this screen; real Firebase; offline on a device; two devices; screen reader. The in-memory stand-in does not apply the rules, so "the rules accept these documents" rests on the module mirroring the v28 text, not on a rules run.

## Decisions I took that need confirming
1. `subjectId`: vital = the vital key (`pulse`, `spo2`, ...); `lab_test` = the catalogue document id; `lab_param` = the catalogue document id plus `paramKey` (the catalogue part key). 3c relies on this.
2. Only numeric tests and numeric parts can be chosen for a range.
3. Draft edit writes the whole draft document (so a cleared box is really removed); creator, created time, origin and proposal are carried over.
4. Effective and review dates are typed as YYYY-MM-DD.
5. A draft may be discarded (retired with a reason) by `ranges.manage`; the rules allow it.
6. The importer file format is `{"format":"medistock-range-proposals","formatVersion":1,"proposals":[...]}`, items have `kind` `range` or `alert_rule`, `key`, `version` and the screen's fields; `maxAgeMonthsInclusive` is converted to the exclusive maximum (+1).

## Known limits
- Offline: drafts, edits and approvals queue and sync later. Importing needs the server to confirm that ids do not exist, so an offline import is blocked on purpose.
- Approve uses the list loaded on the phone; the rules' same-key, higher-version check is the backstop if two people act at once.
- No seed file is shipped (that is 3e). No guideline or alert is shown in the visit screen yet (that is 3c and later).
- Device results "below" or "above" the measuring range (owner's glucose note) belong to laboratory result entry (3c). I will propose a documented result status there and ask the Lead whether `pc_inv_results` can already hold it.

## Entry limits (BOUNDS) for the owner. NOT changed, not touched
`encounter.html` line 583, used at line 707. Technical entry limits only, not reference ranges or thresholds. No source is recorded in the code for any of these numbers.

| Measurement | Min | Max | Unit | Status |
|---|---|---|---|---|
| Temperature | 25 | 45 | °C | awaiting owner |
| Systolic BP | 20 | 300 | mmHg (label only) | awaiting owner |
| Diastolic BP | 10 | 200 | mmHg (label only) | awaiting owner |
| Pulse | 10 | 300 | /min | awaiting owner |
| Breathing rate | 2 | 100 | /min | awaiting owner |
| SpO2 | 30 | 100 | % | awaiting owner |
| Weight | 0.3 | 500 | kg | awaiting owner |
| Height | 20 | 260 | cm | awaiting owner |
| MUAC | 3 | 60 | cm | awaiting owner |
| Glucose, mg/dL | above 0 | 1000 | mg/dL | APPROVED by owner |
| Glucose, mmol/L | above 0 | 55.5 | mmol/L | APPROVED by owner (1000 / 18.018 = 55.5) |
| Pain score | 0 | 10 | scale | awaiting owner |

Today `BOUNDS` has one glucose row with no unit; Developer 3 changes it after the Lead coordinates. Zero, negative and over-limit values are refused.
