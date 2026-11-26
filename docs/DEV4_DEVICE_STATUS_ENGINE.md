# Developer 4: device result outside the measuring range. Engine side (2026-11-26)

Agreement: `docs/DATA_CONTRACT_V19.md` section 18 (rules v29). Nothing here goes beyond it. Not changed: reference ranges, alert rules, `BOUNDS`, `encounter.html`, `firestore.rules`, `sw.js`.

## What is in `pc-obs.js` (global `PCO`)
- `PCO.deviceStatus({ key, status, unit, device, raw })` builds and checks a status. `key` is `"glucose"` (the only enabled measurement). `raw` is the number box, which must be blank.
- `PCO.interpret({... status: "below_device_range" })` never interprets a status: it returns the same answer as `deviceStatus`.
- `PCO.statusOfRecord(record, "glucose")` reads a stored triage record for history screens: `null` for an ordinary record, otherwise `{ status, unit, device, text }`.
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
show(r.valueText);                                          // "Blood glucose: below the measuring range of the device (mmol/L), no number, device TEST meter"
```
A status never blocks saving and never needs an acknowledgement (`r.saveable === true`, `r.requiresAck === false`, `PCO.canSave` is fine).

## What the engine refuses (the same as rules v29, in advance)
- a status that is not one of the two values; a missing or other unit; a number together with a status (even 0); a device name over 100 characters or not text; any measurement other than glucose.
- The number path is unchanged and still goes through `PCO.interpret` with your limits. Under v29 a stored glucose number needs `glucoseUnit` (`mg/dL` max 1000, `mmol/L` max 55.5, above 0). Those limits stay in `BOUNDS`; I hold no copy of them.

## Tests (in memory only)
- `node --test "tests/*.test.js"`: 264 run, 263 pass, 1 fail. The one failure is the `sw.js` cache test (`pc-obs.js` and `pc-ranges-admin.js` are not in the cache list yet; the Lead owns `sw.js`).
- New in `tests/pc-obs.test.js` (7 tests): the fields pass a JavaScript port of the v29 glucose rule, and the port agrees with the Lead's emulator cases s1 to s6; the fields are exactly the three above with no null; refusals; only glucose enabled; a status is not interpreted even when an approved range and an emergency rule exist that would fire for any number; the number path is unchanged; `statusOfRecord` reads back what was shown.
- NOT run: the Firestore emulator on v29 with a document built from these fields (no emulator here). The port is not the rules file. Please have CI run one `pc_triage` create made from `r.fields` merged into a valid triage document.

## Files
CHANGED `pc-obs.js`, `tests/pc-obs.test.js`. NEW `docs/DEV4_DEVICE_STATUS_ENGINE.md`.

## Questions for the Lead
1. Developer 3's form needs a glucose unit choice whenever a glucose number or a status is entered (v29 makes `glucoseUnit` required for both). Confirm that this is his side.
2. Section 18 says nothing about showing a stored status in the visit summary or print. I supplied `statusOfRecord` for that; say if Developer 3 should not use it.
