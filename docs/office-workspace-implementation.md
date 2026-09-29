# Office workspace implementation — approved 29 September 2026

Owner approved starting all recommendations in [market research](2026-09-29-market-research.md).

| Scope | Implementation |
|---|---|
| Brief templates and target briefs | Typed/validated content; reusable template copy, design lookup, current-assignment visibility |
| Blocker/help requests | Assigned-target scope, manager response/resolution, no status/time/pay side effects |
| Submission checklist/preflight | Versioned checklist snapshot; local PNG/JPEG metadata reading; server advisory warnings |
| Today panel | Role-specific work links, exact scoped open-help/assignment counts and recent follow-up |
| SOP/example instructions | Search, version-specific read acknowledgement, archived restore; text/reference examples |
| Equipment register | Unique tag, optional existing Device link, employee handover, warranty and repair notes/history |
| Joining/leaving | Reusable templates, employee cases, responsible people, due date, recorded task completion |
| Skills/coaching | Manager-entered assessments/goals and employee self-view |
| Existing Production workspace | Scoped integration of prior implementation: proofing, workload/planning, quality, digest/monitor UI, sales CSV |

Release source is assembled under `.release-office`, using the live 424 archive plus named existing Production files. The main dirty checkout is preserved; unrelated agent/payroll/Studio changes are excluded. New records use validated kinds in `OfficeEntry`, immutable transactional `OfficeEvent` snapshots and version-specific `OfficeAcknowledgement`; linked employee/target and actor IDs have database foreign keys. Conditional version updates reject lost edits. Target/checklist read locks keep staff authorization and reviewed checklist versions consistent with concurrent writes.

Schema changes: existing `20260926020000_production_workspace` plus new `20260929010000_office_workflows`. Production needs an encrypted pre-release backup, migration validation and coordinated API/web release. No seed, guessed office policy, payroll close or real staff assessment is part of this implementation.

Operations: [usage guide](office-workspace-operations.md). Test, browser and deployed states will be recorded separately in the release audit/current-state. External digest delivery remains opt-in and must use a verified owner destination. Previous specific offsite-upload approval, alert inbox receipt and physical-PC acceptance are separate pending operational items.
