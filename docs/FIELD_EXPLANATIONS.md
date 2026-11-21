# Field-by-field explanation of the patient-care forms
Developer 3, master implementation plan deliverable 9. **Generated from the real forms** (every labelled field in the nine patient-care pages) and checked by `tests/fields-doc.test.js`, which fails if a labelled field is added to a page without being explained here.

How to read it: *Required or optional* says what the form needs. **Required (*)** and **Optional** in the field label are shown on the box itself. For these forms (registration, triage, complaint, earlier medicines, diagnosis, treatment plan, allergy, history, test catalogue, dosing rule, operator, follow-up plan, test request, medicine and procedure order) the requirement was checked against the code that saves the form and is stated in a line under the form heading; those fields show it here too. **Not marked** means the screen does not say and it has **not** been checked: it does not mean optional. See "Findings" at the end.

Where a field is explained on the screen itself (a short grey line under the box), the wording here is the same.

## Patient registration (`patients.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Full name | Required (*) | The patient's full name as the patient or guardian gives it. |
| Sex | Required (*) | Female, male, other or unknown, as recorded for the patient. |
| Age | Optional (has a default) | Choose how the age is known: exact date of birth, an estimated age, or unknown. |
| Date of birth | Required if you choose: I know the date of birth | The exact date of birth, typed as DD/MM/YYYY or picked from the calendar. The age is worked out and shown under the box. |
| Years | Required (at least one) if you choose: Estimated age | Estimated age: whole years. |
| Months | Required (at least one) if you choose: Estimated age | Estimated age: months (for babies and small children). |
| Days | Required (at least one) if you choose: Estimated age | Estimated age: days (for newborns). |
| Phone number | Optional | A number the facility can use to reach the patient or guardian. |
| Address | Optional | Where the patient lives or can be found. |
| Village | Optional | The village or local area. |
| District | Optional | The district. |
| Name | Optional | Next of kin: the name of the relative to contact about the patient's care. |
| Relationship | Optional | Next of kin: how this person is related to the patient. |
| Phone | Optional | Next of kin: phone number. |
| Name | Optional | Emergency contact: the person to call first in an emergency. It can be the same person as the next of kin. |
| Relationship | Optional | Emergency contact: how this person is related to the patient. |
| Phone | Optional | Emergency contact: phone number. |
| Different person? Say why | Required or optional (depends on the match) | Shown when a similar patient already exists. Say why this is a different person, so that a duplicate record is not created by mistake. |

## Patient profile: history, allergies, sharing, merging (`patient.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Find the other record | Not marked | Search for the other record of the same patient that should be joined to this one. |
| Which record do you keep? | Not marked | Choose which of the two records stays. The other is joined into it and kept for history. |
| Reason (type or choose) | Required (*) | Why the records are being joined. It is kept in the audit trail. |
| Type | Optional | The kind of history entry: chronic illness, previous diagnosis, admission or operation, current or previous medicine, family history, social history, or pregnancy / breastfeeding. |
| Details | Required (*) | The details of the history entry. |
| When (optional) | Optional | When it started, if known. |
| Allergic to (substance) | Required (*) | The medicine or substance the patient reacts to. |
| Reaction | Optional | What happens when the patient is exposed to it. |
| Severity | Optional | Mild, moderate or severe. See the explanation under the box. |
| Date noted | Optional | The date the allergy was noted. |
| Service needed (optional) | Optional | The service the patient is being sent for, if any. |
| Business (type to search, or choose) | Not marked | The business that will be allowed to see this patient's record. |
| Facility | Not marked | The facility inside that business. |
| Why (type or choose) | Not marked | Why the record is being shared, for example a referral. |
| How did they agree? | Not marked | How the patient (or guardian) agreed to the sharing: said yes (verbal) or signed (written). |
| Who agreed? | Required (*) | The person who agreed: the patient or their guardian. |

## Opening a visit and vital-sign ranges (`encounters.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Patient | Required (*) | Search for the patient by name or number. |
| Type of visit | Not marked | The kind of visit: outpatient, emergency, follow-up, procedure or pharmacy. |
| Reason for visit (type or choose) | Not marked | Why the patient came, in a few words. |
| Source of these ranges | Required (*) | Where the normal ranges for vital signs come from, for example a guideline or the facility policy. |
| Effective from | Not marked | The date from which these ranges are used. |
| Next step | Not marked | Where the patient goes next after this activity (for example pharmacy, laboratory or discharge). Choose only the steps this patient needs. It only informs the next team; it does not order anything. |
| Note for the next team (optional) | Not marked | A short message (up to 140 characters) shown to the next team, for example "Fasting sample needed". |
| Lowest and highest normal value (per vital sign) | Not marked | The lowest and highest value counted as normal for each vital sign (one pair of boxes per vital sign). Values outside the range are highlighted. |

## The visit screen: triage, complaints, earlier medicines, notes, tests, diagnosis, treatment plan and orders, follow-up, closing (`encounter.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Temperature (°C) | Optional (at least one entry is needed) | Body temperature in degrees Celsius. |
| Pulse (/min) | Optional (at least one entry is needed) | Heart beats in one minute. |
| Blood pressure (mmHg) | Optional (at least one entry is needed) | Blood pressure in mmHg: the top (systolic) number and the bottom (diastolic) number. |
| Breathing rate (/min) | Optional (at least one entry is needed) | Breaths in one minute. |
| Oxygen saturation (%) | Optional (at least one entry is needed) | Oxygen saturation: the percentage of oxygen in the blood, read from a finger sensor. |
| Weight (kg) | Optional (at least one entry is needed) | Weight in kilograms. It is reused for weight-based doses and guideline checks, so it does not need to be typed again. |
| Height (cm) | Optional (at least one entry is needed) | Height in centimetres. |
| Blood glucose | Optional (at least one entry is needed) | Blood glucose (sugar) reading. Choose the unit your meter shows. |
| Pain score (0-10) | Optional (at least one entry is needed) | 0 means no pain. 10 means the worst pain imaginable. |
| Consciousness | Optional (at least one entry is needed) | How awake the patient is. See the explanation under the box. |
| MUAC (cm) - children | Optional (at least one entry is needed) | Mid-upper arm circumference in centimetres, measured with a tape. Mostly used for young children. |
| Triage category (your decision) | Optional (at least one entry is needed) | Your own decision about how urgent the patient is. The system does not set it for you. |
| Triage notes | Optional (at least one entry is needed) | Anything else noticed during triage. |
| Complaint | Required (*) | The main complaint, in the patient's own words or a short name. |
| Started (type or choose) | Optional | When it started, for example today or 3 days ago. |
| Lasted (number) | Optional | The number for how long: used with the unit in the next box. |
| How long has the patient had this complaint? (unit) | Optional | The unit for how long: hours, days, weeks, months or years. |
| Severity | Optional | How bad the patient says it is. |
| Progression | Optional | Whether the complaint is getting better, worse, staying the same, or comes and goes. |
| Other symptoms with it | Optional | Other symptoms that come with this complaint. |
| Makes it worse | Optional | Anything that makes the complaint worse. |
| Makes it better | Optional | Anything that makes the complaint better. |
| Had it before? | Optional | Whether the patient has had this complaint before. |
| Notes | Optional | Any other detail about the complaint. |
| Medicine | Required (*) | A medicine the patient took before this visit. |
| Strength | Optional | The strength, for example 500 mg. |
| Dose | Optional | How much was taken each time. |
| How often | Optional | How often it was taken. |
| Route | Optional | How it entered the body. |
| For how long | Optional | How long it was taken. |
| Last dose taken | Optional | The date of the last dose taken. |
| Course | Optional | Whether the patient is still taking it, finished it, or stopped early. |
| Response | Optional | Whether the patient got better, stayed the same or got worse on it. |
| Told to us by | Optional | Who gave this information: the patient, the guardian, or earlier records. |
| Type of note | Not marked | The kind of note. Choose Follow-up plan to record when the patient should return and what happens next. |
| Note | Required (*) | The note itself. A draft can still be edited. A signed note can only be amended, and the original stays. |
| Category | Not marked | Filter the test list by group, for example blood tests. |
| Priority | Optional (has a default) | How quickly the result is needed: routine, urgent or immediate (stat). |
| Reason for the request (type or choose) | Optional | Why the test is being requested. |
| Diagnosis | Required (*) | The diagnosis in words. |
| ICD-10 code (optional) | Optional | The international disease code. Leave empty if not known. |
| Role | Optional (has a default) | Primary is the main problem for this visit. Secondary is any other problem found. |
| How sure are you? | Optional (has a default) | How sure the clinician is: provisional, suspected or confirmed. |
| What supports it (findings, test results) | Optional | The findings and test results that support the diagnosis. |
| Notes | Optional | Any other note about the diagnosis. |
| Plan title (type or choose) | Required (*) | A short name for the treatment plan, for example the problem being treated. |
| Care setting | Optional (has a default) | Where the treatment will be given. |
| Priority | Optional (has a default) | How urgent the plan is: routine or urgent. |
| Expected end | Optional | The date the treatment is expected to finish. |
| Review date | Optional | The date the plan should be checked again. |
| Clinical notes | Optional | Any other note about the plan. |
| Medicine (type or choose from this shop | Required (*) | The medicine to order. Choose from this facility's medicines or type a name. |
| Formulation | Optional | The form of the medicine, for example tablet or syrup. |
| Strength | Optional | The strength, for example 500 mg. |
| How much for each dose? | Required (*) | How much the patient takes each time. |
| Unit of the dose | Required (*) | The unit of the dose, for example tablet or ml. |
| How is it given? | Required (*) | How the medicine enters the body. |
| Procedure (type or choose) | Required (*) | The procedure to order. Choose from the list or type a name. |
| Category | Optional | The group the procedure belongs to, for example wound dressing or injection care. |
| Materials used | Optional | Items used up during the procedure, for example gloves or a dressing. |
| Who does it | Optional | The person who will carry out the procedure. |
| How long (minutes) | Optional | About how long it takes, in minutes. |
| Instructions for the patient or nurse (optional) | Optional | Instructions for the patient or the nurse. |
| Know the shorthand? (optional) | Optional | Type a medical abbreviation to see what it means and fill the order from it. |
| When should it be given? | Required (*) | The pattern for giving the medicine, for example once, at regular intervals, at set times, or only when needed. An explanation and an example appear under the choice. |
| First dose on | Required (pre-filled with the current date and time) | The date of the first dose. |
| At what time? | Required (pre-filled with the current date and time) | The time of the first dose. |
| How much should the pharmacy give? (optional) | Optional | How much the pharmacy should give, in the smallest unit of the medicine, for example 20 for 20 tablets. If left empty, the pharmacist decides. |
| These warnings need a reason before you can continue | Required (*) | Safety warnings were found. Say why the order is still correct, so the reason is on record. |
| Why is this order being changed? | Required (*) | Why an existing order is being changed. The old order stays on record. |
| Closing note (optional) | Optional | A short note when the visit is closed. It is not needed. |
| Review date (optional) | Optional | The day the patient should come back. Must not be in the past. |
| What happens next? | Optional (but one of the review date, what happens next or instructions is needed) | What happens next: review, continue at home, return with test results, refer, admit or no further action. |
| How is the patient progressing? | Optional | How the patient is progressing. |
| Instructions for the patient (optional) | Optional | Instructions for the patient. |
| Examination sections (one box per body area) | Not marked | The examination note has one box per body area (for example general, respiratory). Fill in only the areas examined. |
| Times of day (24-hour, separated by commas) | Required (*) | The times of day to give the medicine, in 24-hour time, separated by commas, for example 08:00, 20:00. |
| Quick fill | Optional | Fills in common times for you, which you can then change. |
| Every (hours) | Required (*) | The hours between doses. |
| Number of doses | Required (*) | How many doses in total. |
| For how many days | Required (*) | For how many days the medicine is given. |
| Hours after the start when each dose is due | Required (*) | The hours after the first dose at which each later dose is due, separated by commas. |
| Days | Not marked | Days of the week the dose is given. |
| Dose | Not marked | The dose for that line. |
| Times of day | Not marked | The times of day to give it. |
| Date | Not marked | The date of one planned dose. |
| Time | Not marked | The time of one planned dose. |
| Dose (optional) | Optional | A different dose for that one planned time, if needed. |
| Pattern | Optional (has a default) | How the doses in this stage are spaced: at regular intervals, or at set times of day. |
| What is it for? | Required (*) | What the medicine is for. |
| Shortest time between doses (hours) | Required (*) | The shortest time that must pass between two doses. |
| Most doses in a day | Required (*) | The most doses allowed in one day. |
| Most total in a day (optional) | Optional | The most of the medicine, added together, allowed in one day. |
| Allowed for how many days | Optional | How many days the as-needed order stays valid. |
| Weight used (kg) | Not marked | The weight used to work out the dose. It is taken from triage when recorded. |

## Test catalogue (`investigations.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Category | Not marked | Show only tests in one group. |
| Category | Required (*) | The group the test belongs to, for example haematology. |
| Test name (type or choose) | Required (*) | The name of the test. |
| Sample / specimen (type or choose) | Optional | The sample taken from the patient for this test, for example blood or urine. |
| How is the result written? | Required (*) | How the result is written: a number, a choice such as positive or negative, or free text. |
| Choices (separate with commas) | Required if the result type is Choice | For a choice result: the allowed answers, separated by commas. |
| Units (type or choose) | Optional | The unit the result is measured in, for example mmol/L. |
| Reference range (optional) | Optional | The lowest and highest expected value (the reference range), as used by the laboratory for this test and method. |
| Reference range in words (optional) | Optional | The reference range written in words, when numbers are not enough. |
| Where the reference range comes from (needed if you give one) | Required if a reference range is given | The book, manual or laboratory the range came from. Needed when a range is given. |
| Price (optional) | Optional | The price charged for the test. |
| Start from a template (structure only) | Optional | Fills in the layout of a common test type. It never fills in units, ranges, prices, critical limits or the meaning of scale terms. |
| Scale terms, one per line (optional meaning after =) | Required for a graded scale | The terms your laboratory reports in order (for example 1+, 2+). Local terms such as Tr or Trr are kept as typed; the app never assumes their meaning. |
| Titer is reported as | Required for a titer | Whether the titer is a dilution such as 1:80 or a category from the choices. |
| Susceptibility result codes, separated by commas | Required for organism and susceptibility | The codes or words your report uses for each antibiotic result. |
| Antibiotics you test, separated by commas | Optional | The antibiotics your laboratory tests. |
| Organisms you commonly report (optional, separated by commas) | Optional | A shortcut list of organisms; others can still be typed. |
| Test method | Optional | The method used, for example the kit or technique. |
| Equipment | Optional | The analyser or equipment used. |
| Collection instructions | Optional | How the sample is collected, shown to whoever collects it. |
| Processing instructions | Optional | How the laboratory handles the sample. |
| Interpretation notes (from your approved source) | Optional | Notes from your own approved source. The app writes no interpretation itself. |
| Approval status | Required | Draft tests cannot be requested; approved tests can. |

## Laboratory results (`laboratory.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Flag | Not marked | Whether the result is inside the expected range for this test. |
| Comments | Not marked | Any comment on the result. |
| Sample number (optional) | Optional | The number written on the sample container, if your laboratory numbers samples. |
| Result (box built by the page) | Required | The result boxes are built from the test's own setup: a number box, a list of allowed results, a graded scale, a titer, one box per parameter for a panel, or organisms with an antibiotic list. Only allowed values can be saved. |
| Reason for the correction | Required when correcting | Why a verified or entered result is being replaced. The earlier result stays on record. |
| Organism | Required for each organism row | The organism found. Tick No growth instead if nothing grew. |
| Quantity or growth (optional) | Optional | How much growth, in the words your laboratory uses. |
| Comment (optional) | Optional | A note about this organism. |
| Specimen condition (optional) | Optional | A note on the specimen when accepting it. |
| Reject the specimen — reason | Required to reject | Why the specimen cannot be used. Choose from the list; Other needs an explanation. A rejected specimen ends the request. |
| Who was informed? | Required | The doctor or nurse told about a critical result. |
| How | Required | In person, by phone, by message or other. |
| Price | Required only when the test has no price | The price of this test, when the catalogue has none. |
| How is it paid? | Required | Paid in full, part paid (rest on credit), not paid (credit), or no charge (authorised). |
| Amount paid now | Required for part payment | Must be more than 0 and less than the price. |
| Payment method | Required when money is received | Cash, mobile money, card or other. |
| Name on the credit account | Required when anything is on credit | The name for the patient's credit account (the same account the pharmacy uses). |
| Due date (optional) | Optional | When the credit should be paid. |
| Reason for no charge | Required for no charge | Why the test is free. Recorded with the name of the person who authorised it. |

## Medication administration (`treatment.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Show | Not marked | Show medicines, procedures or both. |
| Look back | Not marked | How many days back to show. |
| Date this happened | Not marked | The date the medicine was given or the outcome occurred. It cannot be in the future. |
| Time this happened | Not marked | The time it happened. |
| Dose actually given (unit) | Not marked | The dose actually given. It shows the planned dose: change it only if a different amount was given. |
| Observations | Not marked | What was observed, for example how the patient responded. |
| Reaction or side effect (if any) | Not marked | Any reaction or side effect. |
| Reason (needed for everything except Given) | Not marked | Why it was not given. Needed for everything except Given. |
| Why is it being given? | Required (*) | Why an as-needed medicine is being given now. |
| Dose given (unit) | Not marked | The dose given. |
| Observations | Not marked | What was observed. |
| Reaction or side effect (if any) | Not marked | Any reaction or side effect. |
| These limits will be exceeded. Why is it still being given? | Required (*) | Shown when a limit will be exceeded. Say why it is still being given. |

## Dosing rules (`dosing-rules.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Medicine (type or choose) | Required (*) | The medicine this rule is for. |
| Source of this rule (guideline, book, policy) | Required (*) | Where the numbers come from, for example a guideline, book or policy. |
| Country / jurisdiction | Required (*) | The country whose guideline the numbers come from. |
| Version | Optional | The version or edition of the source. |
| In force from | Optional | The date the rule starts to apply. |
| Review by (date) | Optional | The date the rule should be checked again. |
| Dose unit (type or choose) | Optional | The unit of the dose. |
| Dose for each kilogram of body weight | Optional (but a rule needs at least one dose limit, a dose per kg, a warning or the high-risk tick) | The dose for each kilogram of body weight, used when the dose is worked out from weight. |
| Lowest dose for one administration | Optional (but a rule needs at least one dose limit, a dose per kg, a warning or the high-risk tick) | The lowest dose for one administration. |
| Highest dose for one administration | Optional (but a rule needs at least one dose limit, a dose per kg, a warning or the high-risk tick) | The highest dose for one administration. |
| Highest total dose in 24 hours | Optional (but a rule needs at least one dose limit, a dose per kg, a warning or the high-risk tick) | The highest total dose in 24 hours, all doses added together. |
| Lowest weight (kg) | Optional (the lowest cannot be above the highest) | The lowest body weight (kg) this rule applies to. |
| Highest weight (kg) | Optional (the lowest cannot be above the highest) | The highest body weight (kg) this rule applies to. |
| Youngest (months) | Optional (the lowest cannot be above the highest) | The youngest age (in months) this rule applies to. |
| Oldest (months) | Optional (the lowest cannot be above the highest) | The oldest age (in months) this rule applies to. |
| Routes this rule covers (separate with commas) | Optional | The routes this rule covers, separated by commas. |
| Warning for pregnancy / breastfeeding | Optional (but a rule needs at least one dose limit, a dose per kg, a warning or the high-risk tick) | A warning shown for pregnancy or breastfeeding. |
| Warning for children | Optional (but a rule needs at least one dose limit, a dose per kg, a warning or the high-risk tick) | A warning shown for children. |
| Notes | Optional | Any other note about the rule. |

## Users and access (`users.html`)

| Field | Required or optional | What it means |
|---|---|---|
| Operator name | Required (read from the code; not run, because it creates real sign-in accounts) | The name of the new operator (staff member). |
| Shop | Required (read from the code; not run, because it creates real sign-in accounts) | The shop or facility the operator works in. |
| 6-digit PIN | Required (read from the code; not run, because it creates real sign-in accounts) | A 6-digit number the operator uses to sign in. |
| Person | Not marked | Which person's access to change. |
| Shop | Not marked | Which shop or facility to set up access for. |

## Findings
- **186 fields** are labelled across these pages: 37 are marked required on the box, 16 are marked optional on the box, 98 now have their requirement stated for a form whose saving code I checked and tested, and **35 are still not marked either way**. The master plan asks that required and optional fields are clearly identified. That is now met for the forms listed above and **not yet** for the rest (plain notes, merge and sharing, laboratory result entry, administration beyond the reason rule, and the hours-after-start and weight-based order patterns). Whether a field is truly optional is decided by the code that saves it, so each remaining form needs the same check.
- **Not covered by this document:** fields the page builds in code without a visible label (for example the result box on the laboratory page, described above), and the search and filter boxes that only narrow a list.
- **Laboratory:** Developer 4 rebuilt result entry (reporting profiles, specimen steps, critical notices, payment). This section describes the new screen.
- **Hints:** the plan names frequency, route, duration, specimen and reference range. All five now have a short explanation on screen (earlier medicines: how often, route, for how long; test catalogue: sample, reference range). Developer 2's abbreviation box shows the meaning of shorthand.
