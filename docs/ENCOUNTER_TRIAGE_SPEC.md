# ENCOUNTER_TRIAGE_SPEC.md
Phase 2 – Encounters and triage. Built 2026-11-12. Facility-only data; add-only records.

## Scope
Start a visit (encounter) for a registered patient, queue, triage with vital signs, emergency flag, close or cancel a visit.

## Rules of the design
- **Encounter** (`pc_encounters`): one per visit. Types: outpatient, emergency, follow-up, procedure, pharmacy consultation. Status open / closed / cancelled. Stage: registered (waiting), triaged, in consultation. Number `E-{operatorId}-{n}` made on the phone like registration numbers. Holds a small copy of the patient's name, sex and age data for the queue.
- **One open visit per patient.** A second open visit is refused, except an Emergency visit, which is never blocked.
- **Emergency is never held up** by payment, registration details, or internet: there is no payment gate, and everything is saved on the phone first.
- **Queue order:** emergency first, then your triage category (urgent, standard, low), then visits not yet triaged, then arrival time. Filters: waiting/active, closed today, all today.
- **Triage** (`pc_triage`): every save is a new record (so repeat observations keep history): temperature, blood pressure, pulse, breathing rate, oxygen saturation, weight, height, BMI (worked out, not for children under 2), glucose with unit, pain 0-10, consciousness (alert / voice / pain / unresponsive), MUAC, notes, and the clinician's triage category. No field is mandatory except that something must be recorded. Values outside plausible limits (for example temperature outside 25-45 °C) are refused to catch typing mistakes; the bottom blood pressure number cannot be higher than the top.
- **The app never chooses a triage category or diagnoses.** The category is selected by the person triaging.
- **Warning ranges:** nothing is built in. Someone with permission "Set warning ranges" enters their facility's own ranges and the **source** (for example a guideline and its date) in Visits > Set warning ranges. Triage values outside a range are highlighted as "facility warning range, not a diagnosis". The ranges are versioned.
- **Closing:** needs permission "Close or cancel visits". A cancelled visit needs a reason. Closed visits cannot be changed; notes can still be amended by someone who may sign.
- **Corrections:** triage records can only be marked "entered in error" with a reason; they are never edited or deleted.

## Permissions (added to the Users page)
`encounter.open`, `triage.record`, `consult.record`, `consult.sign`, `encounter.close`, `settings.manage`. Reading needs `patient.view`. Quick-fill: Reception adds start visit; Nurse adds start visit and triage; Clinician adds all consultation permissions and closing.

## Offline
All saves go to the phone first and sync later. Visit numbers come from a counter on the phone.

## Not in this phase
Configurable observation requirements by patient category, escalation alerts, billing, investigations (Phase 3).
