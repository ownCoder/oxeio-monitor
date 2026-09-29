# Current state — অন্য PC থেকে কাজ চালু করার নোট

সর্বশেষ আপডেট: ২৯ সেপ্টেম্বর ২০২৬ · Asia/Dhaka

## Live

- সর্বশেষ কাজ: Search, Notification inbox এবং Deadline/reminder live। Header থেকে Search/Inbox; একই workspace page-এ Deadlines। Read status account অনুযায়ী অন্য PC-তেও থাকে; reminder app-এর ভেতরে। [Release 433](audits/2026-09-29-workspace-tools.md) · [ব্যবহারবিধি ও limits](workspace-tools-operations.md)।
- আগের কাজ: Sidebar-এর Office ও Production নিচে, Settings-এর পরে রাখা হয়েছে। [Release 430](audits/2026-09-29-sidebar-order.md)।
- আগের কাজ: Office workspace-এর আটটি section এবং পূর্বে তৈরি Production workspace live। Brief templates, Help requests, submission checks, SOP acknowledgement, equipment, joining/leaving এবং coaching ব্যবহারের জন্য প্রস্তুত। [Release 428 record](audits/2026-09-29-office-workspace.md) · [ব্যবহারবিধি](office-workspace-operations.md)।
- আগের কাজ: My Data-তে clicked/opened design selected থাকে, একই browser/account-এ refresh-এর পর ফিরে আসে; targets number অনুযায়ী ছোট থেকে বড় সাজানো। [Release 424](audits/2026-09-29-my-target-selection.md)।
- আগের কাজ: skip insights, design history, saved/shareable filters ও independent API/database/backup monitors live। September snapshot-এর ১২ জনের reconciliation-এ zero mismatch; latest local এবং existing offsite backup restore verified। Physical PC acceptance, inbox delivery এবং নতুন offsite upload/daily schedule এখনও pending। [Implementation ও acceptance record](audits/2026-09-28-system-improvements.md)।
- Site: https://hub.oxeio.com
- Web/API: **433 / 1bd6c4e**। Public HTTPS health ও দুই container healthy যাচাই করা হয়েছে।
- আগের কাজ: Design Pool থেকে To upload/To make live queues এবং row/More actions-এর Uploaded/Live buttons সরানো। [Release 418](audits/2026-09-28-pool-no-upload-live.md)।
- আগের কাজ: Add design targets থেকে Uploaded ও Live on Amazon tiles সরানো; তিনটি tile (In the pool, In hand, Designed) রাখা এবং layout/hint সংশোধন। [Release 416](audits/2026-09-28-add-target-three-stages.md)।
- আগের কাজ: **Design Pool audit**—delete API permissions, unfixed-error Upload block, dropped-target queues ও completion-date filters corrected. Added reset/refresh, date shortcuts, protected selection and page CSV export. [Audit](audits/2026-09-28-design-pool.md) · [ব্যবহারবিধি](design-pool-operations.md)।
- Add design targets-এর Distribute now removal বহাল; সকাল 08:00 automatic distribution চালু। [Release 412 record](audits/2026-09-27-remove-distribute.md)।
- Release 411-এর skip review বহাল: প্রতি Dhaka day প্রথম ৩টি automatic skip; পরের request owner/manager review না হওয়া পর্যন্ত assigned থাকে। [ব্যবহারবিধি](skip-review-operations.md) · [Release 411 record](audits/2026-09-27-skip-review.md)।

## যাচাই

- Release 432/433: 24 database integration tests (5 new workspace tests) এবং 293 frontend tests; clean API/web builds/typechecks/targeted lint। Current encrypted backup isolated restore/migration passed, core data counts unchanged। Chrome synthetic UI flows verified; authenticated live UI test করা হয়নি। Public health, bundle hash, protected endpoint 401 এবং healthy containers verified। One additive receipts migration, no seed।

- পরের feature পর্যায়ে side-by-side version comparison, attachment/reference library, image similarity, bulk edit/reassign preview এবং leave-aware planning এখনও implement হয়নি।

- Release 430: scoped two-item sidebar reorder; clean production build/typecheck ও targeted lint passed। Public health/container verification, PostgreSQL unchanged; no migration/seed। Authenticated browser UI test করা হয়নি।

- Release 427/428: 1,254 server unit + 293 frontend + 109 integration tests passed। Clean builds/lint এবং main local typechecks passed; retained encrypted backup isolated restore/upgrade passed; two migrations, no seed/payroll closure। Chrome synthetic owner/staff flows এবং live owner UI verified।

- Release 424: 285 frontend tests, production build/typecheck, targeted lint এবং Chrome component preview passed। Public app bundle hash matched; healthy API/web/database, PostgreSQL unchanged। No migration/seed।

- Release 421/422: 261 backend + 282 frontend tests; readiness/operations 46 tests; current agent core 102 focused tests. Builds, targeted lint, public readiness GET/HEAD, healthy containers এবং unchanged PostgreSQL verified. No migration/seed. Agent unit tests physical PC acceptance নয়।
- Payroll: snapshot 28 September 02:30 Dhaka; daily/monthly/payroll/self-view/report hours matched, net arithmetic matched. Owner review/month-end reconciliation ছাড়া month close করবেন না। Private review: `/opt/oxeio-releases/system-improvements-20260928/private-review/payroll-review-2026-09.html`।

- Release 418: frontend 279 tests passed, production build/typecheck ও targeted lint; no migration or seed. Final Chrome/health evidence release record-এ।

- Release 416: UI-only change; frontend build/typecheck ও targeted lint, live Chrome এবং HTTPS verification-এর record release note-এ। No migration or seed.

- Release 414: backend 138 এবং frontend 281 tests passed; final 8 audit cases re-run passed. Typecheck, lint/build, encrypted backup parsing, public HTTPS ও bundle hash verified. No migration or seed.

- Release 412: local typecheck ও targeted lint; production build; public HTML, bundle hash এবং Distribute now অনুপস্থিতি যাচাই। Database migration লাগেনি।
- Release 411: exact source-এ ৮ integration + ৪০ rule test; encrypted backup parsing; ২ migration; matching API/web commit ও public bundle যাচাই।
- Applied migrations: `20260926010000_target_history`, `20260927010000_skip_review_limit`, `20260926020000_production_workspace`, `20260929010000_office_workflows`। Seed চালানো হয়নি। PostgreSQL container পুনরায় তৈরি করা হয়নি।

## Source ও access

- Current VPS: `165.101.189.253`, SSH port `2222`, user `root`; repository `/opt/oxeio`, compose directory `/opt/oxeio/oxeio-monitor`।
- এই PC-তে `ssh oxeio-vps` passwordless access verified। অন্য PC-তে অনুমোদিত key/access আলাদাভাবে থাকতে হবে; এই নির্দেশ key sync করে না।
- Deployed application commit marker: `/opt/oxeio/.git/oxeio-deployed-commit`। পরে docs-only commit হলে repository HEAD app commit-এর চেয়ে এগিয়ে থাকতে পারে।
- Shared handoff copy: `/opt/oxeio/docs/current-state.md`। GitHub বা অন্য PC-তে automatic sync যাচাই করা হয়নি; এই নথির update-এ GitHub push করা হয়নি।
- Release directories: `/opt/oxeio-releases/skip-review-20260927`, `/opt/oxeio-releases/remove-distribute-20260927`, `/opt/oxeio-releases/design-pool-audit-20260928`।

## পরবর্তী feature research

- 29 September market comparison: [recommendations](2026-09-29-market-research.md)। First pilot: brief templates, blocker/help requests, submission checklist; existing local proofing/workload আগে scoped review/release। Owner approved implementation; Office ও Production release 428 live। First-use content/pilot instructions: [guide](office-workspace-operations.md)।

## অসমাপ্ত / unreleased

- Production workspace ও migration এখন live। Main checkout-এ unrelated agent/payroll/Studio পরিবর্তন রয়ে গেছে; সেগুলো এই release-এ অন্তর্ভুক্ত নয়।
- Recorded skip insights এবং management design history release 421-এ live। Missing historical data reconstructed নয়; automatic sanctions নেই।
- পুরো পুরোনো/dirty local checkout deploy করবেন না। Current VPS source-এর সঙ্গে scope মিলিয়ে পরের release বানাতে হবে।

## Recovery ও পরবর্তী কাজ

- Latest source/evidence: `/opt/oxeio-releases/office-workflows-20260929`; clean mirror `.release-office`। Rollback to 424: `before-office-workflows-20260929` API/web tags। [Details](audits/2026-09-29-office-workspace.md)।
- Previous source/evidence: `/opt/oxeio-releases/my-target-selection-20260929`; clean mirror `.release-my-targets`। Rollback to 422: `before-my-target-selection-20260929` API/web tags। [Details](audits/2026-09-29-my-target-selection.md)।
- Previous release/evidence/source bundle: `/opt/oxeio-releases/system-improvements-20260928`। Local clean mirror `.release-system`; eleven scoped files deployed source-এর সঙ্গে SHA256 matched: [manifest](audits/system-source-alignment.json)। Main dirty checkout আলাদা pending কাজ রাখে।
- UptimeRobot: API/database monitor `804106657`, backup freshness monitor `804106772`; five-minute checks, existing account email. দুটোই Up observed; test email inbox receipt এখনও owner confirmation pending। Backup probe local success/failure/26-hour stale state দেখে; B2 freshness নয়।
- Local Sep28 এবং existing B2 Sep26 encrypted backups আলাদা network-none containers-এ restored; [local evidence](audits/restore-latest-backup.json), [offsite evidence](audits/restore-offsite-backup.json)। Weekly offsite timer এখনও unchanged।
- Latest Sep28 encrypted backup → existing B2 `oxeio-backups` upload/daily schedule automatic approval rejection-এর পর specific owner approval pending। Prepared drafts run/install হয়নি।
- Physical acceptance-এর permission আছে, কিন্তু নির্দিষ্ট office PC/device এবং access method পাওয়া যায়নি। [Procedure](audits/2026-09-28-system-improvements.md) প্রস্তুত; restart/sleep/network test চালানো হয়েছে বলা যাবে না।
- Rollback to 421: `oxeio-api:before-monitor-readiness-20260928`, `oxeio-web:before-monitor-readiness-20260928`; initial feature rollback to 418: `before-system-improvements-20260928` image tags। Both compose files mandatory।

- Release 414-এর আগের images: `oxeio-api:before-pool-audit-20260928`, `oxeio-web:before-pool-audit-20260928` (release 412)।
- Current release encrypted backup/source bundle: `/opt/oxeio-releases/design-pool-audit-20260928`।
- Saved/shareable filters, history ও recorded skip-rate report এখন live। Full filtered export এখনও নেই; current CSV visible page export করে।

- Release 412-এর আগের images: `oxeio-api:before-remove-distribute`, `oxeio-web:before-remove-distribute` — এগুলো release 411, যেখানে skip review আছে।
- Encrypted pre-411 backup ও source bundle-এর তথ্য [release 411 record](audits/2026-09-27-skip-review.md)-এ। Pending skips থাকলে skip-review-বিহীন পুরোনো API-তে rollback করা যাবে না; আগে নতুন API দিয়ে সিদ্ধান্ত দিতে হবে।
- কাজ শুরুতে [স্থায়ী নির্দেশনা](work-preferences.md) পড়ুন। কাজ শেষে এই নথি এবং সংশ্লিষ্ট docs আপডেট করে shared copy কোথায় সংরক্ষিত হলো যাচাই করুন।
