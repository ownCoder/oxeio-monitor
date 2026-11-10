# Storage and retention overview — 10 November 2026

Release 521 (`d2f0235eb786b629eef4bd75211ae5c5533715be`) delivers the first usable D03 slice.

## Live

- Owner-only Alerts > Storage & retention card.
- Current screenshot, database, backup and other application-storage sizes with file counts.
- 90-day retention policy, active rows, eligible-now rows and rows awaiting purge.
- Docker and growth gaps are labelled honestly rather than estimated.

## Verification

- Server and web typecheck/lint passed.
- Disposable PostgreSQL suite 13/13 passed, including owner access, manager 403 and anonymous 401.
- Guarded deployment retained rollback images; no schema migration and no production test write.
- Public health build 521 / `d2f0235`; public JS byte-identical; API/web/PostgreSQL healthy; PostgreSQL container unchanged.

## D03 remaining

Add a least-privilege host collector for Docker images/build cache, daily snapshots for growth, and persisted last-cleanup evidence. Do not mount the Docker socket into the API.

Evidence: `/opt/oxeio-releases/storage-dashboard-20261110`.
