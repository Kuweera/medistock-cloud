# Patient journey: proposal and what Stage 3 built (Developer 2, 2026-11-21)

Status: the Lead approved the `pc_encounters.journey` field and shape on 2026-11-20 (DATA_CONTRACT_V19 section 7, rules v20). This document records how it is used. **No new `stage` value is requested**: `stage` stays registered / triaged / in_consultation.

## Principle
The journey is not a fixed pipeline. Each visit shows (1) where it is now (stage and real records), (2) the next step, (3) what else it is waiting for. The hint (`journey`) is a cache written by staff; real records always win, and nothing is ever blocked because of it.

## What decides what (implemented in `encounters.html`, function `journeyView`)
| Question | Source of truth | Hint used for |
|---|---|---|
| Needs triage? | `stage == registered` (skipped if staff send the patient straight to consultation) | explicit "go straight to consultation" |
| Waiting for consultation / in consultation | `stage` | - |
| In the laboratory | real `pc_inv_orders` with status requested, collected, received, accepted or processing | never: a hint cannot put a patient in the lab |
| Results to review | `pc_inv_orders` status resulted or verified (not yet reviewed) | - |
| Pharmacy, treatment or procedure room, follow-up, discharge | the hint (`next` / `waiting`); no dispense or attendance data is read here (Developer 3 owns it) | yes |
| Medicine or procedure ordered (information chip) | active `pc_treatment_orders` | - |

A hint is ignored (treated as stale) when the records contradict it: `triage` after triage, `consultation` while in consultation, `investigation` with no tests, `results_review` with no results to review.

## Parallel work
`waiting` can hold up to 4 of laboratory, pharmacy, treatment, clinician, patient, so a patient can be in the lab and pharmacy at once. A patient sent on to pharmacy or treatment leaves the consultation queue unless "clinician" is also waiting.

## Who writes it
Anyone with `encounter.open`, `triage.record` or `consult.record` using "Send to next step" on the visit queue (`encounters.html`). It writes only `journey` (+ `updatedAt/updatedBy`) and one `pc_audit_logs` row (`journey.route`). It creates no orders and changes no stage. Nothing writes the hint automatically yet: `encounter.html` (triage, consultation, order buttons) is Developer 3's file and is not touched; once released, those screens can offer "send to next step" with the right default.

## When a visit closes with open work (proposal, NOT built, needs the Lead)
Closing a visit with pending tests or an active medicine order should show a warning listing them and still allow closing (never block). The close action is in `encounter.html`, so it waits for that file to be released.

## Not decided by me
- Scheduled-procedure queues: Developer 3 owns the data and the attendance status (Lead message 2026-11-20). Stage 3 shows only "Procedures" from the hint and "Procedure ordered" from active orders.
- Prescription status chips: wait for Developer 3 to report them built.
