# Design task checklist — 24 November 2026

Release **542 / `6a16977214fa800017b0d2694eefb60497eb9ced`** is live at `https://hub.oxeio.com` as the third D06 slice.

## Delivered

- Every design target now has a **Checklist** tab in its existing Production drawer.
- Owner/manager can add up to 50 short steps and remove them. The assigned designer can mark steps complete or reopen them; owner/manager can do the same. Researcher access remains read-only.
- The tab shows a clear completed/total count and crossed-out completed steps. It explicitly says checklist progress is not payroll credit or design approval.
- The checklist stays attached to the target rather than creating a duplicate task system. No existing targets were backfilled and no production checklist rows were manufactured.

## Safety and verification

- Additive migration `20261124080000_design_task_items` creates the target-owned checklist table with text/position checks, 50-item application limit and completion actor/time evidence.
- Encrypted backup `oxeio-2026-11-24-0230.dump.enc` (55,703,904 bytes) passed its stored SHA-256 check before migration.
- A disposable PostgreSQL 16 database applied all 49 migrations. Focused production lifecycle/permission tests passed **15/15**, including assigned-designer scope and management create/remove. The temporary database/network were removed.
- API/web typecheck and lint passed; frontend suite passed **313/313**. No test writes touched production.
- Live health reports build 542 and the exact commit; anonymous checklist access returns 401, the public JS asset matches the web container, and PostgreSQL remained `cab5ab...2821`.
- Rollback images: `oxeio-api:before-task-checklist-20261124` and `oxeio-web:before-task-checklist-20261124`. Exact release source/evidence: `/opt/oxeio-releases/task-checklist-20261124`.

## Operations note

Disposable test images, dangling images and build cache older than 24 hours were removed, but the VPS is still **97% used with 2.7 GiB free**. Current and rollback images, backups and app data were preserved. Old tagged rollback-image retention is now the actionable storage decision; deleting arbitrary tags without an agreed keep window would weaken recovery.

D06 remains `in_progress`. Next slice: targeted mentions and inbox delivery inside the existing target conversation, with permission-safe recipients.
