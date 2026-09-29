# Workspace Search, Inbox ও Deadline reminders

Application: **433 / 1bd6c4e** · 29 September 2026.

## আচরণ

- Header-এর Search ও Inbox; workspace page-এ Search/Inbox/Deadlines tabs। Search-এ job number, ASIN, staff এবং Office title; exact record/design links।
- Bounded recent inbox: current assignments, Office updates/help responses, unresolved review comments, pending skip approvals এবং due-soon/overdue। Account-scoped durable read receipts; header badge তাৎক্ষণিক refresh।
- Existing Production Planning due date ব্যবহার করে active design deadline list ও 24-hour reminders। Reassignment/completion/deadline changes পুরোনো reminder সরায়; read due-soon থেকে overdue হলে নতুন unread item আসে।
- Staff/researcher results নিজের assignment ও Office permission scope অনুসরণ করে; management scope owner/manager-এর। Search/read/inbox নতুন salary বা device telemetry access দেয় না।
- App inbox only; email/Telegram/background push enabled হয়নি। [ব্যবহারবিধি ও limits](../workspace-tools-operations.md)।

## যাচাই

- Clean VPS-aligned source: API typecheck/targeted lint, API production build; frontend production build/targeted lint। Main local API/web typechecks passed।
- 24 database integration tests: 5 new workspace isolation/read/reminder tests + existing Office/Production tests। 293 frontend tests passed। Final inbox refresh dependency cleanup-এর পরে frontend build/lint/293 tests আবার passed।
- Chrome synthetic preview: job-number search, unread filter, read persistence after reload, immediate header badge refresh এবং Dhaka deadline view verified। [Sample screenshot](workspace-tools-preview.png)। Authenticated live owner/designer UI action করা হয়নি।
- Current encrypted pre-release backup isolated PostgreSQL restore; additive migration applied। Employees/targets/monthly rows/salary periods/closures/Office entry counts unchanged; restored new receipts table empty। This is an upgrade drill, not a fresh payroll reconciliation।
- Live HTTPS health, API/web healthy, unchanged PostgreSQL container and public frontend bundle verified। One additive migration `20260929020000_workspace_inbox`; no seed/fixture insertion।
- Public asset `/assets/index-C-PR-MCq.js` matches container SHA256 `265e7cb2659c4a989b108ee7f5add772358db6c654e17314ee09196f73885fb0`। All 13 deployed source hashes match the clean local release mirror। Search/Inbox/Deadlines unauthenticated requests return 401।

## Source ও recovery

- VPS `/opt/oxeio`; shared handoff `docs/current-state.md`। Local clean release source `.release-office`; dirty main checkout-এর unrelated changes deploy করা হয়নি। Main AppModule registration remains in `app(1).module.ts`।
- Evidence, encrypted backup, test/build logs ও source bundle: `/opt/oxeio-releases/workspace-tools-20260929`।
- Rollback images: `oxeio-api:before-workspace-tools-20260929`, `oxeio-web:before-workspace-tools-20260929` (application 430)। Both compose files required. Additive receipts table can stay during app rollback; do not restore stale database or delete receipts casually.
- Application 432 introduced features; following UI-only cleanup keeps the read-event hook dependency explicit. Deployed marker is `.git/oxeio-deployed-commit`; later docs-only commits may advance HEAD.
- Docs hashes matched local/VPS; no GitHub push or automatic other-PC sync claimed। Prior physical-PC, monitor-email and offsite-upload acceptance remain pending।
- Later features (version comparison/reference assets/similarity/bulk edits/leave-aware planning) are not implemented in this phase; see operations document.
