# Development assistant and design evidence — 8 November 2026

Release 514, app commit c50da8f4488c318ff34facf9329216ffd16e2870, deployed API and web. PostgreSQL unchanged; no migration, financial or attendance changes.

ACTIVE automation `oxeio-development-assistant`: 08:00 Asia/Dhaka Saturday–Thursday in this chat. Local PC and Codex must run. Monday research and sequential delivery follow the assistant guide. D01 deployed; D02 queued next; 17 items remain.

Design details shows per-staff file foreground observations, private retained screenshots, brief/help/checklist and timeline. Existing history/review remain. Evidence endpoint enforces owner/manager or current-assignee scope, signed screenshot URLs and audit. Device overlaps are unioned per staff. Foreground observations are not payroll credit, verified attendance or quality.

Owner private KIA /roadmap and /development use validated fixed snapshots without AI calls. Other roles denied; group commands direct privately. Live snapshot: /opt/oxeio/oxeio-monitor/.data/storage/ops/development-roadmap.json, root:1000 mode640, updated atomically.

Verification: server/web typecheck and lint pass. Local focused 12 tests pass. Isolated PostgreSQL integration 35 tests across 6 files pass, including production/trend regressions and evidence/access/roadmap cases. No production data/credentials used for tests; test containers/network removed. Existing live design smoke: 3 observations, 2 screenshots, 784ms. Internal saved roadmap rendering 4ms, not Telegram end-to-end latency. Anonymous evidence and roadmap endpoints 401. API/web healthy514; public JS byte-identical to exact-source build. Browser visual QA not completed.

Release evidence: /opt/oxeio-releases/dev-assistant-evidence-20261108. Source /opt/oxeio, mirror .release-salary/oxeio-monitor. API dependency-lock and Prisma hashes matched prior runtime; tested compiled server and exact-source web assets installed. Rollback images oxeio-api:before-dev-assistant-evidence-20261108 and oxeio-web:before-dev-assistant-evidence-20261108. Deployed marker remains app commit after docs-only commit.

Disposable test image and unused builder cache cleaned; 1.704GB cache reclaimed. Disk87%, approximately11GB free. D03 storage analysis remains queued.
