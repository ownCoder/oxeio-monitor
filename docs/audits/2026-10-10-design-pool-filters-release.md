# Design Pool filters release · 10 October 2026

Live: https://hub.oxeio.com/targets/all · release **476** · commit `584de27075252b165d0d36b01d1b5fcd0003e832`.

## Behavior

- The expanded Filters panel now includes **Work progress** (in hand, not started/started), **Skip or delete reason** (Page Not Found, Event, Copyright, Others), **Added from/to** in Dhaka time, and **Sort Design Pool** (newest/oldest activity or added date). Existing activity dates, designer, added-by, status and queue controls remain.
- Filters run in the API before pagination and count. Selecting work progress switches to In hand; selecting a reason searches skipped/deleted targets. Queue/status changes clear incompatible progress/reason selections. All new values are included in saved views and shareable links, and Reset all filters restores the default sort. Review's separate filters remain unchanged.
- No target status, assignment, skip decision, salary data, migration or seed was changed.

## Validation

- Isolated source mirror `.release-salary/oxeio-monitor`: web typecheck/lint/build and **301/301** tests passed. Server typecheck/lint/build and **1256 database-free tests passed, one skipped**. A database integration regression was added but could not run locally because this PC has no test PostgreSQL connection.
- Exact seven-file bundle and guarded VPS deploy: `/opt/oxeio-releases/design-pool-filters-20261010`. API/web healthy, PostgreSQL container unchanged, public build/commit and JS hash matched, anonymous filtered endpoint returned 401. Previous API/web image tags retained for rollback.
- Owner Chrome session: started **6**, not started **261**, Page Not Found **254** matching targets; Added from 2026-10-01 **1,470**; oldest-added sort and shareable link retained both date and sort. Counts are live snapshots at verification time. Page was left with Filters expanded and selections reset.
