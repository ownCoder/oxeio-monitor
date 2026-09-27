# Design skip — ব্যবহার ও review

২৭ সেপ্টেম্বর ২০২৬ · Live release **411 / 5dd3783** · [সাইট](https://hub.oxeio.com)

## Designer-এর নিয়ম

- প্রতি Asia/Dhaka calendar day-এ প্রথম **৩টি সফল skip request** automatic। দিন বদলায় রাত ১২টায়।
- পরের request **Pending skip review** হয়। ডিজাইনটি assigned থাকে এবং তার slot খালি হয় না; ওই request-এর জন্য approval-এর আগে replacement আসে না। অন্য ডিজাইনে কাজ চালানো যায়।
- My targets-এ আজকের automatic allowance ও pending ডিজাইন দেখা যায়। Pending ডিজাইন complete বা আবার skip করা যায় না।
- একই request retry বা অন্যের assignment skip করার ব্যর্থ চেষ্টা quota খরচ করে না। সফল request reject বা undo করলে দিনের quota ফেরত আসে না।
- পরদিন allowance নতুন হয়, কিন্তু আগের pending request নিজে থেকে approve বা release হয় না।

## Owner/manager-এর review

1. **Review** পাতায় `Pending skip review` সারি দেখুন।
2. **Approve skip** দিলে ডিজাইন skipped হয়। নতুন কাজ পাওয়া pool availability ও বিদ্যমান allocation/daily issuance limit-এর ওপর নির্ভর করে।
3. **Reject · return to designer** দিলে একই ডিজাইন একই designer-এর কাছে assigned থাকে; pending অবস্থা সরে যায়।

শুধু owner/manager সিদ্ধান্ত দিতে পারেন। একই request-এ একাধিক সিদ্ধান্ত একসঙ্গে এলে প্রথম সফল সিদ্ধান্ত বহাল থাকে। সাধারণ status change, delete বা end-of-day return দিয়ে pending review পাশ কাটানো যায় না।

## তারিখ ও হিসাব পড়া

Review/Skipped-এর date filter এখন **skip-request-এর প্রকৃত সময়** ধরে। আগে assignment/start date দেখে কোনো নির্দিষ্ট দিনে কতটি skip হয়েছে নিশ্চিত বলা যেত না। বেশি skip একাই ইচ্ছাকৃত system bypass-এর প্রমাণ নয়।

পুরোনো skips-এর request time জানা না থাকলে `Skip time not recorded (legacy)` দেখা যায়। সেগুলো এবং deleted designs দেখতে Review-এর date filter clear করুন। পুরোনো ঘটনার সময় বানিয়ে বসানো হয়নি; আগের skips নতুন daily ledger-এ backfill করা হয়নি।

প্রতিটি নতুন সফল request-এর employee, actor, reason, সময় এবং সিদ্ধান্ত ledger-এ থাকে। Rejection, undo বা reassignment সেটি মুছে দেয় না।

## এই release-এর সীমা

Screenshot evidence upload, কর্মীভিত্তিক comparative skip-rate dashboard এবং automatic sanctions এই release-এ নেই। পূর্ণ Production workspace-এর UI-ও এখনও unreleased।

## Deployment ও recovery

Exact release source-এ **৮টি integration + ৪০টি rule test** পাস। Encrypted backup, migration status, public HTTPS health ও served bundle hash যাচাই হয়েছে।

Pending skips থাকলে পুরোনো API-তে rollback করবেন না; আগে নতুন API দিয়ে সেগুলোর সিদ্ধান্ত দিন। Backup, image tags, source bundle ও migration-এর বিস্তারিত [deployment record](audits/2026-09-27-skip-review.md)-এ আছে।
