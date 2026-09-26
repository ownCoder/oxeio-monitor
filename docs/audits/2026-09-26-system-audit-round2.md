# System audit — round 2 — 26 September 2026

**Repair update:** B01–B03 are fixed and deployed in release **409 / 1081b09**. See [round 2 fix record](2026-09-26-round2-fixes.md) for current status and tests. The findings and reproduction instructions below describe the pre-fix `eb5e681` snapshot; run the historical characterization files only against that snapshot.

Audited source: `eb5e681` on `main`. This is a new audit following the completed A01–A07 fixes, not a reopening of those sequential fixes. No application code or production data was changed in this round.

## Findings

### B01 — P2: newly started work can be returned to the pool

- Location: `oxeio-monitor/server/src/targets/targets.service.ts:523`, particularly the write predicate at line 555.
- `returnUnworked()` reads assigned targets and excludes those whose `startedAt` is set. Its subsequent update checks only ID and assigned status.
- If the agent records a start between those operations, the update still changes the target to `pool` and removes the employee assignment. This violates the explicit rule that started work stays assigned.
- Deterministic service reproduction: read an unstarted target, record its start before the update, execute the real service. Result: `returned: 1`, `startedAt` populated, status `pool`, employee null.
- Suggested repair: make eligibility part of the atomic write, including `startedAt: null`; also review concurrent credit creation and the start writer so the protection holds in both execution orders.

### B02 — P2: stage writes can outlive their prerequisites

- Location: `oxeio-monitor/server/src/targets/targets.service.ts:1834` (`markUploaded`). Related read-then-write patterns: `markChecked` line 1749, `markFixed` line 1786, `markLive` line 1865.
- Upload first reads completion, then writes using only the target ID. An undo can clear completion between these operations; the delayed upload still succeeds. Returning to the pool can similarly race a delayed stage write.
- Deterministic service reproduction: read a completed, not-uploaded row; simulate concurrent undo; continue upload. Result: status `assigned`, `completedAt: null`, but `uploadedAt` populated.
- A second reproduction sends two upload requests after both read a null upload time. The later request overwrites the first timestamp, violating the documented idempotency guarantee.
- The other stage methods share the unsafe predicate pattern, but were not separately exercised. These are one stage-transition concurrency issue, not four independently reproduced bugs.
- Suggested repair: conditional atomic stage updates or coordinated row locking, checking prerequisites and the unset destination timestamp at write time. Preserve existing not-found, invalid-stage, and idempotent behavior.

### B03 — P2: failed logout presents a signed-out state while the session can remain valid

- Location: `oxeio-monitor/web/src/auth/AuthContext.tsx:116`; callers include `components/Layout.tsx:359` and the idle-expiry callback.
- `signOut()` clears the local user in `finally`, even if the request fails before reaching the server. The server clears the cookie only when its logout handler runs (`server/src/auth/auth.controller.ts:84`).
- Result: the login screen appears although the cookie may still authenticate. A later refresh or online event can restore the session without credentials. This matters on shared computers. The callers also discard the rejected promise without a visible logout error.
- Reproduced using the actual `AuthProvider` with mocked hooks and network: reject logout, observe `setUser(null)`, then return the still-authenticated session from refresh and observe the user restored.
- This is a controlled failure-path reproduction, not a live browser/cookie test. The production owner's session was not altered.
- Suggested repair: distinguish pending/failed server logout from confirmed logout, surface failure and retry, and prevent background refresh from silently undoing an outstanding logout intent.

## Verification and evidence

- Backend typecheck passed; existing no-database suite: **1,230 passed, 1 skipped**, 51 files.
- Web typecheck passed; existing suite: **264 passed**, 9 files.
- Agent regression suite: **403 Core + 130 Agent tests passed**.
- Three target characterization tests and one logout characterization test reproduced the findings above. These tests assert the faulty observed behavior; their passing result means the bug was reproduced, not fixed.
- Saved evidence: [target reproductions](round2-target-repro.spec.ts.txt), [logout reproduction](round2-logout-repro.spec.ts.txt).
- To rerun, copy the respective text file into the server or web `test/audit-round2.tmp.spec.ts`. From server run `npx vitest run --config vitest.nodb.config.ts test/audit-round2.tmp.spec.ts`; from web run `npx vitest run test/audit-round2.tmp.spec.ts`. Remove the temporary copies afterward. They deliberately remain outside the normal regression suite until rewritten as post-fix invariants.
- Read-only VPS check: `oxeio-web`, `oxeio-api`, and `oxeio-postgres` all report **healthy**.

## Scope and limits

This round covers regression tests, targeted concurrency/auth review, deterministic mocked interleavings against real service/provider code, and container health. No new real-PostgreSQL concurrency run, production-record mutation, browser end-to-end session test, or full security penetration test was performed. Findings establish reachable code paths; they do not establish that production records have already been affected. Potential concurrent top-up over-allocation remains unconfirmed and is not counted as a finding.

At the end of the audit, all three findings were open. They have since been repaired at the owner's request; see the fix record above. The earlier [fix tracker](2026-09-26-fix-tracker.md) remains the record for A01–A07.
