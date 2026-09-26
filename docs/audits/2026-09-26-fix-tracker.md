# System audit fixes â€” 26 September 2026

The owner authorized documenting and fixing A01â€“A07 one by one.

Follow-up: [round 2 fixes B01–B03](2026-09-26-round2-fixes.md) are deployed and verified in release **409 / 1081b09**. The release 407 record below remains historical.
Original evidence: [system audit](2026-09-26-system-audit.md).

| ID | Priority | Issue | Status |
|---|---|---|---|
| A01 | P1 | Canonical filenames break backend imports | Fixed; backend typecheck passes |
| A02 | P1 | Concurrent completion exceeds the daily cap | Fixed; 19 quota integration tests pass, including concurrent requests |
| A03 | P1 | Concurrent delete changes completed work to deleted | Fixed; real PostgreSQL regression passes |
| A04 | P2 | Pool reset preserves old upload/live stages | Fixed; real PostgreSQL regression passes |
| A05 | P2 | Repeated Done rewrites completion history | Fixed; real PostgreSQL regression passes |
| A06 | P2 | Transient auth failure shows Sign in | Fixed; 8 regressions pass, browser 503/retry and 401 verified |
| A07 | P1 | Live release and deployment source differ | Fixed; matched source/API/web release 407 deployed and verified |

## Verification and release

Results will be recorded after each fix. Database integration checks and live
deployment are tracked separately from local unit tests. GitHub source push is
not assumed from the earlier VPS deployment authorization.

- Backend typecheck, ESLint and build pass after fixes. No-DB tests: 1,230 pass, one skipped.
- Frontend build and ESLint pass; 264 tests pass. Existing Vite bundle-size warning remains.
- A02: 19 real PostgreSQL quota tests pass; existing administrative override remains valid.
- Disposable database is isolated on VPS localhost port 55432 and reached through an SSH tunnel. No production database is used for tests.

- A03–A05: 82 existing target integration tests plus 3 new lifecycle regressions pass. Combined with quota coverage: **104 integration tests passed**.
- A03 regression observes PostgreSQL waiting on a row lock before committing completion; deletion then preserves the completed row.
- All ten primary docs, root/deployment README, Studio notes and dated audit/fix records have been updated. Pre-existing documentation edits were retained.
- A07 guard prevents rebuilding behind the last verified source marker and rejects a healthy API with the wrong commit.

## Verified deployment — 26 September 2026, 16:02 UTC

- Application release: **407**, commit `7467f2b0c23c58cc615f8d39413d8956c5d0b9b5`.
- VPS source was fast-forwarded from a verified Git bundle, preserving the existing untracked `setup-telegram.sh`.
- Web and API both report 407 / 7467f2b; the previous mismatch badge is gone.
- API health reports `status: ok`, `db: up`; all three production containers are healthy.
- Served JS, CSS and service worker bytes match the build. Running target-service JS matches the tested build.
- The authenticated Live Board loaded its real summaries, table and charts in a read-only browser check.
- Production PostgreSQL container was not recreated. No schema migration, fixture or historical-data rewrite was performed.
- Temporary test database/container/volume and SSH tunnel were removed after tests.
- Release directory: `/opt/oxeio-releases/audit-7467f2b`.
- Rollback images: `oxeio-api:before-audit-7467f2b`, `oxeio-web:before-audit-7467f2b`.
- GitHub was not pushed. The VPS has the source commits locally; do not reset it to an older remote branch. Later documentation-only commits do not change application release 407.

## Remaining limits

All seven audit findings are repaired. Existing historical records were not retroactively corrected; the administrative completion override remains intentional. The full unrelated integration suite, every physical office PC, and backup restoration were not re-tested in this repair. Vite's existing bundle-size warning and one pre-existing skipped backend test remain.
