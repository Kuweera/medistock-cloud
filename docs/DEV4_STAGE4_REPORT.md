# Developer 4: Stage 4 report. Treatment reminders and notifications (2026-11-28)

Built on contract section 19 (rules v30, CI green per the Lead) and the answers to Q1 to Q10. No rules, schema or existing collection was changed. Wording everywhere: "scheduled on this device", never "delivered" and never "phone".

## What was built
- **`pc-remind.js` (new, pure, no database).** Works out from events, ACTIVE orders, settings and acknowledgements which alerts apply now, who sees them, and what a device should schedule. Levels: `dose_due`, `dose_overdue`, `dose_escalated`, `appointment_soon`, `appointment_overdue`, `missed_recorded`, `did_not_attend`. Nothing is stored for them.
- **`treatment-alerts.html` (new page).** This device (permission, how many alerts are scheduled on this device, time zone note, owner switch); Needs attention (with Acknowledge and a link to the treatment list); Did not attend (the staff follow-up list from existing `attendance` data, no contact details); Reminder timings (`settings.manage` only).
- **`mc-notify.js` (changed).** For a user with a treatment permission, on the Android app only, it listens to the same data (events for a four-day window, active orders, the facility's settings, acknowledgements) and rebuilds ALL its treatment notifications from scratch on every change, inside the existing reconcile: cancel, then schedule fresh. Treatment gets at most 40 of the 60 notifications; beyond that one summary notification; the other alerts keep the rest. A level that is active now and was never notified on this device is shown once; what this device has notified or scheduled is remembered on the device. Stock, expiry, credit and sync alerts are unchanged.

## The decisions, as implemented
| | |
|---|---|
| Q1 | The timings screen needs `settings.manage` (create and update as in the draft rules) |
| Q2 | An order with no `administrationMode`: in the list only, never a push |
| Q3 | The owner role gets dose alerts only when switched on, on that device (kept on the device). Escalations still reach an owner who is the prescriber |
| Q4 | Acknowledging marks who and when; escalation still happens |
| Q5 | `Africa/Kampala` fallback, with the one-line notice in the timings section when the facility has no time zone |
| Q6 | A `held` dose gives no reminder |
| Q7 | No patient reminders. The Did not attend list is built |
| Q8 | No `pc_reminder_log`. Audit: `reminder.ack`, `reminder.settings` in `pc_audit_logs` |
| Q9 | Everyone with `treatment.administer` gets dose alerts; only the prescriber gets escalation by push (administrators see it labelled in the list) |
| Q10 | 40 of 60, one summary beyond that |
Notification text carries counts and times only: no patient name, no medicine name (it can show on a locked screen). Take-home orders never alert. "Missed" is only what staff recorded; an unrecorded dose stays "overdue".

## Files (8): 2 changed, 6 new
CHANGED `mc-notify.js`, `docs/FIELD_EXPLANATIONS.md`. NEW `pc-remind.js`, `treatment-alerts.html`, `tests/pc-remind.test.js`, `tests/remind-check.js`, `tests/remind-harness.html`, `docs/DEV4_STAGE4_REPORT.md`.

## Requests by name
1. **`sw.js`**: add `treatment-alerts.html` and `pc-remind.js`, and raise the cache version. `mc-notify.js` loads `pc-sched.js` and `pc-remind.js` itself, so both must be cached for the Android app to start them offline. Until then `tests/integration.test.js` fails with `treatment-alerts.html uses pc-remind.js but sw.js does not cache it`: the only failing test.
2. **Navigation**: an entry for `treatment-alerts.html`, "Treatment alerts", for users with `treatment.administer`, `treatment.prescribe` or `settings.manage` (the page shows its own message to anyone else).
3. **Index (new request R4)**: `pc_reminder_acks`, `businessId` ascending, `facilityId` ascending, `createdAt` descending. The devices ask for the newest 1000 acknowledgements. Without the index they fall back to any 1000 and the page says some older acknowledgements may not show. Please add it to `firestore.indexes.json`.
4. **Developer 3 (through you)**: `treatment.html` still uses a fixed 30 and 30 minutes for due and late. If a facility changes the timings, the alert and the treatment list will disagree. `treatment.html` should read `pc_reminder_settings` and use `PCRM.settingsOf(doc)` (or the same defaults). The timings screen says so while it differs.

## Tests (in memory only)
- `node --test "tests/*.test.js"`: 299 run, 298 pass, 1 fail (the `sw.js` test above). New: 17 tests in `tests/pc-remind.test.js`, including a property test over 3,000 random situations (no alert for a stopped, take-home, held, done or other-kind order; an old order never pushes; recorded outcomes never push; at most 40 scheduled; the plan is deterministic; no patient or medicine name in any text; an owner's device without the switch gets none; a user with no permission gets none), time zones (Kampala, New York, Auckland date crossing, a daylight-saving change). I also broke the engine on purpose in eight ways; seven were caught and the eighth is a harmless duplicate guard.
- Chromium, phone (390x844) and desktop (1280x800), real `treatment-alerts.html` and real `mc-notify.js` with an IN-MEMORY Firestore stand-in and a FAKE Android notification plugin: `node tests/remind-check.js`. Passes at both sizes, no page errors, no sideways scroll. Covered: the list and its order; take-home, stopped, held, done and future doses absent; acknowledging writes exactly the fields of the contract and records no dose; a recorded dose or stopped order leaves the list; Did not attend list; prescriber sees escalation and recorded outcomes only; owner switch; clerk blocked; timings validation, create then update (creator unchanged), audit entries; device scheduling: same state gives the same set after repeated rescans, nothing shown twice, recorded doses removed, 100 doses become at most 40 notifications with one summary, the shared 60 limit, owner/prescriber/clerk/permission-denied/browser cases. Three deliberate breakages of `mc-notify.js` were caught (a repeat alert, stale notifications kept, ...); one (the 40/20 split) is equivalent in this scenario and is reasoned, not tested.
- NOT run: a real Android device, app-closed behaviour, airplane mode, the real notification permission flow, two devices, the Firestore emulator on v30 with documents made by this page, real Firebase offline persistence, a slow network, the real `MC.api(window)` from the shell (the stand-in is not the same code), a screen reader. By reading the v30 rules, the acknowledgement id, level, fields, `ackBy`, note limit and the event match are what the page writes; please have CI confirm with one acknowledgement made by a nurse and one settings create and update made by a `settings.manage` user.

## Known limits
- A notification scheduled while the app was open can still fire after another device recorded the dose or an order stopped, if this device has had no connection since. The wording is neutral and the list is the truth.
- The window is four local days (two back, tomorrow); older events are outside the alerts.
- Only medicine and procedure orders alert (consumables do not).
- The link opens the treatment list, not the exact card (it takes no parameters).
- A device in a browser schedules nothing; the page updates while it is open.
- If notifications are off for MediStock on the device, the page says so and schedules nothing.
- Patient reminders are not built (consent, provider, provider-reported delivery do not exist).

## Next
3e, the seed proposals file, once you confirm the format of the planner's evidence.
