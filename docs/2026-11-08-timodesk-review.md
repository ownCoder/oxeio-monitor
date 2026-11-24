# Timodesk feature review and oXeio comparison

Reviewed 8 November 2026. Timodesk's public product pages, fourteen feature categories, help documentation, pricing, security, downloads and release notes describe a general time and project tracking product. Its clearest strengths for oXeio are task-centred evidence, missing-time approval, team-scoped management and consistent reporting controls. oXeio already has much of the underlying monitoring and substantially more design-specific production workflow.

This is a public-documentation comparison against oXeio's deployed-source mirror and current-state records. Timodesk's signed-in dashboard and desktop binaries were not tested. A few feature/help URLs returned fetch errors; related official documentation supplied the relevant details. Product claims below describe the published offering, rather than independently measured reliability.

## Core feature comparison

| Timodesk feature | What they publish | oXeio position and useful extension |
|---|---|---|
| [Time tracking](https://timodesk.com/features/time-tracking) | Desktop sessions against a task, offline sync | Exists: Windows agent, active/idle/locked states, offline handling, device controls. Task-selected tracking and macOS/Linux would be additions. |
| [Project time](https://timodesk.com/docs/projects) | Project/task totals with related time, apps and screenshots | Partial: design job-number file traces and target history exist. General project hierarchy and a complete design evidence view would extend them. |
| [Time calendar](https://timodesk.com/docs/time-calendar) | Month cards with member/project drill-down | Partial: Monthly heat grid, Worklog and My Data exist. Calendar navigation and a consistent click-through day view would improve access. |
| [Manual time](https://timodesk.com/features/manual-time) | Staff requests, reviewer decisions, overlap checks and explicit manual labels | Partial: owner can create/revoke audited time adjustments. There is no equivalent staff request queue. Adding one changes the previous owner-only adjustment policy and requires a deliberate product decision. |
| [Project management](https://timodesk.com/features/project-management) | Custom board columns, list/calendar, estimates, subtasks, labels and mentions | Partial: Production Board, workload, priority/due dates, previews, pinned comments and history exist. Custom task boards and estimate-versus-actual views remain useful gaps. |
| [Screenshots](https://timodesk.com/features/screenshots) | Task-linked captures, member settings and intervals | Exists: filtered screenshot gallery, multi-monitor metadata, protected access and retention. Direct design linkage and a combined evidence view are incomplete. |
| [Activity levels](https://timodesk.com/features/activity-levels) | Input percentage, separate keyboard/mouse measures and activity patterns | Partial: oXeio has active/idle/locked time, app usage and time heatmaps. Those are not the same metric as keyboard/mouse activity percentage. Quality should be measured from delivered design work. |
| [Apps and websites](https://timodesk.com/features/app-website-usage) | Member/project/task breakdown including full URLs | Exists for apps and domains. oXeio intentionally keeps domain rather than full URL under ADR-013; richer project/design grouping is preferable to collecting more browsing detail. |
| [Team dashboard](https://timodesk.com/features/team-dashboard) | Team timeline, live tasks, period comparisons, performance map and Action Center | Exists: Live Board, trends, alerts, Team snapshot and day pulse. Add unified period controls, stronger actionable links and workload/quality comparisons. |
| [Team and members](https://timodesk.com/features/team-members) | Invite approvals, team managers and scoped teams | Staff roles/enrollment exist. Dedicated team-manager visibility and approved invitation links would be additions. |
| [Timesheets](https://timodesk.com/features/timesheets-exports) | Monthly PDF, per-member sheets and adjustable highlighter | Reports and Monthly Excel already exist. Staff self-service monthly PDF and user-selected highlighting are useful gaps. |
| [Reports](https://timodesk.com/features/reports-analytics) | Built-in reports and daily/weekly emails | Exists: reports, daily email/weekly Telegram digest code and KIA. Per-staff personal digest preferences and verified delivery UX are improvements, not a completely missing digest feature. |
| [Performance](https://timodesk.com/features/performance-leaderboards) | Rankings and monthly recognition PDF/email | Top/fewest-hours views and KIA praise exist. A quality-aware monthly recognition record would add value. |
| [Client portal](https://timodesk.com/features/client-portal) | Read-only client login, project/page selection, optional hidden names | Absent as a dedicated external client role. Useful if oXeio handles outside client work; low priority for internal Amazon design production. |

## Best ideas to adapt first

1. **One design evidence view.** Extend the existing target drawer with clearly attributed active time, screenshots, file traces, versions, checklist results, comments and history. Reuse the existing data rather than creating a second design record. A screenshot-to-design link needs an explicit capture context or honest inferred label.
2. **Action Center with next actions.** Combine pending skip reviews, owed replacements, overdue/unstarted work, rework, missing agent data and unusually long days. Each item opens the exact relevant record. Suppress unchanged reminders and distinguish an offline agent from absence.
3. **Storage and retention dashboard.** Show screenshot/database/backup/Docker usage separately, retention status, growth and last cleanup. Private S3-compatible screenshot storage can be a later option. The existing disk audit identified old tagged Docker images as the principal retention issue; moving screenshots alone would not resolve it.
4. **Missing-time requests with owner review.** Require date/time/reason, check overlaps, prevent self-approval, cap the request window and label approved additions. Keep raw tracked segments intact. Because this affects payroll, start disabled and retain owner control; do not adopt automatic approval by default.
5. **Make current tables easier to use.** Timodesk saves project column choices to the account and uses active-filter chips. oXeio already has saved/shared Pool filters; add account-synced visible columns, clear active chips and consistent reset controls across Pool, Review, Screenshots and reports. [Column and filter documentation](https://timodesk.com/docs/projects).

Next: design estimates versus actual time by comparable work type, a calendar view, a bulk staff-policy grid, and staff monthly PDF. Team-scoped managers become valuable with more departments. Browser-toolbar monitoring and macOS/Linux agents should follow demonstrated usage, because the current office is Windows-based. [Tracking-policy grid](https://timodesk.com/docs/tracking-policy), [platforms and extensions](https://timodesk.com/download).

For a performance map, compare delivered/accepted designs, target completion, rework and credited hours, with sample counts and clear definitions. A keyboard activity percentage alone is unsuitable for assessing design quality. Timodesk itself says its ranking measures hours and input, and can be gamed. [Published ranking limitations](https://timodesk.com/features/performance-leaderboards).

## Limits and practices to avoid copying

- The own-storage guide requires public-read screenshot URLs, describes plain FTP rather than SFTP/FTPS, and says failed own-storage uploads have no retained copy/retry. Adapt the storage choice and verification UI with private buckets, short-lived access and retry handling. [Storage guide](https://timodesk.com/docs/storage-setting).
- Their monthly timesheet infers holidays from days with no recorded time. Retain oXeio's configured holidays, leave and work-policy rules; a tracking outage must not silently become a holiday. [Timesheet semantics](https://timodesk.com/docs/monthly-timesheet).
- Their monthly recognition is based on most tracked hours. For oXeio, quality, completion and rework should accompany hours. [Performance](https://timodesk.com/features/performance-leaderboards).
- They explicitly list no Gantt charts, task dependencies, recurring tasks, task templates, file attachments or project budgets. Their timesheet supports an invoice but does not create client invoices or store billing rates. These should not be assumed capabilities. [Project-management limits](https://timodesk.com/features/project-management), [timesheet limits](https://timodesk.com/features/timesheets-exports).
- There is no mobile app. Public download/release pages returned different cached version labels (2.0.6 and 2.0.7), so the actual downloadable version was not verified. [Downloads](https://timodesk.com/download), [releases](https://timodesk.com/release).

## Product and website presentation

The public site organises features by track, review and report, gives each feature a concrete workflow and a limits section, and connects setup guides to the relevant feature. oXeio can use the same clarity in a Getting started checklist and contextual help: install/link the agent, confirm tracking, explain design targets and skips, then show a first report. Agent update support already exists in oXeio; clearer offline/sync/permission messages and an update history can improve it without replacing the update system.

Published pricing is $1 per member who actually tracked in a month, all features on one plan, with a 15-day trial. That is a useful benchmark, not an instruction to replace oXeio or a verified long-term operating cost. [Pricing](https://timodesk.com/pricing). Their security page documents HTTPS, roles and transparent tracking notifications; this review is not a security audit or certification assessment. [Security](https://timodesk.com/security).

## oXeio evidence

Current deployment context: [current-state](current-state.md), [Office operations](office-workspace-operations.md), [Pool operations](design-pool-operations.md), [Salary operations](salary-operations.md), [Telegram operations](telegram-ai-operations.md). The older introductory deployment warning in `production-operations.md` is superseded by the later deployment entries in current-state.

Source reviewed in `.release-salary/oxeio-monitor`: `server/prisma/schema.prisma`; dashboard, adjustments, activity, screenshots, production, digest and me services/controllers; `server/src/targets/file-trace.service.ts`; Live Board, Monthly, My Data and Production web pages. WorkPolicy provides idle thresholds, capture slots and windows via employee policy assignment; a new grid would improve controls already partly present. `TimeAdjustment` is an owner-created correction, not a staff approval request. `AppUsage.domain` explicitly excludes full URLs. Daily/weekly digest support is present; this review did not verify current SMTP delivery settings.

No application code, live tracking policy, staff record or payroll value changed for this research.
