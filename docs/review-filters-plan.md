# Review page filters — implemented 8 October 2026

Scope: https://hub.oxeio.com/targets/review. Implemented in release 471 (`ccbc52b788ebf894c3adcf79f560fa1bbd7f3902`). See [release record](audits/2026-10-08-review-filters-release.md).

## Current state

- The Review page reuses the Design Pool target list, locked to the `to_review` queue. It offers ASIN/job-number search, designer, added-by, skip-request date range, Today/Last 7 days, refresh, saved/shareable views, and current-page CSV export.
- The owner view showed 22 matching items on 8 October: five pending skip decisions followed by 17 deleted designs awaiting review. The list mixes decisions needed now with older cleanup work.
- The server applies the same `skipRequestedAt` date predicate to the whole Review queue. Deleted rows without a skip request can disappear when a date is selected. The page warns about this, but the control still invites a misleading empty result.
- Page Not Found skips are auto-resolved under the current rule and should not be presented as awaiting a manager's skip decision. Deleted Page Not Found targets can still be in the Review queue.

## Implemented change

1. Put four quick filters above the list: **All to review**, **Pending skip decisions**, **Deleted to review**, and **Other skipped**, each with a server-calculated count. Default to Pending skip decisions for the daily manager workflow; keep an explicit All view.
2. Add **Reason**: Page Not Found, Event, Copyright, Others, and legacy/unknown where applicable. Combine it with queue type, designer, search and dates on the server, before pagination.
3. Add **Waiting time** for pending decisions: Today, older than 24 hours, older than 7 days. Show the elapsed time next to each pending item. Avoid using this for deleted records lacking a trustworthy decision timestamp.
4. Replace the ambiguous date range with a clearly labeled date basis. Pending skips use skip-request time in Asia/Dhaka. Deleted items use a new deletion timestamp, backfilled from target history where available. Legacy/undated items remain explicitly selectable.
5. Add sort choices: oldest pending first, newest request first, and newest deletion first where a reliable deletion time exists. Pending items remain visually distinct from deleted items.
6. Keep filter state in shareable URLs and saved views. Show active filter chips and a one-click clear action; changing a filter resets page and selected rows. CSV exports only the visible page and labels the current filters.

## Validation

- Isolated API and web suites, encrypted production backup restore/migration drill, and Chrome owner view passed. Manager browser view was not tested; API role guard limits Review queue to owner/manager. No bulk approval or bulk rejection was added.
