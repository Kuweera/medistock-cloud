# MEDICATION_ADMINISTRATION_SPEC.md
Phase 4 - Medication administration record (MAR). Built 2026-11-14.

## Screen: Treatment & MAR
Tabs: Due and late (and held), Today, Given / not given, As needed (PRN), Active plans. Filters: patient or medicine search, medicines or procedures, look back (today to 7 days). Each planned administration shows time, patient, medicine, dose, route, instructions, and a red ALLERGY tag if the medicine matches a recorded allergy.

## Recording (`pc_mar_records`)
Tap a planned administration, then: **Given** (or "Procedure done"), **Patient refused**, **Hold**, **Not given**, **Missed**. Each is a new record with the planned and actual time (typed or calendar, not in the future), the dose actually given (default the planned dose), observations, any reaction, the person, and for anything not given a **required reason**. The planned administration then shows the outcome. Needs permission "Record giving medicines and procedures".
- **Allergy check at the bedside:** if the medicine matches an allergy the nurse must tick that a clinician authorised it.
- **Dispensing and giving are separate.** A pharmacy dispensing record (Phase 5) will never create a "given" record.
- **No duplicates:** an administration can be recorded once. If two phones try, the second is refused by the security rules and the nurse is told. A held administration can be released back to pending.
- **Corrections:** a wrong record is never edited or deleted. Someone with "Correct wrong medication records" marks it **entered in error** with a reason; the administration goes back to pending and a new record can be made. The wrong record stays on file.

## As-needed (PRN) doses
Recorded without a planned time: reason for giving (required), time, dose, observations, reaction. The app shows how many doses were given today, the last dose, and warns if the shortest interval, the most doses a day or the daily total would be exceeded. These limits are checked **in the app** (the security rules cannot count doses), so a warning needs a written reason to continue; the warnings and reason are stored.

## Known limits
No barcode checks, no automatic reminders, no handover report yet. Planned times older than the look-back selector are not listed. Offline: records are saved on the phone and sent when online; if another phone recorded the same administration first, the second save is refused when it syncs and the nurse sees "NOT SAVED".
