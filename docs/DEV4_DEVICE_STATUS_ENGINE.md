# Developer 4: device result outside the measuring range. Engine side (2026-11-26)

Agreement: `docs/DATA_CONTRACT_V19.md` section 18 (rules v29). Nothing here goes beyond it. Not changed: reference ranges, alert rules, `BOUNDS`, `encounter.html`, `firestore.rules`, `sw.js`.

## What is in `pc-obs.js` (global `PCO`)
- `PCO.deviceStatus({ key, status, unit, device, raw })` builds and checks a status. `key` is `"glucose"` (the only enabled measurement). `raw` is the number box, which must be blank.
- `PCO.interpret({... status: "below_device_range" })` never interprets a status: it returns the same answer as `deviceStatus`.
- `PCO.statusOfRecord(record, "glucose")` reads a stored triage record for history, summary and print: `null` for an ordinary record, otherwise `{ status, unit, device, text, line }`. `line` is the short wording for `triageLine`.
- `PCO.STATUS_VALUES` = `below_device_range`, `above_device_range`. `PCO.STATUS_MEASURES` = `{ glucose }`. A new measurement is added there only after the owner has said which instruments support it and the contract names its fields.
- New state `device_range`, tone `info`.

## The exact fields for Developer 3 (the only fields; nothing else is written for a status)
| Field on `pc_triage` | When | Value |
|---|---|---|
| `glucoseStatus` | a status is recorded | `below_device_range` or `above_device_range` |
| `glucoseUnit` | always with a status (and with every number) | `mg/dL` or `mmol/L`, exactly this spelling |
| `glucoseDevice` | optional | text, trimmed, at most 100 characters; left OUT when empty |
| `glucose` | with a status | NOT written (absent; never `null`, never a made-up number) |
| `interp.glucose` | with a status | NOT written. No interpretation exists for a status |

`result.fields` from `deviceStatus` is exactly the first three rows, ready to merge into the document. `result.snapshot` is `null` on purpose: there is nothing to put in `interp`.

## How to call it
```js
const r = PCO.deviceStatus({ key: "glucose", status: "below_device_range", unit: "mmol/L", device: "TEST meter", raw: numberBoxText });
if (!r.ok) { show(r.errors.join(" ")); return; }            // plain reasons, already worded
Object.assign(triageDoc, r.fields);                         // glucoseStatus, glucoseUnit, glucoseDevice (if given)
show(r.valueText);                                          // "Blood glucose: below the device's measuring range (mmol/L), no number, device TEST meter"
```
A status never blocks saving and never needs an acknowledgement (`r.saveable === true`, `r.requiresAck === false`, `PCO.canSave` is fine).

## For Developer 3 (decided by the Lead, 2026-11-26; the contract section 18 is the only agreement)
Save (new triage record, when a glucose status is chosen):
- `glucoseStatus` = `below_device_range` or `above_device_range`
- `glucoseUnit` = `mg/dL` or `mmol/L`, kept visible on screen. Save it whenever a glucose number OR a status is chosen.
- `glucoseDevice` = optional text up to 100 characters; leave the key out when empty.
- `glucose` = absent or null. Never a made-up number. Do NOT write `interp.glucose` for a status.
- Do not write `glucoseStatus` or `glucoseDevice` at all when no status is chosen. Never write `glucoseUnit: null` beside a status.
Easiest: `Object.assign(data, PCO.deviceStatus({...}).fields)` after `r.ok`.
Points I saw in `encounter.html` (read only, I did not edit it): line 715 writes `glucoseUnit` only when `v.glucose != null`, so a status needs the unit written too; line 606 `triageLine` shows a glucose number only; line 1574 takes the latest value of `glucose` for the summary, which is correct because a status is not a value and must not be treated as one.
Show (visit summary and print), in the glucose part of `triageLine`:
```js
const gs = PCO.statusOfRecord(t, "glucose");
if (gs) p.push(gs.line);                                   // "Glucose below the device's measuring range, mmol/L, device TEST meter"
else if (t.glucose != null) p.push("Glucose " + t.glucose + " " + (t.glucoseUnit || ""));
```
It never shows a number or a clinical interpretation.
Scripts: `encounter.html` must load `pc-ranges.js` BEFORE `pc-obs.js` (`pc-obs.js` needs `PCR` when it loads). Neither is loaded there today. Report the page and both script names to the Lead; the Lead raises `sw.js`.

## What the engine refuses (the same as rules v29, in advance)
- a status that is not one of the two values; a missing or other unit; a number together with a status (even 0); a device name over 100 characters or not text; any measurement other than glucose.
- The number path is unchanged and still goes through `PCO.interpret` with your limits. Under v29 a stored glucose number needs `glucoseUnit` (`mg/dL` max 1000, `mmol/L` max 55.5, above 0). Those limits stay in `BOUNDS`; I hold no copy of them.

## Tests (in memory only)
- `node --test "tests/*.test.js"`: 264 run, 263 pass, 1 fail. The one failure is the `sw.js` cache test (`pc-obs.js` and `pc-ranges-admin.js` are not in the cache list yet; the Lead owns `sw.js`).
- New in `tests/pc-obs.test.js` (7 tests; `line` for `triageLine` included): the fields pass a JavaScript port of the v29 glucose rule, and the port agrees with the Lead's emulator cases s1 to s6; the fields are exactly the three above with no null; refusals; only glucose enabled; a status is not interpreted even when an approved range and an emergency rule exist that would fire for any number; the number path is unchanged; `statusOfRecord` reads back what was shown.
- NOT run: the Firestore emulator on v29 with a document built from these fields (no emulator here). The port is not the rules file. Please have CI run one `pc_triage` create made from `r.fields` merged into a valid triage document.

## Files
CHANGED `pc-obs.js`, `tests/pc-obs.test.js`. NEW `docs/DEV4_DEVICE_STATUS_ENGINE.md`.

## Questions for the Lead
None open. Answered 2026-11-26: the unit selector is Developer 3's; he shows a stored status with `statusOfRecord`.
