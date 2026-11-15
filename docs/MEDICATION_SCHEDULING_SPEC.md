# MEDICATION_SCHEDULING_SPEC.md
Phase 4 - Schedules and planned administrations. Built 2026-11-14.

## Schedule types
- **Once only.**
- **Regular intervals:** every N hours for a number of doses (for example every 12 hours, 3 doses = 0, 12 and 24 hours).
- **Times of day, every day:** one to many times a day for N days (quick fill for once to four times a day; all times can be edited). Times earlier than the start time on the first day are skipped.
- **Fixed times:** chosen clock times on chosen weekdays for N days.
- **Weight-based:** the dose comes from an approved rule and the weight; given at regular intervals or times of day.
- **As needed (PRN):** indication, shortest time between doses, most doses a day, optional most total a day, optional period. No planned times are made.
- **Tapering:** stages, each with its own days, times of day and dose.
- **Choose each date and time:** any list of dates and times, each with an optional own dose.
Procedures can use once, intervals, times of day, fixed times or chosen times.

## Planned administrations (`pc_treatment_events`)
One record per planned administration: planned time (UTC and the facility's local time with the time zone), planned dose, route, status. **The schedule is calculated the same way every time and each planned administration has a fixed id (order id + number), so writing a schedule twice can never create duplicates.**
- Time zone: the facility's own (default Africa/Kampala). Times are converted correctly for daylight-saving zones.
- A course is limited to 400 administrations per order.
- **Rolling window:** only the next 7 days are written at first (to save phone storage and the free-plan write quota). "Write the next days" on the order, or the banner on the Treatment screen, writes the following days; already written ones are skipped.
- Statuses stored: pending, administered, refused, missed, held, not given, cancelled. "Due now" (within 30 minutes) and "Late" (more than 30 minutes past) are shown from the time, not stored. A planned administration is never marked given automatically.

## Not in this phase
Calendar view, reminders and alarms, stock-based quantities.
