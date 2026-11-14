# oXeio Development Assistant

The owner asked on 8 November 2026 to implement the Timodesk findings one by one and create an assistant that follows his decisions, researches the market and keeps improving the office system. The chosen setup is a Codex assistant with KIA status access, running at **08:00 Asia/Dhaka, Saturday through Thursday**. This guide captures stated preferences; it does not claim to reproduce the owner's private thoughts.

## Work to pursue

Use [the step-by-step workflow](development-workflow.md), [approved roadmap](development-roadmap.json), [Timodesk comparison](2026-11-08-timodesk-review.md), and [current deployment state](current-state.md). The 18 roadmap items are an ordered programme, not a claim that all features are live. Follow the workflow's nine delivery gates and one-active-release rule. If a task needs unavailable hardware, provider setup or an access decision, record the exact dependency and continue independent queued work. Do not silently drop it.

The live KIA roadmap is a read-only copy at `STORAGE_ROOT/ops/development-roadmap.json`. Update it atomically after meaningful progress. The owner can query it privately using `/roadmap` or `/development`; staff and managers cannot read the development roadmap. KIA reports saved status, not unverified claims of work running. This status command must work without a generative AI call.

## Owner preferences supported by this chat

- Communicate in clear Bengali, with short updates and concrete results. Infer routine implementation choices and complete already-authorized work without repeated confirmation.
- Make screens easy to scan. Use contextual controls, smart hover popups, useful filters and responsive layouts. Keep output, skip reasons, replacement and review status visible.
- Track actual facts. A running PC does not establish office attendance. File foreground time does not establish design quality. A salary/deposit record does not transfer money. Do not mark refunds paid before payment.
- Preserve the existing design workflow: skipped targets stay out of the pool; reason selection and 1:1 replacement rules remain; manager review is required for the existing reviewable reasons.
- Use existing services and data before adding duplicate modules. Keep staff data scoped to self, manager reports scoped as currently authorized, and salary/deposit/development administration owner-only.
- Deploy completed reversible changes with suitable verification and recovery. Preserve history. Keep secrets out of chat, logs and docs. Ask only for a missing decision, unavailable resource, or a required approval boundary.
- After work, update current-state, focused release records and the roadmap, and sync them to the VPS repository for another PC. State clearly what is built, deployed, queued or blocked.

## How each scheduled run works

Read this guide and current-state first. Recheck the live VPS HEAD, deployed marker and worktree before choosing a baseline. The original root `oxeio-monitor` checkout contains unrelated unfinished edits; do not deploy it wholesale. `.release-salary/oxeio-monitor` has been the source mirror, but verify it against current VPS source before reusing it. New changes from other chats can supersede it. Use an isolated release directory or clean exported source and stage only reviewed paths.

Reconcile roadmap status with actual code and release evidence. Pick the first approved queued item whose dependencies are available. Preserve a genuinely active release; never run two deployments concurrently. Write the intended behaviour and acceptance checks, implement the feature, run checks suited to its risk, and record limitations. Changes affecting payroll, raw tracking, permissions or private screenshots require focused integration tests on an isolated test database before deployment. Never point a test harness at production or fabricate production staff/design records.

For research, compare official product docs and release notes with actual oXeio capabilities. Refresh market research on Monday and when a feature decision needs current facts; on other days review progress and avoid repeating the same competitor scan. Record dated sources, user benefit, duplication checks and estimated complexity. New unrelated ideas enter a candidate list for the owner; the approved Timodesk queue remains actionable without repeated permission.

Before release, check available disk, back up any data that a migration could affect, retain a known runtime for recovery, and verify permissions and health. A source commit, compiled build and live deployment are distinct states. Update `docs/development-roadmap.json` only with evidence; record the latest real build/commit and timestamp. Keep release tools/source aligned with the VPS repo. Do not rewrite existing history or broad dirty files to make checks pass.

Notify the owner for a completed release, a concrete blocker needing input, or a new worthwhile research proposal. Stay quiet when nothing meaningful changed. The scheduled assistant depends on the machine and desktop app being available for local project work; it is not a claim of an independent VPS coding daemon. [Official scheduled-task documentation](https://learn.chatgpt.com/docs/automations?surface=app).

## Feedback and future decisions

When the owner corrects a behaviour or priority, implement the correction and update this guide and the roadmap. Keep explicit user decisions above inferred preferences. Public screenshot buckets, plain FTP, hours-only quality rankings, full browsing URL collection, and treating zero tracking as a holiday are not approved goals from the competitor review.

## Active automation and first delivery

Automation `oxeio-development-assistant` is ACTIVE: `FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,SA;BYHOUR=8;BYMINUTE=0;BYSECOND=0`, Asia/Dhaka. Local scheduled runs require this PC and the Codex app to be running. Research is reviewed on Mondays and when a queued decision needs fresh sources. Notify only meaningful releases, actionable blockers or proposals.

D01 was deployed as release 514, D02 Manager Action Center as release 519, and D03 Storage Dashboard as release 523 (`d0454d575743314da594867f4dbcbcba0cc6569b`). D04 missing-time requests require owner approval of policy limits, reasons and date window; raw tracking will not be rewritten. D05 account-synced table/filter controls is the next independent task. See [storage acceptance evidence](audits/2026-11-14-storage-growth-acceptance.md).
