# Report filter controls and D05 completion — 21 November 2026

Web release **536 / `5cee8bf479fd8c58036138137a353e7f2b18b342`** is live at `https://hub.oxeio.com`.

## Delivered

- Attendance, Summary and Apps & sites reports now have **Today**, **Last 7 days** and **This month** shortcuts.
- Every non-default report condition appears as a labelled removable chip with an exact active count: date, selected staff, Summary grouping and Apps/sites top limit. Payroll uses the same pattern for a non-current month.
- Removing a chip resets only that condition. **Reset all** restores current-month/everyone/default grouping/default limit/current payroll month and clears stale download errors.
- Existing report queries, export parity, owner-only Payroll visibility and server permissions are unchanged. Hiding arbitrary report columns was deliberately not added because report tables and Excel share defined evidence fields; Design Pool/Review remain the appropriate customizable work tables.

## Verification and release

- Exact deployed build-534 source was exported to `/opt/oxeio-releases/report-controls-20261121`; only three reviewed frontend files were committed.
- Local typecheck/lint passed. Isolated VPS source passed typecheck, lint and **313/313** frontend tests across 17 suites; the correctly numbered build-536 artifact also passed the three new filter-state cases.
- Live web is healthy. Public `index-C3eR1A1Z.js` exactly matches the container (`0a0e80...e1847`). Anonymous Attendance report access returns **401**.
- API container `ec9780...1d1` and PostgreSQL container `cab5ab...2821` are unchanged. No schema, production data, payroll calculation or attendance record changed.
- Rollback image: `oxeio-web:before-report-controls-20261121`. Disk was 92% used with 6.9 GiB free immediately after deployment; disposable validation images are removed after documentation sync.

D05 acceptance is complete: account-synced Pool/Review saved views and visible columns plus consistent active-filter/remove/reset controls across Pool, Review, Screenshots and Reports are live. D06 estimate-versus-actual and task planning is next.
