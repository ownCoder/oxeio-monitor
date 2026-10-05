# Current state — অন্য PC থেকে কাজ চালু করার নোট

সর্বশেষ আপডেট: ৫ অক্টোবর ২০২৬ · Asia/Dhaka

## Live

- সর্বশেষ release **449 / `52c6a9d438c71eb766556ded8553aa121d2b806a`**: Live Board-এ Windows `locked` state আর **Idle** নয়, **PC locked** নামে আলাদা count/status। OX-09-এর PC ৫ অক্টোবর 09:49 পর্যন্ত locked heartbeat পাঠিয়েছিল; মধ্যরাতের session আগের দিনের rollover, নতুন office arrival নয়। 09:49-এর পর একই device active ও screenshot পাঠিয়েছে; **কে ব্যবহার করেছেন server জানে না**, কোনো recent unlock/logon event-ও নেই। Physical/remote identity verification pending। [ঘটনা ও release record](audits/2026-10-05-ox09-idle.md)। Clean source mirror `.release-salary/oxeio-monitor`; VPS release `/opt/oxeio-releases/pc-locked-20261005`।
- আগের release **446 / `cad69e415f9bb67d695b70b884489cc3efb8f101`**: **Daily designs & skips** এখন Design Pool-এর ভিতরে নয়; Targets sidebar-এ নিজস্ব page `/targets/daily`। Owner/manager-only route, আগের daily counts/filter ও skip-rate details একই। [ব্যবহারবিধি](design-pool-operations.md) · [release record](audits/2026-10-03-daily-design-page.md)। আগের VPS release `/opt/oxeio-releases/daily-design-page-20261003`।
- আগের release **444 / `69a456a88691140504a094e5c5fe5278ccdf8053`**: daily counts/filter প্রথম চালু হয়; এখন সেই report আলাদা page-এ। শেষ ৭ দিন default; সর্বোচ্চ ৩১ দিনের range, Today/Last 7 days, staff filter, Complete/Skipped/Pending daily row ও মোট count। Skip ledger-এর আগের দিন “—” দেখায়। [ব্যবহারবিধি](design-pool-operations.md) · [test/deployment record](audits/2026-10-03-daily-designs.md)। আগের VPS source/evidence `/opt/oxeio-releases/daily-designs-20261003`।
- OX-07 Sadia Akther-এর last working day ৩০ সেপ্টেম্বর; staff inactive ও portal access disabled। তাঁর deposit খাতা আগস্ট+সেপ্টেম্বর মোট ৳১,০০০, ভুল অক্টোবর কিস্তি সরানো ও settlement snapshot ৳১,০০০ করা হয়েছে; **আগের `refunded` outcome বহাল, বাস্তবে ফেরত হয়েছে কি না owner confirmation pending।** Salary page-এ প্রতিটি মাসের নির্ধারিত payment date পরের মাসের ৫ তারিখ দেখায়, কিন্তু কোনো payment auto-record হয় না। [Record](audits/2026-10-01-ox07-offboarding-payday.md) · [Salary guide](salary-operations.md)।
- Deposit fleet audit: ১৩ staff record-এর মধ্যে Sadia ছাড়া কারও last working month-এর পর কিস্তি নেই; settlement mismatch-ও নেই। কিন্তু active ১১ জনের অক্টোবরের ৳৫০০ করে মোট ৳৫,৫০০ ১ অক্টোবরেই ledger-এ বসেছে। এটি বাস্তবে আদায় হয়েছে কি না system জানে না; salary payment table-এ কোনো record নেই। Deposit বাস্তবে কখন কাটা হয়, owner clarification pending। [Audit](audits/2026-10-01-deposit-fleet-audit.md)।
- OX-12 Abdul Karim-এর agent login recovery: Sadia-র PC তাঁকে দেওয়া হয়েছে, অথচ Windows identity আগের OX-07 device-এ বাঁধা থাকায় login-এর পরে enrollment 409 হচ্ছিল। Sadia-র আগের registration ও Abdul-এর অবসরপ্রাপ্ত `INTERN_2` device revoke করে নতুন PC-তে OX-12 enrollment/heartbeat verify করা হয়েছে; ইতিহাস অক্ষত। [Recovery record](audits/2026-10-01-ox12-agent-reassignment.md)।
- সর্বশেষ কাজ: owner-only **Salary** page-এ নির্বাচিত মাসের সব প্রাসঙ্গিক staff-এর মাসিক salary, হিসাবকৃত net payable এবং payment status (Not recorded/Unpaid/Partial/Paid) দেখা যায়। মালিক amount/date/note দিয়ে status লিখতে বা সংশোধন করতে পারেন; কোনো টাকা স্বয়ংক্রিয়ভাবে পাঠানো হয় না। আগের মাসগুলোর payment অনুমান করা হয়নি। [Release 437](audits/2026-09-30-salary-tracking.md) · [ব্যবহারবিধি](salary-operations.md)।
- আগের কাজ: Screenshots page-এ ১–৭ দিনের date range (Today/Yesterday/Last 7 days), Dhaka time band, active app, monitor number এবং আগের staff filter একসঙ্গে কাজ করে। Filter server-side count/pagination-এর আগে বসে; employee/researcher নিজের ছবিতেই সীমিত। Empty-result guidance filter অনুযায়ী বদলায়। [Release 435](audits/2026-09-30-screenshots-filters.md)।
- আগের কাজ: Search, Notification inbox এবং Deadline/reminder live। Header থেকে Search/Inbox; একই workspace page-এ Deadlines। Read status account অনুযায়ী অন্য PC-তেও থাকে; reminder app-এর ভেতরে। [Release 433](audits/2026-09-29-workspace-tools.md) · [ব্যবহারবিধি ও limits](workspace-tools-operations.md)।
- আগের কাজ: Sidebar-এর Office ও Production নিচে, Settings-এর পরে রাখা হয়েছে। [Release 430](audits/2026-09-29-sidebar-order.md)।
- আগের কাজ: Office workspace-এর আটটি section এবং পূর্বে তৈরি Production workspace live। Brief templates, Help requests, submission checks, SOP acknowledgement, equipment, joining/leaving এবং coaching ব্যবহারের জন্য প্রস্তুত। [Release 428 record](audits/2026-09-29-office-workspace.md) · [ব্যবহারবিধি](office-workspace-operations.md)।
- আগের কাজ: My Data-তে clicked/opened design selected থাকে, একই browser/account-এ refresh-এর পর ফিরে আসে; targets number অনুযায়ী ছোট থেকে বড় সাজানো। [Release 424](audits/2026-09-29-my-target-selection.md)।
- আগের কাজ: skip insights, design history, saved/shareable filters ও independent API/database/backup monitors live। September snapshot-এর ১২ জনের reconciliation-এ zero mismatch; latest local এবং existing offsite backup restore verified। Physical PC acceptance, inbox delivery এবং নতুন offsite upload/daily schedule এখনও pending। [Implementation ও acceptance record](audits/2026-09-28-system-improvements.md)।
- Site: https://hub.oxeio.com
- Web/API: **449 / 52c6a9d**। Public HTTPS health, protected Live Board endpoint ও দুই container healthy যাচাই করা হয়েছে।
- আগের কাজ: Design Pool থেকে To upload/To make live queues এবং row/More actions-এর Uploaded/Live buttons সরানো। [Release 418](audits/2026-09-28-pool-no-upload-live.md)।
- আগের কাজ: Add design targets থেকে Uploaded ও Live on Amazon tiles সরানো; তিনটি tile (In the pool, In hand, Designed) রাখা এবং layout/hint সংশোধন। [Release 416](audits/2026-09-28-add-target-three-stages.md)।
- আগের কাজ: **Design Pool audit**—delete API permissions, unfixed-error Upload block, dropped-target queues ও completion-date filters corrected. Added reset/refresh, date shortcuts, protected selection and page CSV export. [Audit](audits/2026-09-28-design-pool.md) · [ব্যবহারবিধি](design-pool-operations.md)।
- Add design targets-এর Distribute now removal বহাল; সকাল 08:00 automatic distribution চালু। [Release 412 record](audits/2026-09-27-remove-distribute.md)।
- Release 411-এর skip review বহাল: প্রতি Dhaka day প্রথম ৩টি automatic skip; পরের request owner/manager review না হওয়া পর্যন্ত assigned থাকে। [ব্যবহারবিধি](skip-review-operations.md) · [Release 411 record](audits/2026-09-27-skip-review.md)।

## যাচাই

- Release 449: isolated exact source-এ dashboard math ৫০/৫০ ও frontend ২৯৬/২৯৬ tests, API/web typecheck, lint ও build passed। Public JS/container hash matched; API/web healthy, PostgreSQL container unchanged; no migration/seed। OX-09 read-only record 09:49 locked এবং 10:03 active state দেখায়। Authenticated browser view পরীক্ষা করা হয়নি।
- Release 446: isolated staged web source-এ typecheck, lint, build ও ২৯৫ frontend tests passed; local mirror-এ একই checks passed। Public route 200, anonymous report API 401, public JS/container hash matched; API/web healthy, PostgreSQL container unchanged। Authenticated browser view পরীক্ষা করা হয়নি; no migration/seed।
- Release 444: disposable PostgreSQL-এ ১৬ backend integration/regression tests (daily report ও skip review) এবং ২৯৫ frontend tests passed; API/web typecheck, lint, build passed। Live API/web healthy, public JS container hash-এর সঙ্গে মিলে, daily report endpoint anonymous request-এ 401। PostgreSQL container বদলায়নি; migration/seed হয়নি। Authenticated browser view পরীক্ষা করা হয়নি।
- Release 437: disposable DB-তে ৪টি Salary payment/role test + আগের ৩৬টি payroll/proration integration test, frontend ২৯৫টি test, API/web build/typecheck/lint passed। Current encrypted backup isolated restore ও additive migration drill-এ core counts অপরিবর্তিত; নতুন `salary_payments` খালি। Chrome synthetic owner/status/staff-denied flow verified; real salaries browser-এ খোলা হয়নি। Public health, bundle hash, unauthenticated Salary 401, PostgreSQL unchanged, scoped source hashes release record-এ।
- Release 435: isolated DB-তে ৪টি নতুন filter integration case + আগের ৬টি latest-screenshot case passed; frontend 293 tests, API/web builds, typechecks ও targeted lint passed। Chrome-এ শুধু synthetic sample দিয়ে owner/staff filter ও reset flows দেখা হয়েছে; authenticated live gallery খোলা হয়নি। No migration, seed বা production screenshot data read। Live health, unauthenticated screenshots 401, public bundle hash, unchanged PostgreSQL container এবং ছয়টি scoped source hash release record-এ।
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
- Recent applied migrations: `20260926010000_target_history`, `20260927010000_skip_review_limit`, `20260926020000_production_workspace`, `20260929010000_office_workflows`, `20260929020000_workspace_inbox`, `20260930070000_salary_payments`। Seed চালানো হয়নি। PostgreSQL container পুনরায় তৈরি করা হয়নি।

## Source ও access

- Current VPS: `165.101.189.253`, SSH port `2222`, user `root`; repository `/opt/oxeio`, compose directory `/opt/oxeio/oxeio-monitor`।
- এই PC-তে `ssh oxeio-vps` passwordless access verified। অন্য PC-তে অনুমোদিত key/access আলাদাভাবে থাকতে হবে; এই নির্দেশ key sync করে না।
- Deployed application commit marker: `/opt/oxeio/.git/oxeio-deployed-commit`। পরে docs-only commit হলে repository HEAD app commit-এর চেয়ে এগিয়ে থাকতে পারে।
- Shared handoff copy: `/opt/oxeio/docs/current-state.md`। GitHub বা অন্য PC-তে automatic sync যাচাই করা হয়নি; এই নথির update-এ GitHub push করা হয়নি।
- Release directories: `/opt/oxeio-releases/skip-review-20260927`, `/opt/oxeio-releases/remove-distribute-20260927`, `/opt/oxeio-releases/design-pool-audit-20260928`।

## পরবর্তী feature research

- ৪ অক্টোবরের prioritization: আগে payroll/deposit truth, offsite recovery/alert ও physical PC acceptance; পরের feature হিসেবে daily count drilldown, leave-aware assignment preview, version compare/review, safe bulk changes ও reference library। এটি [সুপারিশ](2026-10-04-next-priorities.md), implement/deploy হয়নি।
- 29 September market comparison: [recommendations](2026-09-29-market-research.md)। First pilot: brief templates, blocker/help requests, submission checklist; existing local proofing/workload আগে scoped review/release। Owner approved implementation; Office ও Production release 428 live। First-use content/pilot instructions: [guide](office-workspace-operations.md)।

## অসমাপ্ত / unreleased

- OX-09-এর নামে registered `DESKTOP-2HJTO63` (`rajot` Windows account) ৫ অক্টোবর 09:49-এর পর active হয়েছে। কর্মী তখন অফিসে না থাকলে কে/কীভাবে PC ব্যবহার করেছেন তা physical/remote check দরকার; server heartbeat বা screenshot একা ব্যক্তি শনাক্ত করে না। Confirmation ছাড়া registration revoke, attendance/salary adjustment বা অভিযোগ করা হয়নি।
- OX-12-এর reassigned PC-তে Abdul-এর agent ১ অক্টোবর ১০:৩৯-এ enroll করেছে; active heartbeat verified। Agent version 0.4.9, rollout-এর পর update পর্যবেক্ষণ করা যাবে।
- OX-07-এর deposit settlement-এ `refunded` আগেই লেখা ছিল; বাস্তব ফেরত দেওয়ার বিষয় owner-এর কাছে নিশ্চিত করতে হবে। ৫ অক্টোবর সেপ্টেম্বরের চূড়ান্ত payroll দেখে প্রকৃত payment status/date লিখতে হবে।
- Deposit যদি বেতন দেওয়ার দিন কাটা হয়, planned বনাম collected amount আলাদা দেখানোর পরিবর্তন প্রয়োজন; বর্তমান মাসের সারি `ensureLedger()` নিজে বানায়, তাই শুধু delete করলে আবার ফিরে আসবে। Owner-এর নিয়ম নিশ্চিত হওয়ার অপেক্ষা।
- Production workspace ও migration এখন live। Main checkout-এ unrelated agent/payroll/Studio পরিবর্তন রয়ে গেছে; সেগুলো এই release-এ অন্তর্ভুক্ত নয়।
- Recorded skip insights এবং management design history release 421-এ live। Missing historical data reconstructed নয়; automatic sanctions নেই।
- পুরো পুরোনো/dirty local checkout deploy করবেন না। Current VPS source-এর সঙ্গে scope মিলিয়ে পরের release বানাতে হবে।

## Recovery ও পরবর্তী কাজ

- Latest PC-locked status release/evidence: `/opt/oxeio-releases/pc-locked-20261005`; clean mirror `.release-salary/oxeio-monitor`। Rollback images `oxeio-api:before-pc-locked-20261005`, `oxeio-web:before-pc-locked-20261005` (build 446)। [Release record](audits/2026-10-05-ox09-idle.md)। Scope সাতটি source/test file; no migration/seed।
- Latest standalone page release/evidence: `/opt/oxeio-releases/daily-design-page-20261003`; clean mirror `.release-salary/oxeio-monitor`। Rollback images `oxeio-api:before-daily-design-page-20261003`, `oxeio-web:before-daily-design-page-20261003` (build 444)। [Release record](audits/2026-10-03-daily-design-page.md)। Scope পাঁচটি frontend file; no migration/seed।
- Original daily-report release/evidence: `/opt/oxeio-releases/daily-designs-20261003`। Rollback images `oxeio-api:before-daily-designs-20261003`, `oxeio-web:before-daily-designs-20261003` (build 440)। [Release record](audits/2026-10-03-daily-designs.md)। Scope পাঁচটি source/test file; no migration/seed।
- Latest payday release/source/evidence: `/opt/oxeio-releases/payday-20261001`; clean mirror `.release-salary/oxeio-monitor` (payday scope updated)। Rollback images `oxeio-api:before-payday-20261001`, `oxeio-web:before-payday-20261001` (build 437)। [Release record](audits/2026-10-01-ox07-offboarding-payday.md)। No migration/seed; salary payment records untouched।
- Previous salary release/evidence: `/opt/oxeio-releases/salary-20260930`। Rollback images `oxeio-api:before-salary-20260930`, `oxeio-web:before-salary-20260930` (application 435)। [Release record](audits/2026-09-30-salary-tracking.md)। `20260930070000_salary_payments` migration additive; পুরোনো app-এ ফিরলেও নতুন payment records নষ্ট করবেন না।
- Earlier source/evidence: `/opt/oxeio-releases/screenshots-filters-20260930`; clean mirror `.release-office`। Rollback images: `oxeio-api:before-screenshots-filters-20260930`, `oxeio-web:before-screenshots-filters-20260930` (application 433)। [Release record](audits/2026-09-30-screenshots-filters.md)।
- Earlier source/evidence: `/opt/oxeio-releases/office-workflows-20260929`; clean mirror `.release-office`। Rollback to 424: `before-office-workflows-20260929` API/web tags। [Details](audits/2026-09-29-office-workspace.md)।
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
