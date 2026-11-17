# Field-by-field explanation of the patient-care forms
Developer 3, master implementation plan deliverable 9. **Generated from the real forms** (every labelled field in the nine patient-care pages) and checked by `tests/fields-doc.test.js`, which fails if a labelled field is added to a page without being explained here.

How to read it: *On screen it is marked* shows what the form itself tells the user today: **Required (*)**, **Optional**, or **Not marked**. "Not marked" does not mean optional: it means the screen does not say. See "Findings" at the end.

Where a field is explained on the screen itself (a short grey line under the box), the wording here is the same.

## Patient registration (`patients.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Full name | Required (*) | The patient's full name as the patient or guardian gives it. |
| Sex | Required (*) | Female, male, other or unknown, as recorded for the patient. |
| Age | Not marked | Choose how the age is known: exact date of birth, an estimated age, or unknown. |
| Date of birth | Not marked | The exact date of birth, typed as DD/MM/YYYY or picked from the calendar. The age is worked out and shown under the box. |
| Years | Not marked | Estimated age: whole years. |
| Months | Not marked | Estimated age: months (for babies and small children). |
| Days | Not marked | Estimated age: days (for newborns). |
| Phone number | Not marked | A number the facility can use to reach the patient or guardian. |
| Address | Not marked | Where the patient lives or can be found. |
| Village | Not marked | The village or local area. |
| District | Not marked | The district. |
| Name | Not marked | Next of kin: the name of the relative to contact about the patient's care. |
| Relationship | Not marked | Next of kin: how this person is related to the patient. |
| Phone | Not marked | Next of kin: phone number. |
| Name | Not marked | Emergency contact: the person to call first in an emergency. It can be the same person as the next of kin. |
| Relationship | Not marked | Emergency contact: how this person is related to the patient. |
| Phone | Not marked | Emergency contact: phone number. |
| Different person? Say why | Required or optional (depends on the match) | Shown when a similar patient already exists. Say why this is a different person, so that a duplicate record is not created by mistake. |

## Patient profile: history, allergies, sharing, merging (`patient.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Find the other record | Not marked | Search for the other record of the same patient that should be joined to this one. |
| Which record do you keep? | Not marked | Choose which of the two records stays. The other is joined into it and kept for history. |
| Reason (type or choose) | Required (*) | Why the records are being joined. It is kept in the audit trail. |
| Type | Not marked | The kind of history entry: chronic illness, previous diagnosis, admission or operation, current or previous medicine, family history, social history, or pregnancy / breastfeeding. |
| Details | Required (*) | The details of the history entry. |
| When (optional) | Optional | When it started, if known. |
| Allergic to (substance) | Required (*) | The medicine or substance the patient reacts to. |
| Reaction | Not marked | What happens when the patient is exposed to it. |
| Severity | Not marked | Mild, moderate or severe. See the explanation under the box. |
| Date noted | Not marked | The date the allergy was noted. |
| Service needed (optional) | Optional | The service the patient is being sent for, if any. |
| Business (type to search, or choose) | Not marked | The business that will be allowed to see this patient's record. |
| Facility | Not marked | The facility inside that business. |
| Why (type or choose) | Not marked | Why the record is being shared, for example a referral. |
| How did they agree? | Not marked | How the patient (or guardian) agreed to the sharing: said yes (verbal) or signed (written). |
| Who agreed? | Required (*) | The person who agreed: the patient or their guardian. |

## Opening a visit and vital-sign ranges (`encounters.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Patient | Required (*) | Search for the patient by name or number. |
| Type of visit | Not marked | The kind of visit: outpatient, emergency, follow-up, procedure or pharmacy. |
| Reason for visit (type or choose) | Not marked | Why the patient came, in a few words. |
| Source of these ranges | Required (*) | Where the normal ranges for vital signs come from, for example a guideline or the facility policy. |
| Effective from | Not marked | The date from which these ranges are used. |
| Lowest and highest normal value (per vital sign) | Not marked | The lowest and highest value counted as normal for each vital sign (one pair of boxes per vital sign). Values outside the range are highlighted. |

## The visit screen: triage, complaints, earlier medicines, notes, tests, diagnosis, treatment plan and orders, follow-up, closing (`encounter.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Temperature (°C) | Not marked | Body temperature in degrees Celsius. |
| Pulse (/min) | Not marked | Heart beats in one minute. |
| Blood pressure (mmHg) | Not marked | Blood pressure in mmHg: the top (systolic) number and the bottom (diastolic) number. |
| Breathing rate (/min) | Not marked | Breaths in one minute. |
| Oxygen saturation (%) | Not marked | Oxygen saturation: the percentage of oxygen in the blood, read from a finger sensor. |
| Weight (kg) | Not marked | Weight in kilograms. It is reused for weight-based doses and guideline checks, so it does not need to be typed again. |
| Height (cm) | Not marked | Height in centimetres. |
| Blood glucose | Not marked | Blood glucose (sugar) reading. Choose the unit your meter shows. |
| Pain score (0-10) | Not marked | 0 means no pain. 10 means the worst pain imaginable. |
| Consciousness | Not marked | How awake the patient is. See the explanation under the box. |
| MUAC (cm) - children | Not marked | Mid-upper arm circumference in centimetres, measured with a tape. Mostly used for young children. |
| Triage category (your decision) | Not marked | Your own decision about how urgent the patient is. The system does not set it for you. |
| Triage notes | Not marked | Anything else noticed during triage. |
| Complaint | Required (*) | The main complaint, in the patient's own words or a short name. |
| Started (type or choose) | Not marked | When it started, for example today or 3 days ago. |
| Lasted (number) | Not marked | The number for how long: used with the unit in the next box. |
| How long has the patient had this complaint? (unit) | Not marked | The unit for how long: hours, days, weeks, months or years. |
| Severity | Not marked | How bad the patient says it is. |
| Progression | Not marked | Whether the complaint is getting better, worse, staying the same, or comes and goes. |
| Other symptoms with it | Not marked | Other symptoms that come with this complaint. |
| Makes it worse | Not marked | Anything that makes the complaint worse. |
| Makes it better | Not marked | Anything that makes the complaint better. |
| Had it before? | Not marked | Whether the patient has had this complaint before. |
| Notes | Not marked | Any other detail about the complaint. |
| Medicine | Required (*) | A medicine the patient took before this visit. |
| Strength | Not marked | The strength, for example 500 mg. |
| Dose | Not marked | How much was taken each time. |
| How often | Not marked | How often it was taken. |
| Route | Not marked | How it entered the body. |
| For how long | Not marked | How long it was taken. |
| Last dose taken | Not marked | The date of the last dose taken. |
| Course | Not marked | Whether the patient is still taking it, finished it, or stopped early. |
| Response | Not marked | Whether the patient got better, stayed the same or got worse on it. |
| Told to us by | Not marked | Who gave this information: the patient, the guardian, or earlier records. |
| Type of note | Not marked | The kind of note. Choose Follow-up plan to record when the patient should return and what happens next. |
| Note | Required (*) | The note itself. A draft can still be edited. A signed note can only be amended, and the original stays. |
| Category | Not marked | Filter the test list by group, for example blood tests. |
| Priority | Not marked | How quickly the result is needed: routine, urgent or immediate (stat). |
| Reason for the request (type or choose) | Not marked | Why the test is being requested. |
| Diagnosis | Required (*) | The diagnosis in words. |
| ICD-10 code (optional) | Optional | The international disease code. Leave empty if not known. |
| Role | Not marked | Primary is the main problem for this visit. Secondary is any other problem found. |
| How sure are you? | Not marked | How sure the clinician is: provisional, suspected or confirmed. |
| What supports it (findings, test results) | Not marked | The findings and test results that support the diagnosis. |
| Notes | Not marked | Any other note about the diagnosis. |
| Plan title (type or choose) | Required (*) | A short name for the treatment plan, for example the problem being treated. |
| Care setting | Not marked | Where the treatment will be given. |
| Priority | Not marked | How urgent the plan is: routine or urgent. |
| Expected end | Not marked | The date the treatment is expected to finish. |
| Review date | Not marked | The date the plan should be checked again. |
| Clinical notes | Not marked | Any other note about the plan. |
| Medicine (type or choose from this shop | Required (*) | The medicine to order. Choose from this facility's medicines or type a name. |
| Formulation | Not marked | The form of the medicine, for example tablet or syrup. |
| Strength | Not marked | The strength, for example 500 mg. |
| How much for each dose? | Required (*) | How much the patient takes each time. |
| Unit of the dose | Required (*) | The unit of the dose, for example tablet or ml. |
| How is it given? | Required (*) | How the medicine enters the body. |
| Procedure (type or choose) | Required (*) | The procedure to order. Choose from the list or type a name. |
| Category | Not marked | The group the procedure belongs to, for example wound dressing or injection care. |
| Materials used | Not marked | Items used up during the procedure, for example gloves or a dressing. |
| Who does it | Not marked | The person who will carry out the procedure. |
| How long (minutes) | Not marked | About how long it takes, in minutes. |
| Instructions for the patient or nurse (optional) | Optional | Instructions for the patient or the nurse. |
| Know the shorthand? (optional) | Optional | Type a medical abbreviation to see what it means and fill the order from it. |
| When should it be given? | Required (*) | The pattern for giving the medicine, for example once, at regular intervals, at set times, or only when needed. An explanation and an example appear under the choice. |
| First dose on | Not marked | The date of the first dose. |
| At what time? | Not marked | The time of the first dose. |
| How much should the pharmacy give? (optional) | Optional | How much the pharmacy should give, in the smallest unit of the medicine, for example 20 for 20 tablets. If left empty, the pharmacist decides. |
| These warnings need a reason before you can continue | Required (*) | Safety warnings were found. Say why the order is still correct, so the reason is on record. |
| Why is this order being changed? | Required (*) | Why an existing order is being changed. The old order stays on record. |
| Closing note (optional) | Optional | A short note when the visit is closed. It is not needed. |
| Review date (optional) | Optional | The day the patient should come back. Must not be in the past. |
| What happens next? | Not marked | What happens next: review, continue at home, return with test results, refer, admit or no further action. |
| How is the patient progressing? | Not marked | How the patient is progressing. |
| Instructions for the patient (optional) | Optional | Instructions for the patient. |
| Examination sections (one box per body area) | Not marked | The examination note has one box per body area (for example general, respiratory). Fill in only the areas examined. |
| Times of day (24-hour, separated by commas) | Required (*) | The times of day to give the medicine, in 24-hour time, separated by commas, for example 08:00, 20:00. |
| Quick fill | Not marked | Fills in common times for you, which you can then change. |
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
| Pattern | Not marked | How the doses in this stage are spaced: at regular intervals, or at set times of day. |
| What is it for? | Required (*) | What the medicine is for. |
| Shortest time between doses (hours) | Required (*) | The shortest time that must pass between two doses. |
| Most doses in a day | Required (*) | The most doses allowed in one day. |
| Most total in a day (optional) | Optional | The most of the medicine, added together, allowed in one day. |
| Allowed for how many days | Not marked | How many days the as-needed order stays valid. |
| Weight used (kg) | Not marked | The weight used to work out the dose. It is taken from triage when recorded. |

## Test catalogue (`investigations.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Category | Not marked | Show only tests in one group. |
| Category | Required (*) | The group the test belongs to, for example haematology. |
| Test name (type or choose) | Required (*) | The name of the test. |
| Sample / specimen (type or choose) | Not marked | The sample taken from the patient for this test, for example blood or urine. |
| How is the result written? | Required (*) | How the result is written: a number, a choice such as positive or negative, or free text. |
| Choices (separate with commas) | Not marked | For a choice result: the allowed answers, separated by commas. |
| Units (type or choose) | Not marked | The unit the result is measured in, for example mmol/L. |
| Reference range (optional) | Optional | The lowest and highest expected value (the reference range), as used by the laboratory for this test and method. |
| Reference range in words (optional) | Optional | The reference range written in words, when numbers are not enough. |
| Where the reference range comes from (needed if you give one) | Not marked | The book, manual or laboratory the range came from. Needed when a range is given. |
| Price (optional) | Optional | The price charged for the test. |

## Laboratory results (`laboratory.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Flag | Not marked | Whether the result is inside the expected range for this test. |
| Comments | Not marked | Any comment on the result. |
| Sample number (optional) | Optional | The number written on the sample container, if your laboratory numbers samples. |
| Result (box built by the page) | Not marked | The result box is built by the page for each test: a number box for numeric tests, a list of choices, or a text box for a report. |

## Medication administration (`treatment.html`)

| Field | On screen it is marked | What it means |
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

| Field | On screen it is marked | What it means |
|---|---|---|
| Medicine (type or choose) | Required (*) | The medicine this rule is for. |
| Source of this rule (guideline, book, policy) | Required (*) | Where the numbers come from, for example a guideline, book or policy. |
| Country / jurisdiction | Required (*) | The country whose guideline the numbers come from. |
| Version | Not marked | The version or edition of the source. |
| In force from | Not marked | The date the rule starts to apply. |
| Review by (date) | Not marked | The date the rule should be checked again. |
| Dose unit (type or choose) | Not marked | The unit of the dose. |
| Dose for each kilogram of body weight | Not marked | The dose for each kilogram of body weight, used when the dose is worked out from weight. |
| Lowest dose for one administration | Not marked | The lowest dose for one administration. |
| Highest dose for one administration | Not marked | The highest dose for one administration. |
| Highest total dose in 24 hours | Not marked | The highest total dose in 24 hours, all doses added together. |
| Lowest weight (kg) | Not marked | The lowest body weight (kg) this rule applies to. |
| Highest weight (kg) | Not marked | The highest body weight (kg) this rule applies to. |
| Youngest (months) | Not marked | The youngest age (in months) this rule applies to. |
| Oldest (months) | Not marked | The oldest age (in months) this rule applies to. |
| Routes this rule covers (separate with commas) | Not marked | The routes this rule covers, separated by commas. |
| Warning for pregnancy / breastfeeding | Not marked | A warning shown for pregnancy or breastfeeding. |
| Warning for children | Not marked | A warning shown for children. |
| Notes | Not marked | Any other note about the rule. |

## Users and access (`users.html`)

| Field | On screen it is marked | What it means |
|---|---|---|
| Operator name | Not marked | The name of the new operator (staff member). |
| Shop | Not marked | The shop or facility the operator works in. |
| 6-digit PIN | Not marked | A 6-digit number the operator uses to sign in. |
| Person | Not marked | Which person's access to change. |
| Shop | Not marked | Which shop or facility to set up access for. |

## Findings
- **186 fields** are labelled across these pages: 37 are marked required, 16 are marked optional, and **133 are not marked either way**. The master plan asks that required and optional fields are clearly identified. That is only partly met: the unmarked fields need a decision field by field, because whether a field is truly optional is decided by the code that saves it, and I have not changed any of that.
- **Not covered by this document:** fields the page builds in code without a visible label (for example the result box on the laboratory page, described above), and the search and filter boxes that only narrow a list.
- **Laboratory:** Developer 4 is rebuilding the result entry (reporting profiles). This section describes the current screen and will need updating.
- **Hints:** the plan names frequency, route, duration, specimen and reference range. All five now have a short explanation on screen (earlier medicines: how often, route, for how long; test catalogue: sample, reference range). Developer 2's abbreviation box shows the meaning of shorthand.
