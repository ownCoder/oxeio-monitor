# Daily designs & skips date presets · 8 October 2026

Live: https://hub.oxeio.com/targets/daily · release **473** · commit `6b3575c3eedc3c35d47a072e6970646f072ef5b5`.

## Change

- Period control now offers Today, Yesterday, 7 days, 14 days, 30 days, This month, Year to Date, This Year and Custom. From/To dates stay visible; editing either switches to Custom. Rolling ranges include today in Asia/Dhaka.
- Year to Date selects 1 January through today. This Year selects 1 January through 31 December. The daily API accepts a full calendar year (up to 366 days) and omits future activity rows. The seven-day chart also stops at today.
- This is a report UI/API change only: no migration, seed, design assignment, skip decision or salary data update.

## Validation and deployment

- Isolated source mirror `.release-salary/oxeio-monitor`: web typecheck, lint, build and **300/300** frontend tests passed; server typecheck passed. Targeted backend integration test was added but could not run locally because this mirror has no `DATABASE_URL` test fixture.
- Exact six-file source bundle and guarded deploy script: `/opt/oxeio-releases/daily-periods-20261008`. VPS API/web healthy, PostgreSQL container unchanged, public health build/commit and public JS hash matched, anonymous full-year daily API returned 401. Previous API/web image tags kept for rollback. No migration or seed ran.
- Chrome owner session showed all presets; Yesterday selected 2026-10-07 to 2026-10-07 and This Year selected 2026-01-01 to 2026-12-31 with a populated report. Page was left open on default 7 days.
