# Office workspace ও Production release — 29 September 2026

Initial feature release **427 / 36474c4**; final checklist refresh **428 / 6d7705c**. Owner approved starting all additions after [market research](../2026-09-29-market-research.md).

## Delivered scope

Office sections: Today, Design briefs/templates, Help requests, Submission checks/templates, SOP/example instructions, Equipment, Joining/leaving cases/templates and Skills/coaching. My Data adds target-linked Details & help and design-review links; selected row and numeric ordering remain.

Previously implemented Production workspace is now included: queue/aging board, versioned private previews/pinned comments, planning/workload, quality/flow, owner digest/configuration, monitoring/status UI and sales CSV/product results. Actual external digest delivery is opt-in and was not enabled/tested here. No sales imports, staff ratings, guessed policies, seed or payroll closure were written to production.

Records have typed server validation, role/employee/assignment scope, foreign keys, transactional history and version checks. Staff cannot resolve help requests or edit coaching/SOPs; help/checks cannot change target completion, skips, hours or pay. Brief access follows current assignment. Equipment handover and archive/restore retain history. SOP acknowledgements refer to a specific version. Checklist version changes require loading current items and clearing previous ticks; technical warnings are advisory, not visual approval.

See [operations](../office-workspace-operations.md) and [implementation](../office-workspace-implementation.md) for exact scope and first-use setup. SOP examples are text/reference instructions in this version; a separate attachment library, quizzes, automatic offboarding and automatic ratings are not implemented.

## Verification

- Clean staged API/web production builds and targeted lint passed. Main local frontend/backend typechecks and Prisma generation also passed after scoped merge.
- **1,254 server non-database tests** passed. The storage permission test initially failed when run as root; the full suite passed as the ordinary container user, preserving the actual permission check.
- **293 frontend tests / 14 suites** passed, including three Office view tests and existing personal-selection tests.
- **109 database integration tests** passed across runs: 102 existing target/pool/Production tests plus seven Office tests. Office tests cover staff isolation/no time/status/skip side effects, concurrent update rollback/history, versioned/idempotent SOP acknowledgement, stale checklist rejection, reassignment visibility, asset duplicate/handover/archive/restore and authenticated strict DTO/CSRF HTTP behavior.
- Chrome against a separate synthetic database: owner brief revision persisted as v2; template-derived employee joining checklist saved 1/3 progress; designer created a scoped help request, acknowledged a SOP, saved a passed technical checklist and loaded a revised checklist with all old ticks reset while file metadata stayed intact. [Synthetic preview](office-workspace-preview.png).
- Live Chrome owner session opened Office at release 427; its screenshot is retained. Final 428 public version/login page, health, containers and bundle were verified. The owner session ended before a live Production-route check, so that route is covered by synthetic UI and database tests rather than claimed authenticated final-live acceptance. No real staff mutation was used for UI testing. [Live workspace](office-workspace-live.png).

## Retained backup, migrations and recovery

- Encrypted pre-release backup: `/opt/oxeio-releases/office-workflows-20260929/before-release.dump.enc`; AES-256-CBC/PBKDF2 200,000/SHA256 with a temporary protected key file removed afterwards.
- Restored into a disposable PostgreSQL container with `--network none` and tmpfs data. New migrations applied via a container sharing only that isolated network namespace. Employee, target, monthly-summary, salary-period and closure row counts matched before/after; new Office records count was zero. Count comparison is not a fresh full payroll reconciliation.
- Applied to live: `20260926020000_production_workspace` and `20260929010000_office_workflows`. PostgreSQL production container unchanged. Checklist refresh needed no further migration.
- Prior 424 rollback images: `oxeio-api:before-office-workflows-20260929`, `oxeio-web:before-office-workflows-20260929`. Both compose files mandatory. Additive schema can remain for an application rollback; do not delete new tables/records or restore an old snapshot over newer work casually.
- Source/evidence: `/opt/oxeio-releases/office-workflows-20260929`, local `.release-office`. Deployment scripts and source checksums retained. Deployed marker `/opt/oxeio/.git/oxeio-deployed-commit`; docs-only HEAD can advance without changing app version.
- Main dirty workspace retains unrelated agent/payroll/Studio changes. New Office files were merged, existing Production files reused and unrelated edits preserved; do not deploy the entire checkout.

## Remaining operational acceptance

Owner/manager should create the real brief/checklist/SOP content and pilot with a small group; preview fixtures were never seeded live. Private digest destination/delivery and sales-source imports need their own operational setup. Existing physical-PC acceptance, monitor email inbox receipt and specific offsite upload/schedule approval remain pending as recorded previously. No GitHub push or automatic other-PC sync claimed; canonical handoff is shared on VPS.
