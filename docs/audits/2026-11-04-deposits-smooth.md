# Deposits page usability update — 4 November 2026

Release 505 / `5547f97febe528e2d8b570e9053cc1c8ebf45849` updates only `web/src/pages/settings/DepositsTab.tsx`. The owner can search by name or OX code, switch Open/Settled/All ledgers, see counts and the currently held total, and identify former staff whose settlement remains open. Deposit actions now show save errors inside the active modal and show a page-level success message after completion. Start month, policy amount/notice, and settlement date order receive client-side validation. The blocking browser `window.alert` after recalculating a start month has been replaced by inline feedback.

No deposit calculation, API, database schema or permission rule changed. Local typecheck, lint, production build and 304 existing frontend tests passed. VPS web rebuilt and healthy; API and PostgreSQL container IDs unchanged. Public HTML points to the new JS bundle, and that bundle contains the Deposits search text. Browser tab automation failed before visual inspection, so screenshot QA is not claimed.

The web build temporarily used 89% of the 77G disk. Pruning only unused Docker builder cache brought it to 86% used (12G free). The previous web image remains tagged `oxeio-web:before-deposits-smooth-20261104` for rollback. Older tagged images remain the disk-retention issue described in the 14 October audit.
