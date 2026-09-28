# Current state — অন্য PC থেকে কাজ চালু করার নোট

সর্বশেষ আপডেট: ২৮ সেপ্টেম্বর ২০২৬ · Asia/Dhaka

## Live

- Site: https://hub.oxeio.com
- Web/API: **418 / e559b45**। Public HTTPS health ও দুই container healthy যাচাই করা হয়েছে।
- শেষ কাজ: Design Pool থেকে To upload/To make live queues এবং row/More actions-এর Uploaded/Live buttons সরানো। [Release 418](audits/2026-09-28-pool-no-upload-live.md)।
- আগের কাজ: Add design targets থেকে Uploaded ও Live on Amazon tiles সরানো; তিনটি tile (In the pool, In hand, Designed) রাখা এবং layout/hint সংশোধন। [Release 416](audits/2026-09-28-add-target-three-stages.md)।
- আগের কাজ: **Design Pool audit**—delete API permissions, unfixed-error Upload block, dropped-target queues ও completion-date filters corrected. Added reset/refresh, date shortcuts, protected selection and page CSV export. [Audit](audits/2026-09-28-design-pool.md) · [ব্যবহারবিধি](design-pool-operations.md)।
- Add design targets-এর Distribute now removal বহাল; সকাল 08:00 automatic distribution চালু। [Release 412 record](audits/2026-09-27-remove-distribute.md)।
- Release 411-এর skip review বহাল: প্রতি Dhaka day প্রথম ৩টি automatic skip; পরের request owner/manager review না হওয়া পর্যন্ত assigned থাকে। [ব্যবহারবিধি](skip-review-operations.md) · [Release 411 record](audits/2026-09-27-skip-review.md)।

## যাচাই

- Release 418: frontend 279 tests passed, production build/typecheck ও targeted lint; no migration or seed. Final Chrome/health evidence release record-এ।

- Release 416: UI-only change; frontend build/typecheck ও targeted lint, live Chrome এবং HTTPS verification-এর record release note-এ। No migration or seed.

- Release 414: backend 138 এবং frontend 281 tests passed; final 8 audit cases re-run passed. Typecheck, lint/build, encrypted backup parsing, public HTTPS ও bundle hash verified. No migration or seed.

- Release 412: local typecheck ও targeted lint; production build; public HTML, bundle hash এবং Distribute now অনুপস্থিতি যাচাই। Database migration লাগেনি।
- Release 411: exact source-এ ৮ integration + ৪০ rule test; encrypted backup parsing; ২ migration; matching API/web commit ও public bundle যাচাই।
- Applied migrations: `20260926010000_target_history`, `20260927010000_skip_review_limit`। Seed চালানো হয়নি। PostgreSQL container পুনরায় তৈরি করা হয়নি।

## Source ও access

- Current VPS: `165.101.189.253`, SSH port `2222`, user `root`; repository `/opt/oxeio`, compose directory `/opt/oxeio/oxeio-monitor`।
- এই PC-তে `ssh oxeio-vps` passwordless access verified। অন্য PC-তে অনুমোদিত key/access আলাদাভাবে থাকতে হবে; এই নির্দেশ key sync করে না।
- Deployed application commit marker: `/opt/oxeio/.git/oxeio-deployed-commit`। পরে docs-only commit হলে repository HEAD app commit-এর চেয়ে এগিয়ে থাকতে পারে।
- Shared handoff copy: `/opt/oxeio/docs/current-state.md`। GitHub বা অন্য PC-তে automatic sync যাচাই করা হয়নি; এই নথির update-এ GitHub push করা হয়নি।
- Release directories: `/opt/oxeio-releases/skip-review-20260927`, `/opt/oxeio-releases/remove-distribute-20260927`, `/opt/oxeio-releases/design-pool-audit-20260928`।

## অসমাপ্ত / unreleased

- Local workspace-এ পূর্ণ Production workspace-এর আলাদা পরিবর্তন আছে। এর UI এবং `20260926020000_production_workspace` migration live নয়। Target-history dependency শুধু release 411-এ live হয়েছে।
- Screenshot evidence, comparative skip-rate dashboard ও automatic sanctions skip release-এর অংশ নয়।
- পুরো পুরোনো/dirty local checkout deploy করবেন না। Current VPS source-এর সঙ্গে scope মিলিয়ে পরের release বানাতে হবে।

## Recovery ও পরবর্তী কাজ

- Release 414-এর আগের images: `oxeio-api:before-pool-audit-20260928`, `oxeio-web:before-pool-audit-20260928` (release 412)।
- Current release encrypted backup/source bundle: `/opt/oxeio-releases/design-pool-audit-20260928`।
- পরের উপযোগী Design Pool scope: saved/shareable filters, history drawer, recorded skip-rate report, full filtered export. Current CSV only exports the visible page.

- Release 412-এর আগের images: `oxeio-api:before-remove-distribute`, `oxeio-web:before-remove-distribute` — এগুলো release 411, যেখানে skip review আছে।
- Encrypted pre-411 backup ও source bundle-এর তথ্য [release 411 record](audits/2026-09-27-skip-review.md)-এ। Pending skips থাকলে skip-review-বিহীন পুরোনো API-তে rollback করা যাবে না; আগে নতুন API দিয়ে সিদ্ধান্ত দিতে হবে।
- কাজ শুরুতে [স্থায়ী নির্দেশনা](work-preferences.md) পড়ুন। কাজ শেষে এই নথি এবং সংশ্লিষ্ট docs আপডেট করে shared copy কোথায় সংরক্ষিত হলো যাচাই করুন।
