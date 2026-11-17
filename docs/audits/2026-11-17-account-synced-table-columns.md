# Account-synced table columns — release 529

Date: 17 November 2026 (Asia/Dhaka)
Application commit: `2597d724ff16d1b5ff6d7e5c766ba0950638db53`

## Delivered slice

Design Pool and Review now have a Manage columns control. Each signed-in user can hide or show Stage, File and People while Design remains visible, see the visible-column count, and reset the table to its default four columns. Pool and Review choices are separate and saved to the account, so the same choice follows the user to another PC without changing colleagues' tables.

The implementation extends release 526's existing account preference record; it does not add another preference system or database migration. Existing saved views are preserved when columns change, and legacy saved-view arrays remain readable.

## Verification and safety

- Server and web typecheck/lint passed on the exact build-526 source baseline.
- Exact staged server and web production builds passed.
- Disposable PostgreSQL integration test passed account isolation, authentication, CSRF, column allow-listing and saved-view preservation.
- No production write test was used. No payroll, attendance, screenshot, salary, deposit, staff or design record changed.
- Live API, web and PostgreSQL are healthy; PostgreSQL container identity is unchanged.
- Public health reports build `529`, commit `2597d72`; anonymous preference access returns 401 and the public JavaScript matches the staged asset byte-for-byte.
- Rollback images: `oxeio-api:before-table-columns-20261117` and `oxeio-web:before-table-columns-20261117`.
- Disposable validation images were removed. A scoped `docker builder prune --filter until=24h` then reclaimed old build cache without deleting images, containers, volumes, backups or production data; disk fell from 94% / 5.1 GiB free to 90% / 8.1 GiB free. The 33.03 GB of reclaimable images is mainly retained rollback history and was not deleted automatically.

D05 remains in progress. Next slices: consistent active-filter chips/reset controls, then appropriate Screenshots/report controls.

Release evidence: `/opt/oxeio-releases/table-columns-20261117`.
