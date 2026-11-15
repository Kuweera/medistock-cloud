# OFFLINE_SYNC_TEST_REPORT.md
Developer 4. Date: 2026-11-15. **Result: NOT TESTED on real devices or real Firebase.** This page is the test plan plus what is already covered in code-level tests (in-memory database only).

## Already covered by Developer 1's mock tests (`tests/dispense.test.js`, 28 passing)
Duplicate request returns no second deduction; failed commit leaves stock unchanged; expired/negative/over-dispense refused; concurrent transaction on the same batch retries and the second fails; offline queue replays once; queued items are shown as pending, not as stock deducted. These prove the logic, not Firebase behaviour.

## Must be run by a person (record result, date, device, build)
| # | Scenario | Pass condition | Result |
|---|---|---|---|
| 1 | Normal internet: dispense 12 of 20 | stock -12, outstanding 8, record shows batch + expiry | |
| 2 | Second dispensing of 8 | completes; third attempt refused | |
| 3 | Slow internet (throttle): tap Confirm twice | one deduction only | |
| 4 | Connection drops during Confirm | message says not confirmed; retry gives one deduction | |
| 5 | Airplane mode: dispense | shown as PENDING SYNC; stock not reduced | |
| 6 | Reconnect | item syncs once; stock reduced once | |
| 7 | Two phones, same batch with 10 left, each dispenses 8 | second is refused with a clear message; stock never negative | |
| 8 | Offline phone queues 8 while online phone dispenses 8 of the same 10 | replay shows "Problem", recoverable (Try again / Remove with reason) | |
| 9 | Two operators, one facility, same prescription | outstanding never exceeds prescribed | |
| 10 | Two facilities, one business, same medicine name | each uses only its own stock | |
| 11 | Sale on the Sales page while dispensing the same batch | both succeed or one retries; stock correct | |
| 12 | Phase 4: record a dose offline on two devices, sync | single administration record per planned dose | |
Gate: no Phase 5 release until rows 1-11 pass.
