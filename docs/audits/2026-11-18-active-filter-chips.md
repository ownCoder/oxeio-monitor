# Pool and Review active-filter chips — web release 532

Date: 18 November 2026 (Asia/Dhaka)
Application commit: `f89b39e48efe611247758450a4aa61deba48d1e7`

## Delivered slice

Design Pool and Review now show every non-default search, queue, person, date, reason, progress, age, legacy-item and sort choice as a labelled chip above the table. Each chip removes only its own condition, while Reset all restores the page defaults. The row also shows the exact active-filter count, so a shortened or empty list no longer depends on remembering controls hidden inside the filter panel.

This reuses the existing filter state and reset function; it does not add a second filter engine, change server queries or alter saved-view behaviour.

## Verification and safety

- Exact live-source web typecheck and lint passed locally.
- Exact staged production web build passed on the VPS.
- Focused frontend regressions: 2 files, 15 tests passed for target filters and saved views.
- Staged bundle contains the Active filters UI; public JavaScript is byte-identical to the staged asset.
- Live web is healthy; API and PostgreSQL container identities are unchanged and healthy.
- Anonymous preference request still returns 401.
- No migration, seed or production data write. Rollback image: `oxeio-web:before-filter-chips-20261118`.

D05 remains in progress. Next: apply the same clear control language to Screenshots and appropriate report tables, then close D05 when its cross-page acceptance checks pass.

Evidence: `/opt/oxeio-releases/filter-chips-20261118`.
