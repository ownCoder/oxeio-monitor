# Daily designs & skips chart scale fix — 10 October 2026

## Issue

On `/targets/daily`, Today showed 1 completed design and 7 recorded skips. The chart used the completed count alone as its vertical maximum, so the skip bar received a 700% height and extended above the chart into the page header.

## Change

- The chart maximum now includes both completed and skipped counts across all displayed days.
- Each bar is capped at 100% of the chart height; zero remains invisible and small nonzero values retain the existing 5% minimum.
- Added regression cases for skip-heavy days, multiple days, empty data, and the height cap.
- No API, database, assignment, or skip-decision rules changed.

## Verification

- Local frontend: 303/303 tests passed, typecheck and lint passed, production build passed.
- VPS release 478 / `edf0686eaad7927c23d4fb75f756698268324890`: API and web healthy, PostgreSQL container unchanged, public health build/commit and JS bundle hash matched the containers; protected daily endpoint returned 401 anonymously.
- Chrome owner session, Today: live 3 completed and 10 skips rendered as 30% and 100% bars, both within the chart. The screenshot showed no overlap with the page header.
- Chrome owner session, 7 days: all 14 bars across 7 dates stayed within the chart (maximum height 100%).

## Release

- Source mirror: `.release-salary/oxeio-monitor`.
- Deployment files: `.release-salary/daily-chart-scale-source.tar` and `.release-salary/daily-chart-scale-deploy-20261010.sh`.
- VPS release directory: `/opt/oxeio-releases/daily-chart-scale-20261010`.
