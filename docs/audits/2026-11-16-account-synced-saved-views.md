# Account-synced saved views — release 526

Date: 16 November 2026 (Asia/Dhaka)
Application commit: `80d4ce3332fe094bb77f3de69a3308e3a5ff96fa`

## Delivered slice

Design Pool and Review saved views are now stored against the authenticated account instead of only in one browser. A user can save a named filter view on one PC and load it after signing in on another PC. Existing browser-only views migrate once when the account has no server-side views. Pool and Review remain separate scopes; one account cannot read another account's saved views.

This is the first D05 slice. Screenshots/reports, configurable visible columns and consistent active-filter chips/reset controls remain next, so D05 stays `in_progress`.

## Guardrails

- Routes derive `userId` from the authenticated session; no user ID is accepted from the client.
- Only `pool` and `review` scopes and the existing filter keys are stored.
- Maximum 10 views per scope; names and values are length-limited and unknown keys are discarded.
- Changes require the existing CSRF protection.
- Additive `user_preferences` table only; no production staff, design, payroll, attendance, screenshot, salary or deposit record was modified.
- Rollback images: `oxeio-api:before-table-controls-20261116` and `oxeio-web:before-table-controls-20261116`. The additive table is safe if the prior application is restored.

## Verification evidence

- Server and web typecheck/lint passed on the clean build-523 baseline.
- Exact staged server and web production builds passed.
- Disposable PostgreSQL integration suite: 2 files, 15 tests passed, including account isolation, authentication, CSRF and saved-value sanitization.
- Fresh encrypted production backup: `/opt/oxeio-releases/table-controls-20261116/before-release.dump.enc`; checksum recorded.
- Backup restored into a network-isolated PostgreSQL container; migration applied there and employee, design-target and user counts were unchanged.
- Production migration applied successfully; `user_preferences` exists exactly once.
- Live API, web and PostgreSQL containers healthy; PostgreSQL container identity unchanged.
- Public health reports build `526`, commit `80d4ce3`; anonymous saved-view request returns 401; public JavaScript is byte-identical to the staged asset.
- Disposable validation images were removed after release; current and rollback images remain. Disk is 93% used with about 6.0 GiB free, so the existing storage warning remains actionable.

Release evidence and logs: `/opt/oxeio-releases/table-controls-20261116`.
