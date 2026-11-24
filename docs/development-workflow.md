# oXeio step-by-step development workflow

Owner decision: complete the remaining Timodesk-derived roadmap items one by one. The active Codex heartbeat runs at 08:00 Asia/Dhaka, Saturday through Thursday. It uses this workflow; the local PC and Codex app must be running.

## Work-in-progress rule

Only one cohesive product release may be active at a time. Select the first `in_progress` task, otherwise the highest-priority `queued` task whose dependencies are available. A large task may ship in small usable slices, but the roadmap task stays `in_progress` until all its acceptance checks are met. Do not mark research, a mockup, source edits, or passing tests as deployed.

If a task needs hardware, credentials, a provider, a policy decision, or new authority, record the exact blocker and continue with the next approved independent item. Never hide or silently drop the blocked task.

## Nine-step delivery loop

1. **Reconcile reality.** Read `development-assistant.md`, `development-roadmap.json`, `current-state.md` and the latest focused audit. Verify live VPS HEAD, deployed marker, service health, disk space and whether another release is active.
2. **Define the slice.** State the user-visible behaviour, roles allowed, data affected, acceptance checks, known non-goals and rollback path. Reuse existing services and UI patterns before adding a new module.
3. **Choose a clean baseline.** Export the current VPS source or use a verified clean mirror/worktree. Preserve unrelated edits. Never deploy the stale root checkout wholesale.
4. **Implement one usable slice.** Keep permissions on the server, transactions around lifecycle changes, and honest labels for inferred/observed data. Avoid schema changes unless the feature truly requires them.
5. **Verify proportionately.** Always run typecheck/lint for changed applications. Add focused tests for permissions, state transitions and calculations. Payroll, attendance, permissions, screenshots or destructive lifecycle changes require an isolated database integration test. Never test writes against production.
6. **Prepare a guarded release.** Commit only reviewed paths, generate accurate build metadata, retain a rollback image or equivalent recovery point, and check sufficient disk space. Do not overwrite the deployed marker before health checks pass.
7. **Deploy and verify live.** Deploy the tested artifact, confirm API/web health, anonymous access denial, public asset identity and unchanged database container when no migration was planned. Run only safe read-only or synthetic smoke checks.
8. **Record evidence.** Update the focused audit, `current-state.md`, roadmap status and last release. Sync docs to the VPS and atomically update the owner-only KIA snapshot. KIA reports recorded evidence; it does not claim a worker is currently active.
9. **Close or continue.** Mark the roadmap task `deployed` only when its full acceptance criteria are satisfied. Otherwise keep it `in_progress` with the delivered slice and exact next action. Notify the owner in concise Bengali only for a release, meaningful proposal or actionable blocker.

## Ordered queue

1. **D02 Manager Action Center:** finish the unified queue for skip review, replacement owed, overdue/unstarted work, rework and missing agent data. Every item must open the exact record. Review reason correction and safe Design Pool return are already live as the first slice.
2. **D03 Storage and retention dashboard:** separate screenshots, database, backups, Docker images/cache; show growth, retention state, last cleanup and actionable disk warnings.
3. **D04 Missing-time requests:** staff request, overlap and date-window checks, owner decision, explicit manual label and audit. Keep disabled until the owner accepts the policy; never rewrite raw tracking.
4. **D05 Account-synced table controls:** visible columns, active-filter chips and reset controls across Pool, Review, Screenshots and reports.
5. **D06 Estimate versus actual and task planning:** design estimate, actual observed/credited definitions, comparable work type, subtasks and mentions.
6. **D07 Calendar drill-down:** day/month navigation into staff and design facts while preserving configured holidays and leave.
7. **D08 Bulk tracking-policy grid:** audited bulk edits with per-staff differences visible before save.
8. **D09 Staff monthly PDF/highlighter:** own-data scope, report parity and clear recorded-time labels.
9. **D10 Personal summaries/preferences:** digest preferences using existing delivery paths without repeated unchanged notifications.
10. **D11 Quality-aware performance:** accepted output, target, rework, hours and sample size together; never infer quality from input percentage alone.
11. **D12 Team-scoped managers/invites:** explicit teams, invitation approval and permission migration tests before access expands.
12. **D13 Onboarding and agent guidance:** install/link/first-sync checklist plus clear offline, permission, update and recovery messages.
13. **D14 Read-only client portal:** disabled by default; needs explicit client/project scope and recipient before access is granted.
14. **D15 Browser toolbar monitor:** authenticated read-only prototype; publishing/installing is a separate acceptance gate.
15. **D16 macOS/Linux agent:** protocol parity first, implementation second, real-device acceptance before release.
16. **D17 Private S3-compatible screenshots:** private signed access, retry, migration and rollback; no storage switch without credentials and a verified migration plan.
17. **D18 Explicit task timing/capture context:** agent protocol and office pilot before replacing filename inference.

## Research cadence

On Monday, or when the active design decision depends on current product behaviour, check official product documentation and release notes. Record only dated candidates that solve an observed oXeio problem. Research does not interrupt an active safe release and does not add a duplicate feature.
