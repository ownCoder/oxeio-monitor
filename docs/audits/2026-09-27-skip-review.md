# Daily skip review gate — 27 September 2026

First implementation phase requested by the owner: accurate request records, three automatic skips per Dhaka day, and review before further replacements.

## Behaviour

- Every successful designer skip request is stored in `design_skip_requests`, with target, employee, actor, reason, request time and decision. Rejection, un-skip and reassignment do not erase or refund requests.
- The first three requests each Asia/Dhaka calendar day transition to `skipped`. Subsequent requests remain `assigned` with `skip_review_pending=true`.
- Pending assignments occupy slots in scheduled top-up and distribution, survive end-of-day return, and cannot be completed, reassigned, returned to the pool or deleted through alternate application routes.
- Allocation rechecks occupied slots under the same employee lock and claims a batch atomically, so overlapping top-ups cannot issue duplicate replacements for a vacant slot. Existing daily issuance limits remain enforced.
- Only owner/manager can approve or reject through `POST /design-targets/:id/skip-decision`. Approval removes the assignment and invokes the normal replenishment rules (pool availability and existing daily limits still apply). Rejection returns the same assignment to the designer. Competing decisions cannot overwrite one another.
- Employees see pending work separately, remaining automatic allowance, and may continue other assignments. Review lists show pending requests with approval/rejection actions.
- Review/Skipped date filters use the recorded skip-request time, rather than the assignment/start date. Legacy skips have no fabricated timestamp and remain accessible without date filters. Deleted records are also accessible without the Review date filter.
- The target-history trigger deployed with this release captures request and decision changes atomically. The separate request ledger supplies daily counts independently of current target status.

## Scope and rollout

This phase does not add screenshot evidence uploads, comparative skip-rate dashboards or automatic employee sanctions. Historical requests are not backfilled and existing skipped designs are not retrospectively put on hold.

This release applied `20260926010000_target_history` and `20260927010000_skip_review_limit` before running the new API and web build. The migration is additive and does not change historical assignments. Do not roll back to an old API while pending requests exist: old code does not understand their occupied slots. Resolve them with the new API first.

The workspace contained a missing `src/app.module.ts` and an existing `src/app(1).module.ts`. A forwarding entry point preserves the existing local module and restores local build/test imports. The deployment uses the clean live module; the unrelated production workspace and its navigation links are excluded.

SSH key access to the current host (165.101.189.253:2222) is now verified. The owner entered the login password in a native terminal; no password was captured in chat. The scoped release is build 411, commit `5dd3783`, based on live source `bc44219`. Deployment completed and verified at 2026-09-27 12:33 Asia/Dhaka. API and web are healthy; public HTTPS health reports build 411 / commit 5dd3783. The public JavaScript SHA-256 matches the deployed image, includes the new controls, and includes the same commit. PostgreSQL retained its original container identity. Only the two scoped migrations were applied; no seed ran.

## Local workspace verification (includes unreleased expansion)

- Isolated PostgreSQL 16 test container; no production database used.
- All 38 migrations applied successfully to an empty test database.
- Server typecheck and build passed.
- Web production build and 284 tests passed.
- All 8 new skip-review integration tests passed, including concurrent requests, retries/ownership, overnight distribution, rejection/history, competing decisions, Dhaka midnight, alternate routes/date filtering, and HTTP reviewer authorization.
- The 40 target-rule unit tests passed. The initial lifecycle run passed 9 of 10 tests; the remaining test failed while opening cold connections over SSH. Preparing the holder/writer/observer connections before the timed lock made the unchanged concurrency assertions pass on rerun.
- Two existing distribution regressions passed: 30 assignments per designer without duplicates, and stable job numbers through return/reallocation.
- Targeted server and web lint checks passed.

## Exact release validation

- The scoped live-source build passed backend and frontend compilation.
- All 37 scoped migrations applied to a disposable PostgreSQL 16 database.
- All 8 skip-review integration tests and 40 target-rule tests passed on that exact backend source.
- An encrypted predeployment dump was decrypted and parsed successfully in a disposable container.
- Release files, encrypted backup, and source bundle are saved under `/opt/oxeio-releases/skip-review-20260927` on the VPS.

## Deployment recovery

- Previous images: `oxeio-api:before-skip-review-20260927`, `oxeio-web:before-skip-review-20260927`.
- New images: `oxeio-api:skip-review-5dd3783`, `oxeio-web:skip-review-5dd3783`.
- Verified encrypted backup: `/opt/oxeio-releases/skip-review-20260927/before-skip-review.dump.enc` (uses the existing backup passphrase; no secret was printed).
- Exact source bundle saved on the VPS and locally as `docs/audits/skip-review-release-411.bundle`.
- The live release excludes the unreleased production module and its schema. The local workspace still contains that separate work; do not publish the entire working tree over this scoped release.
- Resolve all pending skips through the new API before considering any old-API rollback.