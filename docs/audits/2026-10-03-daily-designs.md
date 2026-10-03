# Daily staff design completions and skips — 3 October 2026

## Live behaviour

- Owner/manager: **Design Pool → Daily designs & skips** shows each active-on-that-day staff member's completed, skipped and pending counts by Dhaka date. Default last seven days; custom range up to 31 days; staff filter and date shortcuts. Existing cohort Skip-rate details remain below.
- Completed uses `design_targets.completed_at` and the target's current `assigned_to_id`, matching the established Attendance completion attribution. Skipped uses automatic/approved `design_skip_requests` on `requested_at`; pending is separate and rejected excluded. Successful repeated requests count as separate actions. Decisions can change historical request-day counts.
- Skip ledger began during 27 September 2026. Before 28 September, skipped/pending values are `null` and display “—”, never a false zero. The API is owner/manager-only and date/range validated.

## Verification and deployment

- Clean local source `.release-salary/oxeio-monitor`; five scoped files: `server/src/targets/target-insights.controller.ts`, `server/test/target-insights.e2e.spec.ts`, `web/src/api/targetInsights.ts`, `web/src/pages/AllTargetsPage.tsx`, `web/src/pages/targets/Insights.tsx`. Dirty main checkout was not deployed.
- Initial isolated test found a PostgreSQL alias syntax error; corrected before deployment. Final isolated disposable database: daily insights and skip-review integration **16/16**, frontend **295/295**, API/web typecheck, lint and build passed. Production data was not used for tests.
- VPS release `/opt/oxeio-releases/daily-designs-20261003`; guarded scoped commit **`69a456a88691140504a094e5c5fe5278ccdf8053`**, build **444**. API/web containers healthy; public health build/commit matched; public JS SHA256 matched container asset; anonymous daily endpoint returned 401. PostgreSQL container unchanged. No migration or seed.
- Rollback image tags: `oxeio-api:before-daily-designs-20261003` and `oxeio-web:before-daily-designs-20261003` (build 440). Use both compose files if rollback is needed. Source bundle, validation logs, source hashes, public health and bundle evidence are in the release directory.

## Practical limit

- Completed counts reflect the current target record; undo/reassignment can alter a past day's attribution. Skipped counts reflect current review decisions on the original request day. This report is an operational view, not an immutable event ledger. Authenticated live browser view was not exercised; API integration and production build/access checks passed.
