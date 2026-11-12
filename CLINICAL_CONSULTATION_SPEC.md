# CLINICAL_CONSULTATION_SPEC.md
Phase 2 – Consultation. Built 2026-11-12. Facility-only data; nothing is deleted.

## Records
- **Presenting complaints** (`pc_complaints`): several per visit. Name (type or choose), when it started, how long, severity, progression, other symptoms, what makes it worse or better, previous episodes, notes.
- **Medicines taken before this visit** (`pc_prior_medications`): medicine name (type, or choose from this shop's own medicine catalogue), strength, dose, how often, route, how long, last dose date (typed or calendar), whether the course was completed, response, and who told us (patient, guardian, records). The patient or guardian may not know exact details, so only the name is required.
- **Clinical notes** (`pc_clinical_notes`): history of presenting illness, physical examination (structured sections: general, respiratory, cardiovascular, abdominal, neurological, skin, musculoskeletal, other), assessment, progress, other.

## Signing and corrections
- A note starts as a **draft**. Its author can edit a draft. Someone with permission "Sign and amend clinical notes" can sign it. **A signed note can never be changed.**
- To correct a signed note, a signer adds an **amendment**: a new signed note that points to the original. The original stays on record, with amendments shown under it.
- Any note, complaint, medicine or triage record can be marked **entered in error** with a reason; it stays on record, struck through.
- Every action is logged (who, what, when).

## What this phase does not do
No diagnosis list (Phase 3), no prescriptions or treatment plans (Phase 4). The app does not suggest diagnoses or treatment.

## Permissions
`consult.record` (add complaints, medicines taken, draft notes), `consult.sign` (sign, amend, mark notes in error), `triage.record`, `encounter.open`, `encounter.close`, `settings.manage`.
