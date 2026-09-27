# Current state — অন্য PC থেকে কাজ চালু করার নোট

সর্বশেষ আপডেট: ২৭ সেপ্টেম্বর ২০২৬ · Asia/Dhaka

## Live

- Site: https://hub.oxeio.com
- Web/API: **412 / b317bd9**। Public HTTPS health ও দুই container healthy যাচাই করা হয়েছে।
- শেষ কাজ: **Add design targets** থেকে **Distribute now** সরানো হয়েছে। Add to pool ও সকাল 08:00 automatic distribution বহাল। [Release 412 record](audits/2026-09-27-remove-distribute.md)।
- Release 411-এর skip review বহাল: প্রতি Dhaka day প্রথম ৩টি automatic skip; পরের request owner/manager review না হওয়া পর্যন্ত assigned থাকে। [ব্যবহারবিধি](skip-review-operations.md) · [Release 411 record](audits/2026-09-27-skip-review.md)।

## যাচাই

- Release 412: local typecheck ও targeted lint; production build; public HTML, bundle hash এবং Distribute now অনুপস্থিতি যাচাই। Database migration লাগেনি।
- Release 411: exact source-এ ৮ integration + ৪০ rule test; encrypted backup parsing; ২ migration; matching API/web commit ও public bundle যাচাই।
- Applied migrations: `20260926010000_target_history`, `20260927010000_skip_review_limit`। Seed চালানো হয়নি। PostgreSQL container পুনরায় তৈরি করা হয়নি।

## Source ও access

- Current VPS: `165.101.189.253`, SSH port `2222`, user `root`; repository `/opt/oxeio`, compose directory `/opt/oxeio/oxeio-monitor`।
- এই PC-তে `ssh oxeio-vps` passwordless access verified। অন্য PC-তে অনুমোদিত key/access আলাদাভাবে থাকতে হবে; এই নির্দেশ key sync করে না।
- Deployed application commit marker: `/opt/oxeio/.git/oxeio-deployed-commit`। পরে docs-only commit হলে repository HEAD app commit-এর চেয়ে এগিয়ে থাকতে পারে।
- Shared handoff copy: `/opt/oxeio/docs/current-state.md`। GitHub বা অন্য PC-তে automatic sync যাচাই করা হয়নি; এই নথির update-এ GitHub push করা হয়নি।
- Release directories: `/opt/oxeio-releases/skip-review-20260927`, `/opt/oxeio-releases/remove-distribute-20260927`।

## অসমাপ্ত / unreleased

- Local workspace-এ পূর্ণ Production workspace-এর আলাদা পরিবর্তন আছে। এর UI এবং `20260926020000_production_workspace` migration live নয়। Target-history dependency শুধু release 411-এ live হয়েছে।
- Screenshot evidence, comparative skip-rate dashboard ও automatic sanctions skip release-এর অংশ নয়।
- পুরো পুরোনো/dirty local checkout deploy করবেন না। Current VPS source-এর সঙ্গে scope মিলিয়ে পরের release বানাতে হবে।

## Recovery ও পরবর্তী কাজ

- Release 412-এর আগের images: `oxeio-api:before-remove-distribute`, `oxeio-web:before-remove-distribute` — এগুলো release 411, যেখানে skip review আছে।
- Encrypted pre-411 backup ও source bundle-এর তথ্য [release 411 record](audits/2026-09-27-skip-review.md)-এ। Pending skips থাকলে skip-review-বিহীন পুরোনো API-তে rollback করা যাবে না; আগে নতুন API দিয়ে সিদ্ধান্ত দিতে হবে।
- কাজ শুরুতে [স্থায়ী নির্দেশনা](work-preferences.md) পড়ুন। কাজ শেষে এই নথি এবং সংশ্লিষ্ট docs আপডেট করে shared copy কোথায় সংরক্ষিত হলো যাচাই করুন।
