> **Follow-up — 26 September 2026:** the system audit fixes and matched source/API/web

> **27 September 2026 — Production expansion:** অনুমোদিত Studio নকশা Production Board, History drawer, Design Review, Workload, Quality, Action digest, System checks ও Product results-এ প্রসারিত হয়েছে। নতুন scope ও release সীমা [production plan](production-expansion-plan.md)-এ আছে।
> deployment are tracked in [the repair ledger](audits/2026-09-26-fix-tracker.md).
> Release notes below describe the preceding Studio-only deployments.

# Studio dashboard redesign

Approved direction: Studio (26 September 2026).

## Implemented

- Shared application shell: desktop sidebar, grouped role-filtered navigation,
  account identity, page breadcrumb, theme switch and sign out. Mobile keeps
  every permitted destination in a horizontally scrollable navigation row.
- Live Board: four summary cards, a seven-day Designs/Hours chart, current team
  status and a full-width staff table. Worklog and Reports remain directly linked.
- Existing hourly activity, app usage, leader windows, monthly progress and
  fewest-hours panels remain available below the overview.
- Design totals count completed designs, including a genuine zero when designers
  are present. Unknown tracking days keep dashed marks and em dashes.
- Per-panel loading and failure states retain the last successful response and
  show a retry action. The main board keeps its refresh time visible.

The design uses the existing API contracts, role restrictions, timezone and
polling intervals (15 seconds for status, two minutes for summaries). No screenshot
polling was added to the Live Board. Worklog, payroll and tracking calculations
are unchanged.

## Workspace prerequisite

Before this work, `admin.ts`, `reports.ts` and `targets.ts` were missing while
their implementations existed under `(1)` filenames. Small re-export files now
restore the canonical import paths without editing those local implementations.
The unrelated server filename changes and existing documentation edits were left
as found.

## Validation

- Production build and TypeScript pass; Vite reports a bundle-size warning.
- ESLint passes. All 256 existing web tests pass.
- Built React app checked with isolated sample API responses: chart toggle,
  desktop dark mode, 390px mobile light mode, manager visibility, empty board
  and request failure. The mobile page has no horizontal document overflow.
- Preview fixtures are outside the repository and are not in the production build.
- Live production data and deployment have not been verified or changed.

## Information restored (26 September)

Restored average time, daily target, yesterday comparison, off/no-target count,
owner-only alert count and title, pace emphasis, and the LIVE/STALE refresh header.
Hours and designs now have separate weekly charts with totals; the hours chart
again shows its target guide. Hourly activity is above the table, with designs,
apps and fewest-hours summaries beside the table on wide screens.

Validation: build, lint and 256 tests pass. Sample-data browser checks confirm
all nine sections, six owner metrics, hidden manager alerts, and no document
horizontal overflow at a 390px viewport. Production deployment is recorded in
studio-deployment.md.
