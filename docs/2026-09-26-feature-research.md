# Feature research — 26 September 2026

Baseline: deployed application release 409 / 1081b09. This is a proposal, not an implementation commitment. Reviewed current roadmap, features, gap analysis, Prisma models, target workflow and report endpoints, then compared official product documentation. Historical roadmap statuses are not treated as a fresh production audit.

## Recommended additions

| Priority | Addition | Smallest useful scope | Benefit and dependency | Relative effort |
|---|---|---|---|---|
| 1 | Target event and assignment history | Append assignment, return, start, completion, undo, review, fix, upload and live events with actor, timestamp and reason; per-job timeline | Addresses documented G172/G173: returning work clears current assignment fields, and ordinary logs are not a durable allocation record. Must be transactional and retry-safe. Historical missing events cannot be reconstructed reliably. | Medium |
| 2 | Production queue board and aging | Saved views for unstarted, in progress, awaiting checking/fix, awaiting upload, and uploaded but not live; responsible person and time waiting | Builds on existing stage timestamps. Keep design completion and downstream stages separate so design counts remain correct. These are views of current rules, not a proposal to force every job through a new mandatory approval chain. | Medium |
| 3 | Design proofing and revision notes | PNG/JPEG preview, pinned comments, resolve/reopen, immutable version reference, revision reason | Makes feedback specific and keeps it attached to the version reviewed. Existing screenshot monitoring and checked/fixed timestamps are not a design-review conversation. Needs attachment storage and permission checks. | Medium–large |
| 4 | Workload and priority view | Current queue per designer, started/unstarted split, manually assigned priority/due date, visible reassignment reason | Helps managers distribute work with context. Started work should not move automatically; preserve daily cap policy and record reassignment in history. | Medium |
| 5 | Production quality and flow reports | First-pass acceptance rate among reviewed designs, rework count/reasons, completion-to-upload and upload-to-live waiting time | Extends existing time/productivity reports. Reliable repeated-review statistics depend on event/revision history. Distinguish waiting elapsed time from active labor time; do not infer quality from mouse activity. | Medium after history |
| 6 | Owner action digest | Extend existing Telegram/daily/weekly summaries with aged queues, pending fixes and failed jobs; link to the relevant filtered list | Existing notifications already exist. This adds actionable content, deduplication and configurable thresholds, rather than a second alert system. Keep salary data out of shared messages. | Small–medium |
| 7 | External service/job monitoring and restore drill | Confirm external uptime monitor setup; add success heartbeats for scheduled backups/jobs and record isolated restore results | Offsite backup already exists. This adds independent evidence that jobs ran and data can be restored. Roadmap R4 still describes external-account setup as pending; verify account state before assuming it is missing. | Small–medium plus operations |
| 8 | Product results and estimated production cost | Owner-only CSV import of sales/royalty data, match to the product's `liveAsin`, unmatched-row review and duplicate-import protection | Connects completed work to business results. Reference `asin` and own-product `liveAsin` must stay distinct. Sales data alone is not profit; labor allocation and other costs must be explicit estimates. Platform-specific API access remains unverified, so start with authorized exports. | Medium–large |

Effort labels are relative scope judgments, not delivery estimates. Acceptance criteria and sample screens should precede scheduling.

## Suggested order

1. Build history, then the queue/aging board. These establish trustworthy data and make daily follow-up easier.
2. Add proofing, workload views and action digests based on actual team usage.
3. Add quality reports and product-result reporting once their required history/import data exists.
4. Verify independent monitoring and a restore drill alongside feature work.

AI Bengali summaries remain a later roadmap candidate (R17). A deterministic action digest can provide value first. Any later AI version should use approved aggregates, link each claim to its source figures, and avoid automatic pay or disciplinary decisions. Existing rejected/paused requirements, including meeting-aware time crediting, are not reopened by this research.

## Research sources and how they informed the proposals

- [ClickUp Proofing](https://help.clickup.com/hc/en-us/articles/6325985679383-Annotate-images-videos-and-PDFs-with-Proofing): attachment comments can be placed on images/PDFs and assigned/resolved. Supports the proofing pattern; our immutable revision reference is a proposed design choice.
- [Asana workload](https://help.asana.com/s/article/portfolio-workload-and-universal-workload): task-based capacity views inform the workload proposal. Our queue and cap rules remain oXeio-specific.
- [Hubstaff project cost tracking](https://hubstaff.com/project-cost-tracking-software): hours, project costs and budgets inform the cost-view direction. CSV royalties and ASIN matching are our proposed adaptation, not a claim about Hubstaff.
- [Time Doctor features](https://www.timedoctor.com/features): reporting and workload insights provide comparison context; oXeio already has substantial time/activity reporting.
- [UptimeRobot cron monitoring](https://uptimerobot.com/cron-job-monitoring/): job-completion heartbeats can expose jobs that fail or never run. A successful heartbeat does not prove a backup is restorable; the restore drill is a separate recommendation.
- Local evidence: [roadmap](10-Roadmap.md), [gap analysis G172/G173](08-Gap-Analysis.md), `server/prisma/schema.prisma`, `server/src/targets/targets.service.ts`, and `server/src/reports/reports.controller.ts` under `oxeio-monitor/`.

No new external service was connected and no application feature or production setting was changed during this research.
