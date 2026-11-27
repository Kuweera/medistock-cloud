# Developer 4 → Lead: request R3. Stage 4, treatment reminders and notifications

Date: 2026-11-27. **Nothing here is implemented. No shared file has been changed.** This is the schema request you asked for on 2026-11-25 (what is written, by whom, whether it is needed offline). Contract section 5 still leaves open "notification event types and who receives them"; section 2 below proposes them. Based on a read of the repo you gave me (rules v29, `sw.js` mc-v38).

## 0. In one paragraph
Almost everything is DERIVED on each phone from data that already syncs (events, orders, settings, acknowledgements), as `mc-notify.js` does today for stock. I ask for **two small new collections** (`pc_reminder_settings`, `pc_reminder_acks`) and **no change to any existing collection**. I do **not** ask for `pc_reminder_log` (see 4.3) and I do **not** build patient reminders in this release (see 4.4). Nothing will ever say a notification was "delivered": a phone can only say "scheduled on this phone".

## 1. What already exists and is reused unchanged (no duplicate system)
| Existing | Used for |
|---|---|
| `pc_treatment_events` (`status` pending / held / administered / refused / missed / not_given / cancelled; `plannedAt` UTC ms, `plannedDay`, `tz`, `label`, `kind`, `orderId`, `patientId`, `attendance*`) | the one source of "a dose or procedure is due". Read-only for me |
| `pc_treatment_orders` (`status` active / stopped / completed, `administrationMode` `take_home` / `facility_administered` / `inpatient_mar`, `prescriberId`) | stop rules and "who ordered it". Read-only for me |
| `pc_mar_records` | administration stays exactly as Developer 3 built it. Reminders never record a dose |
| `pc-sched.js` `dueState` (pending → due → delayed, grace and soon default 30 and 30 minutes) and the derived "Overdue: not arrived" in `treatment.html` | the same definitions, so the alert and the screen never disagree. I will call `PCS.dueState`, not copy it |
| `pc_audit_logs` (create-only, any action string) | the audit record of important notification events |
| `mc-notify.js` (Dev 4 file per the contract table; Android local notifications from synced data, works offline) | device scheduling. I extend it; no Cloud Functions |
| `shops.timezone` (read by `treatment.html`, default `Africa/Kampala` there) | display times. Scheduling uses the absolute `plannedAt` |
| pattern of `pc_obs_acks` (deterministic id, create-only) | acknowledgements |

## 2. Event types (all derived, none stored)
Only for orders whose `administrationMode` is `inpatient_mar` or `facility_administered`. **`take_home` never creates a staff alert.** An event is skipped when its order is not `active`, when the event is not `pending`, when the event is `held` (paused on purpose), or when it belongs to another facility.
| Type | Trigger (settings below) | Who | Stops when |
|---|---|---|---|
| `dose_due` (also procedures: `kind` procedure) | `plannedAt` within `soonMin` | users with `treatment.administer` at the facility | the event leaves `pending`, or the order stops or completes |
| `dose_overdue` | now is past `plannedAt` + `graceMin`, still `pending` | same | same |
| `dose_escalated` | still `pending` at `plannedAt` + `escalateAfterMin` (only if set) | the prescriber of the order (`order.prescriberId`); also shown in-app to everyone with `treatment.administer`, with "escalated" | same |
| `appointment_soon` (facility-administered) | `appointmentAdvanceMin` before `plannedAt` (only if set) | `treatment.administer` | arrival recorded, or the event leaves `pending` |
| `appointment_overdue` | past grace, `pending`, no arrival (the same derivation as "Overdue: not arrived") | `treatment.administer` | arrival recorded, or the event leaves `pending` |
| `missed_recorded`, `did_not_attend` | the event is `missed` (staff recorded it; `did_not_attend` when `attendance` says so) | the prescriber of the order, in-app list only (no push) | acknowledged |
"Missed" is never inferred: it exists only when staff record it (it needs a MAR record). A dose that is simply not recorded stays "overdue", never "missed".
Who receives is by existing permissions only. **There is no per-patient or per-ward nurse assignment in the data, and I invent none** (question Q9).

## 3. New data
### 3.1 `pc_reminder_settings/{facilityId}` (one document per facility)
| Field | Type | Meaning |
|---|---|---|
| `schemaVersion`, `businessId`, `facilityId` (must equal the document id), `createdBy`, `createdAt`, `updatedBy`, `updatedAt` | stamps | as every `pc_` document |
| `graceMin` | int 5 to 240 | minutes after `plannedAt` before a dose is overdue. **Absent = 30** (today's `dueState`) |
| `soonMin` | int 5 to 240 | minutes before `plannedAt` that a dose is "due". Absent = 30 |
| `escalateAfterMin` | int 0 to 720 | minutes after `plannedAt` to escalate. **0 or absent = no escalation** |
| `appointmentAdvanceMin` | int 0 to 1440 | minutes before a facility-administered appointment to remind. 0 or absent = none |
These are operational timings, not clinical values; the bounds are my proposal, change them freely. No other field.
- **Written by:** a user with the permission you choose in Q1, from a small settings section of my new page. Rare.
- **Needed offline:** READ yes (a phone must work from its cached copy). WRITE can wait for the connection and queue.
- Changes are written to `pc_audit_logs` (`reminder.settings`).

### 3.2 `pc_reminder_acks/{ackId}` (create-only)
`ackId` = `rack_` + `eventId` + `_` + `level`. One acknowledgement per event per level: the first one stands and the whole team sees it.
| Field | Type | Meaning |
|---|---|---|
| stamps | | `businessId`, `facilityId`, `schemaVersion`, `createdBy`, `createdAt` as `pcCreateOk` |
| `eventId`, `orderId`, `patientId` | string | must match the event |
| `level` | string | `dose_due`, `dose_overdue`, `dose_escalated`, `appointment_soon`, `appointment_overdue`, `missed_recorded`, `did_not_attend` |
| `ackBy`, `ackByName` | string | the user. `ackBy == auth.uid` |
| `note` | string ≤ 300 | optional |
- **An acknowledgement means "I have seen this". It records no dose and changes no event.** Giving a dose is only ever done through Developer 3's medication record.
- **Written by:** users with `treatment.administer` or `treatment.prescribe`, when they tap Acknowledge.
- **Needed offline:** yes. It is created on the phone and syncs later. If two phones acknowledge the same event offline, the second create is refused on sync (id already exists); the screen treats that as "already acknowledged". Nothing is lost, the first acknowledgement stands.
- No `encounterOpenOk`: a returning outpatient's encounter may be closed, as for the administration update in `pc_treatment_events`.

### 3.3 Draft rules (for you to adapt; modelled on existing helpers)
```
function rsOk(d) {
  return d.get('graceMin', 30) is int && d.get('graceMin', 30) >= 5 && d.get('graceMin', 30) <= 240
    && d.get('soonMin', 30) is int && d.get('soonMin', 30) >= 5 && d.get('soonMin', 30) <= 240
    && d.get('escalateAfterMin', 0) is int && d.get('escalateAfterMin', 0) >= 0 && d.get('escalateAfterMin', 0) <= 720
    && d.get('appointmentAdvanceMin', 0) is int && d.get('appointmentAdvanceMin', 0) >= 0 && d.get('appointmentAdvanceMin', 0) <= 1440;
}
match /pc_reminder_settings/{facId} {
  allow read: if canAccessShop(resource.data.businessId, resource.data.facilityId)
    && (hasPerm(resource.data.businessId, 'treatment.administer') || hasPerm(resource.data.businessId, 'treatment.prescribe') || hasPerm(resource.data.businessId, <Q1 permission>));
  allow create: if pcCreateOk(request.resource.data) && hasPerm(request.resource.data.businessId, <Q1 permission>)
    && facId == request.resource.data.facilityId && rsOk(request.resource.data);
  allow update: if canAccessShop(resource.data.businessId, resource.data.facilityId) && hasPerm(resource.data.businessId, <Q1 permission>) && pcUpdateStamped()
    && request.resource.data.diff(resource.data).unchangedKeys().hasAll(['businessId', 'facilityId', 'createdBy', 'createdAt']) && rsOk(request.resource.data);
  allow delete: if false;
}
match /pc_reminder_acks/{ackId} {
  allow read: if childReadOk(resource.data);
  allow create: if pcCreateOk(request.resource.data)
    && (hasPerm(request.resource.data.businessId, 'treatment.administer') || hasPerm(request.resource.data.businessId, 'treatment.prescribe'))
    && request.resource.data.eventId is string && request.resource.data.level in ['dose_due', 'dose_overdue', 'dose_escalated', 'appointment_soon', 'appointment_overdue', 'missed_recorded', 'did_not_attend']
    && ackId == 'rack_' + request.resource.data.eventId + '_' + request.resource.data.level
    && exists(/databases/$(database)/documents/pc_treatment_events/$(request.resource.data.eventId))
    && get(/databases/$(database)/documents/pc_treatment_events/$(request.resource.data.eventId)).data.facilityId == request.resource.data.facilityId
    && get(/databases/$(database)/documents/pc_treatment_events/$(request.resource.data.eventId)).data.patientId == request.resource.data.patientId
    && get(/databases/$(database)/documents/pc_treatment_events/$(request.resource.data.eventId)).data.orderId == request.resource.data.orderId
    && request.resource.data.ackBy == request.auth.uid && request.resource.data.ackByName is string
    && request.resource.data.get('note', '') is string && request.resource.data.get('note', '').size() <= 300;
  allow update, delete: if false;
}
```
Emulator cases I would expect: settings create and update by the permitted user; refused for a nurse, for another facility, for `graceMin` 4 or 241, for `facilityId` not equal to the id, for a changed `createdBy`; acknowledgement created by a nurse; refused for a wrong id, an unknown level, `ackBy` of another user, an event of another facility or another patient, a note over 300, a second create of the same id, any update or delete.

### 3.4 Indexes
None new. The phone asks for `businessId` and `facilityId` equal, and `plannedDay` in a window of about four days (equalities only, served by the existing merge of single-field indexes). Events older than that window are outside the alerts: a limit I will state in the report. Tell me if you want the window longer.

## 4. What I am deliberately not asking for
4.1 **No change to `pc_treatment_events`, `pc_treatment_orders`, `pc_mar_records`, patients or encounters.** No new field on any existing document.
4.2 **No Cloud Functions, no server timers.** Each phone derives its own alerts, offline included.
4.3 **No `pc_reminder_log`** (the placeholder in contract section 11). A log of "reminder delivered" cannot be true for a device-local notification (it may not fire, the phone may be off). Verifiable events go to `pc_audit_logs`: `reminder.ack`, `reminder.settings`. Please drop the placeholder or tell me why it is needed.
4.4 **No patient reminders (SMS, WhatsApp, calls) in this release.** They need three things that do not exist: the patient's consent recorded, a communication provider configured, and delivery status reported by that provider. Without them the app would have to claim something it cannot know. Nothing is written for it. If you want a first step that needs no schema, I can make a staff follow-up list of patients who did not attend (from existing `attendance` data) for staff to phone.

## 5. How it will work (after approval)
- `pc-remind.js` (new, pure): `derive(events, orders, settings, acks, now)` returns the list of alerts with deterministic keys (`eventId` + level). Fully unit-tested, including time zones and daylight saving through `PCS`.
- `mc-notify.js` (mine): on the Android app, for a user who has `treatment.administer` or `treatment.prescribe`, it listens (through `MC.api(window)`, no `mc-core.js` change; I have not yet confirmed that the shell window can use it, and if it cannot I will come back to you before touching anything) to the window above plus orders, settings and acks, then rebuilds ALL its treatment notifications from scratch on every change: cancel mine, schedule fresh. Notification id = hash of event + level + `plannedAt`. **Duplicates are impossible by construction**: the same state gives the same set, and a level fires once.
- New page `treatment-alerts.html` ("Treatment alerts"): the derived list with Acknowledge, a link to the treatment screen card, and the settings section for the permitted user. Works in any browser; in a browser there is no background notification (Chrome does nothing, as today).
- Honest wording everywhere: "Scheduled on this phone", never "delivered". If the phone refused notification permission the page says so (`MCNotify.permission`).
- Audit: acknowledgement and settings changes with user, facility and time.
- Limit that cannot be removed: a notification scheduled while the app was open can still fire after another phone recorded the dose or the order stopped, if this phone had no connection since. Wording is neutral ("Check the treatment list") and the in-app list is the truth.

## 6. What I need from you
| | |
|---|---|
| A | Rules v30 with the two collections (3.3), or your changes to them |
| B | `sw.js` and navigation when I deliver: new `treatment-alerts.html` and `pc-remind.js` (`mc-notify.js` already cached) |
| C | Contract text (a new section) with the event types of section 2, the two collections, and the "acknowledgement is not administration" rule |
| D | Answers to Q1 to Q10 |

## 7. Questions
- **Q1** Which permission may change the reminder settings? I suggest the existing `settings.manage` (its label today says only "warning ranges for vital signs", so the label would change). Or a new `reminders.manage`.
- **Q2** Old orders with no `administrationMode`: push alerts or in-app only? I suggest in-app only until the owner decides, so no existing order starts buzzing phones.
- **Q3** The owner role holds every permission. Should an owner's phone receive dose alerts? I suggest no, unless the owner switches it on for that phone (a setting on the phone only).
- **Q4** Does acknowledging an overdue alert stop its escalation? I suggest no: the escalation still goes out, showing who acknowledged and when.
- **Q5** Time zone: `treatment.html` defaults to `Africa/Kampala` when the facility has none. Keep that, or show "facility time zone not set"?
- **Q6** A `held` dose gives no reminder until it is released. Agreed?
- **Q7** Patient reminders (4.4): not in this release, and optionally the staff follow-up list. Agreed?
- **Q8** `pc_reminder_log` (4.3): drop?
- **Q9** There is no nurse or ward assignment in the data. Everyone with `treatment.administer` at the facility gets the dose alerts, and only the prescriber gets escalation. Is that acceptable, or is an assignment field coming from Developer 2 or 3?
- **Q10** `mc-notify.js` can hold 60 scheduled notifications for all alert kinds. I suggest treatment reminders have priority up to 40 of them, grouped into one digest when there are more. Agreed?

## 8. Test plan once approved
Node (pure engine, time zones, daylight saving, duplicates, stop rules, take-home, held, permissions); Chromium with the in-memory stand-in for the alerts page at phone and desktop sizes; your emulator cases (3.3); and **a real Android phone** for scheduling, app-closed behaviour and airplane mode. I cannot run that last one here, and I will say so in the report.
