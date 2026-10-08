# Review filters release · 8 October 2026

Live: https://hub.oxeio.com/targets/review · release **471** · commit `ccbc52b788ebf894c3adcf79f560fa1bbd7f3902`.

## Behavior

- Review opens on pending skip decisions. Server-calculated chips separate pending skip, deleted, other skipped and all items. Counts are computed after the other search/reason/date filters, before pagination.
- Added reason, waiting time, sort and undated controls. Existing ASIN/job search, designer, added-by and date controls remain. Filter state works in saved/shareable views and resets page/selection. Visible-page CSV includes the active filter description and deletion timestamp.
- Date range uses skip-request time for skip items and deletion time for deleted items in Asia/Dhaka. New `deleted_at` is written on deletion; historical values are backfilled from `design_target_events` where a recorded deletion exists. Unknown legacy times remain null and can be included explicitly.
- Review-queue API access now matches the owner/manager UI. No approval or rejection was performed as part of verification.

## Validation and safety

- Exact staged source: API typecheck/lint/build and **91/91** regression tests; web typecheck/lint/build and **297/297** tests passed.
- Encrypted pre-release production backup restored to a network-isolated disposable PostgreSQL. Migration rehearsal preserved employee, target, skip and history counts; **18** deletion times were recovered in that restore. Backfill runs in one transaction with the target-history trigger temporarily disabled and restored before commit, avoiding false audit events.
- VPS build/API/web healthy; PostgreSQL container unchanged. Public health build/commit and JS bundle hash matched; anonymous Review API returned 401. Previous API/web images tagged under `/opt/oxeio-releases/review-filters-20261008` for rollback; deployed marker updated after health checks.
- Chrome owner view showed pending **5**, deleted **17**, all **22**. Deleted records displayed deletion times and remained visible under Last 7 days. Page left open on the default Pending view.
