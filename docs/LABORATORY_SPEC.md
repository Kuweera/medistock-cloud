# LABORATORY_SPEC.md (Developer 4)

## Principle
The app supplies the structure, never the clinical content. Units, reference ranges, critical limits, scale terms and their meanings, interpretation notes and prices all come from the facility's own catalogue entry, and a range or a critical limit must name its source. Local terms such as Tr, Trr or Trrk are only text each facility types in; nothing assumes they mean the same elsewhere. A "critical" or "high/low" mark is a comparison with limits the facility entered. It is never a diagnosis.

## Result types
number; qualitative (Positive/Negative/Reactive/...: the facility lists the words); graded scale (facility terms in order, optional meaning each); categories (for example blood group); free text; panel (several parameters, each its own type, unit and range); titer (dilution such as 1:80, or a category); organism with antibiotic susceptibility (facility lists antibiotics and result codes). Templates for ten common layouts fill only the structure. A template's scale terms are left empty on purpose.

## Reporting profile
Each catalogue test carries name, category, specimen, collection instructions, method, equipment, processing instructions, result type and allowed values, units and reference information (with source), interpretation notes, critical limits (with source), price, active flag and approval status (draft/approved). Requesting a test copies this profile onto the order, so the order stays self-contained and an old catalogue edit never changes an old order. The result screen shows only the fields for the test's type.

## Workflow
requested -> collected -> received -> accepted or rejected -> processing -> result entered -> verified -> reviewed by the clinician. Small laboratories may go collected -> processing. Rejection needs a reason (list plus free text) and ends the request; the clinician sees the reason and can request again. Every step stores who and when, and writes an audit entry.

## Result safety
A result is never overwritten. A correction needs a reason and creates a new result that points to the one it replaces; the old one stays on record (the rules enforce both). A verified result cannot be edited. Verification, entry and correction store user and time. A result outside the facility's critical limits creates a notice in the same save: the laboratory records who was told and how; the clinician acknowledges it in the visit. Notices are in-app only (no SMS or push).

## Money
A request is not revenue. Payment is a separate saved bill, one per order (document id = order id). The credit portion goes to the patient's credit account (the same one the pharmacy uses) as a CREDIT_SALE with a fixed id, so a retry cannot double it. No charge needs a written reason and records who authorised it. A reversal needs a reason and cancels the credit it created. No receipts or sales are written, so Sales reports are not double counted.

## Reports (`lab-reports.html`, permission `lab.report`)
Daily register, pending, collected but not received, processing, awaiting verification, verified, corrected results, rejected, cancelled, test volume, average time request to verified, revenue (billed, received, on credit, no charge, not yet billed) from saved bills only. Up to 31 days; register can be saved as CSV.

## Known limits
- Cash taken for lab tests is not in `cash-position.html` (a protected file). Later payments of lab credit are made in Credit and are not linked back to the bill, so the report shows what was on credit when billed.
- Critical notices are in-app only.
- The reports page reads results and bills of the facility up to 3000 documents.
- Reference ranges and critical limits do not vary by age or sex (one set per test or parameter).
- A person with both lab.result and lab.verify can verify their own result (an earlier-phase decision; the audit log shows it).
- The credit transaction for lab credit has no receipt, so Credit shows "Receipt # -" for it.
