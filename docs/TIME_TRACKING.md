# Time tracking (tidsregnskap)

Every hour spent on the project is recorded in `docs/time/timelog.csv`. The log supports
sprint reporting, project costing and, where relevant, documentation for R&D tax incentive
claims (Skattefunn) or grant reporting. Check requirements with your accountant; this file
describes the project's own convention and is not accounting advice.

## Rules

1. One row per work session. Log it the same day.
2. Columns: `date,person,sprint,task_id,category,hours,note`.
   - `date`: ISO 8601 (`2026-11-16`).
   - `person`: a stable handle. AI-assisted work is logged by the human who directed and reviewed it, with `-ai` noted in `note`, so that hours reflect human effort. Do not log machine run time.
   - `sprint`: `S1`, `S2`, ...
   - `task_id`: an ID from the backlog in `docs/SCRUM.md` (`CE-n`). Work with no backlog item needs one first.
   - `category`: one of `development`, `research`, `documentation`, `review`, `meeting`, `ops`, `legal`.
   - `hours`: decimal, non-zero, at most 24 in absolute value per row (negative only for corrections). Round to 0.25.
   - `note`: short, no commas.
3. Never edit or delete old rows. To correct a mistake, add a new row with the same `task_id` and a **negative** `hours` value (and `note` starting `correction:`), then a row with the right value.
4. Estimates are not hours. Only record time actually spent.

## Reporting

```
npm run time:report
```

prints total hours per sprint, per task and per person, and fails on malformed rows.
Compare hours to story points at each sprint review to calibrate estimates.

## Privacy

The log contains handles, not personal data beyond what is needed for costing. Do not put
customer or counterparty information in `note`.
