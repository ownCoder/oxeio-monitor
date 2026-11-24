# Production workspace operations

> **27 September 2026:** release 411 includes skip review and `20260926010000_target_history`. The full workspace below remains unreleased; `20260926020000_production_workspace` is not applied. Preserve `20260927010000_skip_review_limit` during later rollout. Resolve pending skips with the new API before any rollback to an older API. See [deployed rules and recovery](audits/2026-09-27-skip-review.md).

The Studio mockup and all eight phases were approved on 26 September 2026. New code requires both `20260926010000_target_history` and `20260926020000_production_workspace`. Take and verify an encrypted backup before rollout. Apply migrations with the normal release process, then deploy API and web together. The additive schema can remain in place during an application rollback. Do not drop history or imported results to roll back a UI release.

## Monitoring setup

Create three checks in a separate Healthchecks account, following its [official ping and schedule documentation](https://healthchecks.io/docs/). Keep their ping URLs secret in the VPS environment:

```
PRODUCTION_UPTIME_PING_URL=https://hc-ping.com/<check-uuid>
PRODUCTION_BACKUP_PING_URL=https://hc-ping.com/<check-uuid>
PRODUCTION_DIGEST_PING_URL=https://hc-ping.com/<check-uuid>
```

The API accepts only HTTPS `hc-ping.com` UUID URLs, never redirects. Uptime pings run every five minutes after a database read; configure a ten-minute timeout plus a reasonable network grace period. Backup and action-digest checks ping only on new successful observations less than 26 hours old. Use a 26-hour timeout. Enable the digest check only when scheduled digest delivery is enabled. An externally hosted HTTP check of `https://hub.oxeio.com/api/v1/health` additionally verifies the public proxy, TLS and API route. The application does not create monitor accounts, prove their notification delivery, or infer external status from a configured URL. System checks displays configuration and last delivered observations separately.

## Action digest

Owner-only Production → Action digest. Default off. Reuses the existing Telegram channel and requires a positive private-chat ID. The owner must verify that this chat is theirs in Settings before enabling. Runs daily at 18:45 Dhaka, with a configurable 1–720-hour waiting threshold. Only actionable queue/overdue counts are sent, without salaries or individual staff details. Quiet days are recorded without sending. A database advisory transaction lock and durable date key suppress concurrent/restarted duplicate runs. External delivery cannot be atomic with database commit: a crash after Telegram accepts the message and before commit can repeat a message. Failed attempts are not marked delivered. No automatic retry loop or flood of unchanged messages is introduced.

## Restore verification

Run on a trusted Linux Docker host with OpenSSL, Python 3 and enough memory. The script never accepts a production database URL. Its temporary PostgreSQL has no network, no published ports, a 768 MB tmpfs database and a 1 GB memory limit. Larger backups require an explicitly reviewed resource increase. Prepare a mode-600 passphrase file outside the repository; do not paste secrets into command history or documentation.

```sh
bash oxeio-monitor/scripts/verify-restore.sh /secure/backup.dump.enc /secure/backup-key /secure/restore-evidence-YYYY-MM-DD.json
```

Requires the backup's `.sha256` sidecar. The script checks the encrypted checksum, streams decryption into `pg_restore --exit-on-error`, verifies core tables and constraint validation, writes new timestamped JSON evidence, and removes its uniquely named container even on failure. It never writes a plaintext dump. Retain successful evidence separately, compare row counts with the expected backup, and destroy the temporary key file using the host's approved secret-handling process. Backup success is not restoration proof. A synthetic drill validates the tool; a real retained production backup drill remains a separate operational requirement.

## Data boundaries

- History starts at migration activation, with no fabricated backfill. Actor/source and before/after state share the target transaction. Direct SQL without attribution is marked unattributed. No-op updates do not create duplicate events. Completion-cap rejections commit a separate audit record before returning HTTP 409.
- Preview PNG/JPEG: 2 MB, 50 versions/target, 200 comments/version. Stored inside PostgreSQL so existing encrypted backups cover them; monitor database and backup growth. Images are private and no-store. Staff can access only currently assigned targets; staff may resolve their own comments, reviewers may resolve all.
- Workload edits require owner/manager, a reason, valid Dhaka dates and an active design staff assignee. Only assigned work that has not started can move. Existing completion caps apply.
- Quality reports count the first **recorded** check, which may not be the historical first check. Flow uses valid existing timestamps and sample counts, measured as elapsed time including non-work hours.
- Monthly CSV columns: `period,live_asin,units,royalty,currency`. Up to 1 MB/2,000 rows; month YYYY-MM; live ASIN ten alphanumeric characters; net units and royalty may be negative for refunds. One total per month/live ASIN/currency; file hash and database uniqueness protect concurrent imports. Multiple currencies are never combined. Unmatched/ambiguous rows require explicit acceptance; links must match the exact live ASIN. Costs are owner-entered estimates, not salary or monthly profit. Current estimates are shown against related months as reference only.

## Release verification

Before deployment: typecheck/lint, production integration tests on a disposable database, existing target lifecycle regressions, frontend build and visual review. After deployment: health/version agreement, authenticated role checks, queue/history readback and migration presence. Do not seed test products, comments or sales into the production database.
