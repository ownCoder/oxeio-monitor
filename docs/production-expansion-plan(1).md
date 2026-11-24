# Production expansion — approved scope, 26 September 2026

The owner approved all eight phases and the Studio mockup on 26 September 2026. Implementation was verified locally on 27 September. **Production is release 411 / 5dd3783. Skip review and its target-history dependency are deployed; the complete Production workspace and its UI remain unreleased.**

| Phase | Deliverable | Status |
|---|---|---|
| 1 | Durable target/assignment history, actor attribution, per-job timeline | Implemented; transactional events, cursor pagination and committed completion-cap rejection audit |
| 2 | Production queues and waiting-time board | Implemented; six paged queues, search, staff filter and elapsed aging |
| 3 | Design proofing, versioned previews and resolved comments | Implemented; private PNG/JPEG, duplicate-image reuse, pins, resolve/reopen |
| 4 | Workload, priority, due date and controlled reassignment | Implemented; policy-based daily target, reasons and reassignment before work starts |
| 5 | Production quality and flow reports | Implemented; first recorded check, rework count, median flow and sample counts |
| 6 | Actionable owner digest using existing delivery infrastructure | Implemented; default off, 18:45 Dhaka, private Telegram, configurable aging, overdue/backup failure counts and durable daily deduplication; live delivery not enabled/tested |
| 7 | Independent job/uptime monitoring and isolated backup-restore verification | Heartbeat adapter, configuration/status UI and restore tool implemented; synthetic encrypted restore and wrong-key rejection verified. External account/URLs, alert delivery and a retained production-backup drill remain operational work |
| 8 | Owner-only product sales CSV imports and explicit estimated costs | Implemented; monthly CSV preview/import, live-ASIN matching/linking, concurrent duplicate protection, separate currencies and audited estimates |

Existing completion caps, stage semantics, access restrictions and salary visibility remain in force. No historical missing assignment events will be invented. New reports distinguish observed data from unknown history and elapsed waiting from labor time. Existing source-ASIN and own-product live-ASIN remain distinct.

UI routes: `/production/board`, `/production/workload`, `/production/quality`, `/production/digest`, `/production/monitor`, `/production/sales`. Target history/review also opens from Design Pool and My data. Management sees planning/quality; researchers see the board; staff see only currently assigned target details; finance/digest/monitor are owner-only.

The approved Studio style is implemented. See [verification evidence](audits/2026-09-27-production-expansion.md), [operations and rollout](production-operations.md), [research](2026-09-26-feature-research.md) and [approved mockup](mockups/production-workspace.html). Production data was not used as test fixtures.
