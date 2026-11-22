# Design estimate versus observed time — 22 November 2026

Release **538 / `a734487ff09b4a71d7951f472201e8c0c0eb0c84`** is live at `https://hub.oxeio.com` as the first D06 slice.

## Delivered

- Owner/manager **Plan work** now records an optional controlled work type (Typography, Graphic, Illustration, Seasonal or Other) and an estimate from 5 to 1,440 minutes together with the existing priority, due date and required reason.
- Design evidence shows planned time beside observed Illustrator/Photoshop file foreground time and labels the difference as over/under/close to plan.
- The wording explicitly separates the manager estimate and observed file activity from payroll credit and design quality. Staff can see the comparison only for their currently assigned design, following existing evidence scope.
- Planning changes use the existing audited target-history transaction. Existing targets were not backfilled or guessed; after migration, populated estimate/work-type count was **0** until managers deliberately plan work.

## Safety and verification

- Additive migration `20261122080000_design_estimate` adds two nullable columns with database checks for controlled types and the 5–1,440 minute range.
- The latest encrypted production backup `oxeio-2026-11-22-0230.dump.enc` (54,199,904 bytes) passed its stored SHA-256 check before migration.
- A disposable PostgreSQL 16 database applied all 48 migrations. Focused production lifecycle tests passed **14/14**, including estimate persistence and before/after planning history. The temporary database container/network were removed.
- API and web typecheck/lint passed; frontend suite passed **313/313**. No production test write was performed.
- Live API/web/PostgreSQL are healthy; health reports build 538 and the exact app commit. Anonymous Production access returns 401; the public JS asset exactly matches the container. PostgreSQL container remained `cab5ab...2821`.
- Rollback images: `oxeio-api:before-design-estimates-20261122` and `oxeio-web:before-design-estimates-20261122`. Source/evidence: `/opt/oxeio-releases/design-estimates-20261122`.

D06 remains `in_progress`. Next: manager comparison across completed designs by controlled work type with honest sample counts, followed by task checklist/subtasks and mentions using the existing target workspace rather than a duplicate task system.
