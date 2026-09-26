# Round 2 fixes — 26 September 2026

The owner requested fixes for [B01–B03](2026-09-26-system-audit-round2.md). All three are repaired and verified in the local working tree. These changes have not been committed, pushed, or deployed; the live application remains on the previously deployed release.

| Finding | Repair | Verification |
|---|---|---|
| B01 — active work returned to pool | Return writes require assigned status, no start time, and no matching work-date credit at statement time. The start writer also rechecks employee ownership and assigned status. | Real PostgreSQL row-lock tests cover both start-first and return-first ordering. Existing pool/credit tests pass. |
| B02 — stale stage transitions | Check, fix, upload, and live use conditional atomic writes with prerequisite and unset-stage predicates. Duplicate calls preserve the first timestamp/attribution; missing/invalid targets retain their errors. | Four real PostgreSQL races against reset are rejected; concurrent duplicate upload preserves the first time. Existing stage tests pass. |
| B03 — failed logout looks successful | A pending/failed logout screen hides authenticated content and offers retry. Refresh responses are invalidated and cannot restore the old user. Logout intent persists in tab session storage, retries on mount/reconnection, and clears only after logout succeeds or returns 401. Repeated clicks do not duplicate in-flight requests. | 13 new frontend regressions, plus a browser preview with mocked 503/204 responses: failure, retry failure, reload persistence, and successful recovery to Sign in. |

## Checks

- Backend typecheck, ESLint, and production build: passed.
- Backend no-database suite: **1,230 passed, 1 skipped**.
- Target integration suites: **92 passed**, including **7 new PostgreSQL concurrency regressions** and the 3 earlier lifecycle regressions.
- Frontend typecheck, ESLint, and production build: passed. Existing bundle-size warning remains.
- Frontend suite: **277 passed**, including **13 new logout regressions**. The final refresh-cancellation cleanup was followed by a focused **21-test** auth rerun, lint, typecheck through build, and a new production build.
- Test database used a separate disposable PostgreSQL container on VPS localhost port 55432 via an SSH tunnel. Production records, migrations, and the owner's browser session were not modified.
- After verification, the disposable container/volume and SSH tunnel were removed; the local preview server was stopped.
- Browser validation used the production web build served locally with synthetic data and mocked API responses. It was not a production cookie/revocation test.

## Limits and operational status

- The normal integration suite beyond target behavior and the physical office agent fleet were not re-run for these web/server changes. Agent code was unchanged.
- Existing inconsistent historical records were not rewritten.
- Credit visibility follows PostgreSQL statement snapshots; this fix does not attempt to predict agent events that have not arrived or coordinate independent future credit transactions.
- If browser session storage is disabled, logout intent remains protected in memory for the current page but cannot be persisted across reloads.
- No production rollout or GitHub push is included in this repair record.

Active regression files: `oxeio-monitor/server/test/target-lifecycle.e2e.spec.ts`, `oxeio-monitor/web/test/logout.spec.ts`, and `oxeio-monitor/web/test/session.spec.ts`. The `.spec.ts.txt` audit files remain historical pre-fix evidence, not current passing invariants.
