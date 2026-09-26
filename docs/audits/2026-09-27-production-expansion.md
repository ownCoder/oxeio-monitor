# Studio production expansion — verification, 27 September 2026

Scope: eight owner-approved features, using the approved Studio mockup. These results concern local source and disposable test infrastructure. **No new feature, migration, sales row, comment or setting was written to production. Live remains 409 / 1081b09.**

## Automated verification

- Server typecheck and lint passed; server build passed.
- Server non-database suite: **1,245 passed, 1 existing skipped**.
- Web typecheck and lint passed; web production build passed. Production screens load as a separate route chunk. The existing main bundle still emits Vite's advisory size warning.
- Web suite: **282 passed**.
- Disposable PostgreSQL 16 integration run: **104 passed**, comprising 82 existing target tests, 10 lifecycle/race regressions and 12 new production tests.
- After small review fixes, focused proofing and workload tests rechecked nullable pin coordinates and policy-based daily target fallback. No unrelated suites were repeated for those scoped changes.
- Both new migrations applied successfully to two fresh disposable databases; total migration count is 37.

New database tests cover transaction rollback/no-op history, cursor pagination, reasoned reassignment, assigned-target access, concurrent identical image versions, comment resolution, paged queues, quality medians, live-ASIN matching, concurrent duplicate imports, currency separation, audited estimates, HTTP role/DTO guards, durable completion-cap rejection auditing and daily digest deduplication. Unit tests cover CSV/calendar limits and external heartbeat failure/staleness handling. Telegram and external HTTP delivery are mocked; no real notifications were sent.

## Browser verification

A loopback-only API and Vite UI used a separate synthetic preview database, with scheduling disabled. Verified board counts/cards, planning change → persisted history, private image upload → version 1, pinned comment → resolve → reopen, workload rows, sales preview → matched import → cost estimate, and duplicate CSV import disabled. Source and product ASINs in fixtures were deliberately different. The UI respects light/dark themes; the saved history screenshot uses the approved light Studio direction.

## Restore drill

An encrypted custom-format dump of the synthetic preview database was restored through `scripts/verify-restore.sh` into a new PostgreSQL 16 container with `--network none`, no published ports, and tmpfs data. Checksum, OpenSSL decryption and `pg_restore --exit-on-error` succeeded. Evidence: [synthetic restore JSON](2026-09-27-synthetic-restore.json).

Restored: 1 synthetic user, 2 synthetic employees, 6 synthetic targets, 37 applied migrations, 0 invalid constraints. A second run with a wrong synthetic key failed, produced no success evidence, and removed its temporary container. This validates the restore workflow, **not a retained production backup**.

## Retained production-backup verification

After the synthetic drill, the existing VPS backup `oxeio-2026-09-26-0230.dump.enc` (21,996,752 bytes; recorded successful at 2026-09-25 20:30 UTC) was restored on the same VPS using the same isolated tool. The source backup and production database were read only. Its existing passphrase was passed through a mode-600 temporary file without printing it and removed by an exit trap. No backup contents or credentials were downloaded.

The drill completed at 2026-09-26 18:39:16 UTC (27 September 00:39 Dhaka): **14 users, 13 employees, 50,620 targets, 35 applied migrations, 0 invalid constraints**. The 35-migration count matches the pre-expansion production schema. The temporary network-isolated container and key were removed. The result establishes restoreability of this specific checksum/snapshot, not of future backups or the unreleased expansion data. [Production backup restore evidence](2026-09-27-production-backup-restore.json).

## Remaining operational work

1. Take and verify a retained production backup, then deploy migrations/API/web together with health and role checks.
2. Connect independent monitor accounts/secret ping URLs and verify external alert delivery. A configured URL is not shown as proof that an external monitor is healthy.
3. Enable the owner action digest only after verifying the private Telegram destination. Live delivery is untested in this change.
4. Repeat restore drills for future retained backups, particularly after the new schema is deployed. Synthetic and real backup evidence are retained separately.

The Compose file was externally renamed during implementation; the owner explicitly approved restoring `docker-compose.yml`, and its original name was restored. Existing unrelated `web/src/pages/live/OpenAlerts.tsx` was preserved.
