# System improvements — implementation and acceptance record

28 September 2026 · Asia/Dhaka. Final application **422 / cc34a36**; feature release 421 / c1f949a.

## Completed scope

| Work | Result | Limit / next action |
|---|---|---|
| September reconciliation | Restored 28 September 02:30 backup into an internal-network disposable clone; 12 payroll/monthly rows. Payroll credited hours, net-pay arithmetic, daily/monthly sums, staff self-view and report credited hours agree. Zero missing salaries/summaries, excess deposits or uncertain holiday dates in this snapshot. | Partial month, not final owner approval. Do not close September until month-end review. No live ledger or payroll-close writes. |
| Skip insights | Management-only date report shows requests, automatic/pending/approved/rejected decisions, unique assignments and cohort rate. | Request ledger and assignment history start 27 September at 12:33 Dhaka. This cannot establish the complete historical 24 September ratio or prove deliberate bypass. No sanctions. |
| Design history and usability | Management history modal with actor/source, status changes and cursor paging; account/page-scoped saved filters and encoded share links. Protected completed rows no longer offer misleading Delete in More actions. | Saved views are local to this browser; use the share link on another PC. CSV still exports the visible page. |
| Independent alerts | Existing UptimeRobot account: monitor 804106657 checks `/api/v1/health/ready`; monitor 804106772 checks `/api/v1/health/backup`, every five minutes, existing account email contact. Both observed Up. Test email request accepted by onboarding flow. | Inbox delivery confirmation pending. Paid SSL-expiry/domain checks were not purchased. Backup probe covers configured on-host backup state, not B2 object freshness or a successful restoration. |
| Current recovery proof | Latest local backup and latest existing B2 offsite object downloaded, checksummed and restored successfully in separate network-none PostgreSQL 16 tmpfs containers. | Existing B2 object is 26 September; weekly offsite schedule remains. New 28 September upload/daily cadence awaits specific owner approval after automatic approval rejection. |
| Source alignment | Eleven scoped source files in `.release-system` match deployed bytes; clean current release and rollback bundles preserved on VPS. Overview docs now point to canonical current-state. | Main local checkout remains dirty with unrelated pending work. Do not deploy it wholesale or treat it as the release mirror. No GitHub push or automatic PC sync. |
| Agent acceptance preparation | Current release source: 102 focused core tests pass for sleep-gap handling, segment durability, retry, restart ladder, capture gates and sync-health policy. | Physical restart/sleep/lock/network/Photoshop/screenshot test needs an identified office PC and direct/remote access. Local PC inspection found oXeioSync, not an installed tracking agent. Fleet stays on 0.4.11. |

## Report definition and live verification

Rate numerator: unique targets with automatic or approved requests in the chosen Dhaka date range, assigned to the same employee in that range. Denominator: unique recorded target/employee assignments in that range. Repeated assignments/requests do not inflate the ratio; pending and rejected requests are excluded from the numerator. Carry-in/unknown assignments are shown separately; no recorded denominator gives an unknown rate. Current decision state is shown, not a historical as-of decision.

Chrome verified live report rows, recorded coverage warning, actual B09VCPSRWS assignment → request → approval timeline, and saved view save/apply/remove/share URL behavior. No test target mutation or reviewer decision was submitted. Owner/staff activity continued during verification, so counts in screenshots are timestamped snapshots, not fixed totals.

## Validation

- Feature release: 261 backend tests in 10 selected suites, including six new insights HTTP/cohort/history tests and existing target/skip/payroll/proration/deposit/self-view/report/leave regressions.
- Frontend: 282 tests in 12 suites; production typecheck/build and targeted lint pass. Final saved-view ID sanitization was rebuilt and re-tested.
- Readiness follow-up: 46 no-database tests pass (five new readiness tests plus 41 operations-rule tests); backend production build and targeted lint pass. Synthetic DB/backup failures tested without stopping production.
- Agent: 102 focused core tests pass, no skips. NuGet vulnerability metadata could not be fetched under current network access (NU1900); this is not a completed dependency vulnerability audit.
- Public HTTPS health reports 422/cc34a36; both public readiness GET and HEAD routes return 200 when healthy. API, web and PostgreSQL healthy. Original PostgreSQL container unchanged. No migrations or seed.
- Public `/assets/index-guYydpdg.js` matches the web container byte-for-byte: SHA256 `5e50dbd93415d6dac0ee639db485ae17711e8d1771ab72d299813bfde7383f94` (`system-public-bundle.txt`).
- Backup counts: local restored users 14 / employees 13 / targets 51,170 / migrations 37; existing B2 restored users 14 / employees 13 / targets 50,620 / migrations 35; invalid constraints zero for both.
- Evidence: `restore-latest-backup.json`, `restore-offsite-backup.json`, `payroll-reconciliation-summary.json`, `system-skip-report-422.png`, `system-design-history-421.png`, external monitor screenshot and source alignment manifest.

Payroll review JSON/HTML contain private salary data and remain in the VPS's mode-700 `private-review` folder, files mode 600. The local readable copy is in ignored `oxeio-monitor/.data/review/payroll-review-2026-09.html`; it is not committed. Payroll UI currently has no dedicated PDF/XLSX export; report data and existing report regressions were checked, not a nonexistent payroll export.

## Physical acceptance procedure — pending actual PC

Record employee code, device ID, hostname, agent version, operator, Dhaka start/end time and direct/remote access method first. Preserve any unsaved office work before each restart or disconnect. Keep the test PC and consent explicit; permission to test was given but no PC/access endpoint was identified.

| Step | Observe and reconcile |
|---|---|
| Baseline and Photoshop work | Record five minutes of actual input/work; compare agent tray, activity segments, web worklog and screenshot timestamps. Check duplicate overlaps and missed active seconds. |
| Windows lock and idle | Lock for two minutes; verify locked time is not active working time and capture behavior matches the existing policy. |
| Sleep/wake | Sleep for two minutes; verify the suspended gap adds no active duration and tracking resumes without duplicate segments. |
| Network loss | Disconnect this PC for three minutes while working; queue should retain unsent segments/screenshots locally. Reconnect; verify acknowledged delivery without loss or duplicate credited time. |
| Restart with queued data | Repeat a short offline segment then restart; after reconnect/login, queue recovery and single-agent/watchdog operation must be checked. |
| Final evidence | Compare observed clock intervals with delivered segments, queue acknowledgements, worklog totals and screenshots; record pass/fail and concrete discrepancies. A heartbeat alone does not pass this test. |

Do not roll out a newer package until discrepancies are resolved. Do not infer misconduct from missing legacy history, current rate or a single heartbeat.

## Recovery and handoff

Release directory: `/opt/oxeio-releases/system-improvements-20260928`. Contains pre-release encrypted backup/checksum, restore evidence, private reconciliation, `source-421.bundle` and final `source.bundle`. Initial feature rollback images: `oxeio-api:before-system-improvements-20260928` / `oxeio-web:before-system-improvements-20260928` (418). Readiness rollback images: `oxeio-api:before-monitor-readiness-20260928` / `oxeio-web:before-monitor-readiness-20260928` (421). Roll back API and web together using both compose files; do not remove the deployed skip-review/history schema.

Authoritative shared handoff: `/opt/oxeio/docs/current-state.md`; deployed marker `/opt/oxeio/.git/oxeio-deployed-commit`. Later docs-only commits may be ahead of the application commit.

Pending approval drafts: `upload-current-offsite-pending-approval.sh` uploads only the named encrypted dump/checksum to existing `b2:oxeio-backups`, without pruning; `daily-offsite-pending-approval.timer` proposes 03:30 Dhaka with a five-minute jitter. Neither was run/installed. Existing service retention behavior remains a separate established policy.
